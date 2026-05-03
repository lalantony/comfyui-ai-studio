/**
 * LLM — invokes a streaming LLM provider.
 *
 * `data.apiKey` is per-node — the trust boundary is the OS file system,
 * same as ComfyUI itself. **`sanitizeForExport` strips it on export**:
 * leaking API keys in shared workflow bundles is unacceptable.
 *
 * Vision: when an image flows into the `image` handle (as an asset ref),
 * the executor reads the binary and attaches it to the user message.
 *
 * Provider dispatch:
 *   - `openai-compat` — covers OpenAI, OpenRouter, Together, Ollama, vLLM
 *   - `anthropic`     — native Claude
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface LLMNodeData extends BaseNodeData {
  kind: "llm";
  provider: "openai-compat" | "anthropic";
  /** For openai-compat (e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 for Ollama). */
  baseUrl?: string;
  apiKey?: string;
  model: string;
  /** Static system prompt used when no `system` input handle is connected. */
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export const manifest: NodeManifest<LLMNodeData> = {
  kind: "llm",
  displayName: "LLM",
  description: "Call an LLM (OpenAI-compatible or Anthropic) with optional system prompt and image.",
  category: "ai",
  accent: "purple",
  icon: "Sparkles",
  inputs: [
    { id: "system", label: "system", type: "text", optional: true },
    { id: "user", label: "user", type: "text", required: true },
    { id: "image", label: "image", type: "image", optional: true },
  ],
  outputs: [{ id: "output", label: "output", type: "text" }],
  defaultData: () => ({
    kind: "llm",
    label: "LLM",
    provider: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 1024,
  }),
  sanitizeForExport: (data) => ({
    ...data,
    // Critical: never leak API keys in shared bundles.
    apiKey: undefined,
  }),
  executable: true,
};
