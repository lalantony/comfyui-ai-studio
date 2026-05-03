/**
 * LLM executor — invokes a streaming LLM provider.
 *
 * Inputs:
 *   - `system` (optional, string): static system prompt fallback if not
 *     connected = data.systemPrompt
 *   - `user`   (required, string): the message
 *   - `image`  (optional, AssetRef): for Vision-capable models. Bytes are
 *     read from the project's asset store and attached to the user message.
 *
 * Output: `{ output: finalText }`
 *
 * Streaming: progress events fire at ~10 Hz (every ~100ms) — we throttle
 * deliberately so the canvas doesn't repaint on every token, which kills
 * frame rate on long generations.
 *
 * Cancellation: respects `ctx.abortSignal` between chunks. The provider
 * adapter is also passed the signal so the upstream HTTP request can be
 * aborted mid-stream.
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import { LLMMessage, LLMProvider } from "@/lib/server/providers/llm/base";
import { createOpenAICompatProvider } from "@/lib/server/providers/llm/openai-compat";
import { createAnthropicProvider } from "@/lib/server/providers/llm/anthropic";
import { getAssetBinary } from "@/lib/server/assetService";
import type { LLMNodeData } from "./manifest";

function makeProvider(data: LLMNodeData): LLMProvider {
  if (data.provider === "anthropic") {
    if (!data.apiKey) throw new Error("Anthropic provider requires an API key");
    return createAnthropicProvider({ baseUrl: data.baseUrl, apiKey: data.apiKey });
  }
  if (data.provider === "openai-compat") {
    const baseUrl = data.baseUrl ?? "https://api.openai.com/v1";
    // Local provider check: well-known local hosts can run unauthenticated
    // (Ollama, vLLM dev). For everything else, missing apiKey would
    // produce `Authorization: Bearer undefined` and a confusing 401 from
    // the provider — fail up-front with a clear message instead.
    if (!data.apiKey && !isLocalLLMHost(baseUrl)) {
      throw new Error(
        `OpenAI-compatible provider at ${baseUrl} requires an API key. Set it on the LLM node, or point baseUrl at a local-only server (Ollama / vLLM).`
      );
    }
    return createOpenAICompatProvider({ baseUrl, apiKey: data.apiKey });
  }
  throw new Error(`Unknown LLM provider: ${data.provider}`);
}

function isLocalLLMHost(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1" ||
      u.hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

interface AssetRefValue {
  assetId: string;
  projectId: string;
}

function isAssetRef(value: unknown): value is AssetRefValue {
  return !!value && typeof value === "object" && "assetId" in value && "projectId" in value;
}

export const executor: NodeExecutor<LLMNodeData> = {
  async execute(ctx, inputs, data) {
    const userText = typeof inputs.user === "string" ? inputs.user : "";
    if (!userText.trim()) {
      throw new Error(`LLM node "${data.label}" needs a user message on the "user" handle`);
    }

    const systemText = (typeof inputs.system === "string" && inputs.system) || data.systemPrompt || "";
    const messages: LLMMessage[] = [];
    if (systemText) messages.push({ role: "system", content: systemText });

    const userMsg: LLMMessage = { role: "user", content: userText };

    // Image input → read bytes for Vision-capable models. If the asset
    // ref is invalid (project/asset deleted between composer-pick and
    // run start, sidecar corrupt), surface a `run.log warn` so the user
    // knows the image was dropped — without it, the model produces a
    // confused response and the failure is invisible.
    if (isAssetRef(inputs.image)) {
      const ref = inputs.image;
      const bin = await getAssetBinary(ref.projectId, ref.assetId);
      if (bin) {
        userMsg.images = [{ data: bin.buffer, mime: bin.mime }];
      } else {
        await ctx.emit({
          type: "run.log",
          runId: ctx.runId,
          nodeId: ctx.nodeId,
          level: "warn",
          message: `Image asset ${ref.assetId} (project ${ref.projectId}) could not be read; LLM call proceeding without it.`,
          timestamp: new Date().toISOString(),
        });
      }
    }
    messages.push(userMsg);

    const provider = makeProvider(data);
    let accumulated = "";
    let lastEmit = 0;
    const stream = provider.generate({
      messages,
      model: data.model,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      abortSignal: ctx.abortSignal,
    });

    for await (const delta of stream) {
      if (ctx.abortSignal.aborted) throw new Error("Cancelled");
      accumulated += delta.text;
      const now = Date.now();
      if (now - lastEmit >= 100) {
        lastEmit = now;
        await ctx.emit({
          type: "node.progress",
          runId: ctx.runId,
          nodeId: "",
          partialText: accumulated,
        });
      }
    }

    // Final progress event guarantees the UI sees the last tokens even if
    // the throttle skipped them.
    await ctx.emit({
      type: "node.progress",
      runId: ctx.runId,
      nodeId: "",
      progress: 1,
      partialText: accumulated,
    });

    return { output: accumulated };
  },
};
