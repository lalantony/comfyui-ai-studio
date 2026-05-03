/**
 * LLM provider abstraction. Every adapter (`openai-compat.ts`, `anthropic.ts`,
 * future providers) implements `LLMProvider.generate()` as an async iterable
 * of token deltas. The LLM executor consumes this stream, throttles the
 * `node.progress { partialText }` events to ~10 Hz, and concatenates into a
 * final string.
 *
 * Adding a new provider:
 *   1. Implement `LLMProvider` for your `/v1/<endpoint>` shape.
 *   2. Wire it into the dispatch in `lib/server/workflow/executors/llm.ts`.
 *   3. If it's OpenAI-compatible, just configure `openai-compat.ts` with the
 *      provider's baseUrl instead — no new file needed.
 *
 * `sseLines()` is the shared SSE byte-stream → line iterator both adapters
 * use to parse Server-Sent Events from the upstream HTTP response.
 */
import "server-only";

export interface LLMImagePart {
  /** Raw bytes of the image (we'll base64-encode for transport). */
  data: Buffer;
  /** MIME type, e.g. "image/png". */
  mime: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Optional: attach images (vision-capable models only). Only honored on user messages. */
  images?: LLMImagePart[];
}

export interface LLMGenerateInput {
  messages: LLMMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

export interface TextDelta {
  text: string;
}

export interface LLMProvider {
  generate(input: LLMGenerateInput): AsyncIterable<TextDelta>;
}

/** Helper: drain an SSE-style ReadableStream into individual `data:` lines. */
export async function* sseLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line) yield line;
        nl = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}
