import "server-only";

import { LLMGenerateInput, LLMProvider, TextDelta, sseLines } from "./base";

interface OpenAIChatPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAIChatPart[];
}

interface ProviderConfig {
  /** e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
}

/**
 * OpenAI-compatible Chat Completions adapter. Works against:
 *   - OpenAI (default https://api.openai.com/v1)
 *   - OpenRouter
 *   - Together AI
 *   - vLLM-served models
 *   - Ollama (with /v1 path)
 *
 * Supports text + image_url (base64) parts for vision.
 */
export function createOpenAICompatProvider(cfg: ProviderConfig): LLMProvider {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");

  return {
    async *generate(input: LLMGenerateInput): AsyncIterable<TextDelta> {
      const messages: OpenAIChatMessage[] = input.messages.map((m) => {
        if (m.images && m.images.length > 0 && m.role === "user") {
          const parts: OpenAIChatPart[] = [{ type: "text", text: m.content }];
          for (const img of m.images) {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${img.mime};base64,${img.data.toString("base64")}` },
            });
          }
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: input.abortSignal,
        body: JSON.stringify({
          model: input.model,
          messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          stream: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`LLM ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      if (!res.body) throw new Error("LLM response has no body");

      for await (const line of sseLines(res.body)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = obj.choices?.[0]?.delta?.content;
          if (text) yield { text };
        } catch {
          /* skip malformed line */
        }
      }
    },
  };
}
