import "server-only";

import { LLMGenerateInput, LLMProvider, TextDelta, sseLines } from "./base";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: Array<AnthropicTextBlock | AnthropicImageBlock>;
}

interface ProviderConfig {
  baseUrl?: string;
  apiKey: string;
}

/**
 * Native Anthropic Messages API adapter. Streams content_block_delta events.
 * Supports vision (image blocks via base64).
 */
export function createAnthropicProvider(cfg: ProviderConfig): LLMProvider {
  const baseUrl = (cfg.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");

  return {
    async *generate(input: LLMGenerateInput): AsyncIterable<TextDelta> {
      // Anthropic puts the system prompt outside `messages`.
      const systemMessage = input.messages.find((m) => m.role === "system")?.content;
      const conversational = input.messages.filter((m) => m.role !== "system");
      const messages: AnthropicMessage[] = conversational.map((m) => {
        const blocks: Array<AnthropicTextBlock | AnthropicImageBlock> = [
          { type: "text", text: m.content },
        ];
        if (m.role === "user" && m.images) {
          for (const img of m.images) {
            blocks.push({
              type: "image",
              source: { type: "base64", media_type: img.mime, data: img.data.toString("base64") },
            });
          }
        }
        return { role: m.role === "assistant" ? "assistant" : "user", content: blocks };
      });

      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        signal: input.abortSignal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          system: systemMessage,
          temperature: input.temperature,
          max_tokens: input.maxTokens ?? 1024,
          stream: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      if (!res.body) throw new Error("Anthropic response has no body");

      for await (const line of sseLines(res.body)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const obj = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta" && obj.delta.text) {
            yield { text: obj.delta.text };
          }
        } catch {
          /* skip malformed line */
        }
      }
    },
  };
}
