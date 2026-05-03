/**
 * Text Combine executor — interpolates `{handleName}` tokens in `data.template`
 * with upstream values keyed by the handle name.
 *
 * Missing or null upstream values become empty strings. Non-string values
 * (asset refs, numbers) are stringified — JSON for objects, native for
 * primitives — so the template is always renderable.
 *
 * @example
 *   template: "{prompt}, {style}, no {negatives}"
 *   inputs:   { prompt: "sunset", style: "cinematic", negatives: "blurry" }
 *   output:   "sunset, cinematic, no blurry"
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import type { TextCombineData } from "./manifest";

const HANDLE_TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g;

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export const executor: NodeExecutor<TextCombineData> = {
  async execute(_ctx, inputs, data) {
    const template = data.template ?? "";
    const result = template.replace(HANDLE_TOKEN, (_match, handle: string) =>
      asString(inputs[handle])
    );
    return { output: result };
  },
};
