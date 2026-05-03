/**
 * Text Input executor — emits a string.
 *
 * Resolution priority:
 *   1. Run input keyed by this node's id (project mode primary text input
 *      gets the composer prompt injected here).
 *   2. `data.testValue` — always used in test mode; fallback in project
 *      mode for non-primary inputs.
 *   3. Empty string.
 *
 * Honours `data.required` — fails the node if the resolved string is empty.
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import type { TextInputData } from "./manifest";

export const executor: NodeExecutor<TextInputData> = {
  async execute(_ctx, inputs, data) {
    const fromRun = typeof inputs.value === "string" ? inputs.value : undefined;
    const text = fromRun ?? data.testValue ?? "";
    if (data.required && !text.trim()) {
      throw new Error(`Required input "${data.label}" is empty`);
    }
    return { output: text };
  },
};
