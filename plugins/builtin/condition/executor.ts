/**
 * Condition executor — null-routing.
 *
 * Predicates (see manifest.ts for full doc):
 *   - isSet:    value is non-null, non-undefined, non-empty string
 *   - isEmpty:  inverse of isSet
 *   - equals:   String(value) === (data.compareValue ?? "")
 *   - contains: String(data.compareValue) is a substring of String(value)
 *
 * Whichever output handle does NOT receive the value emits `null`. The
 * orchestrator interprets a node receiving null on every incoming edge as
 * "skip this node", which cascades down the branch.
 *
 * Coercion-via-String design choice: a numeric `42` flowing into an
 * equals against `"42"` matches. This is intentional — the alternative
 * (silent skip on type mismatch) was the audit-flagged confusion. For
 * structural equality on objects, build a custom plugin.
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import type { ConditionData } from "./manifest";

export const executor: NodeExecutor<ConditionData> = {
  async execute(_ctx, inputs, data) {
    const value = inputs.input ?? Object.values(inputs)[0];

    let pass = false;
    switch (data.predicate) {
      case "isSet":
        pass = value !== null && value !== undefined && value !== "";
        break;
      case "isEmpty":
        pass = value === null || value === undefined || value === "";
        break;
      case "equals":
        pass =
          value !== null &&
          value !== undefined &&
          String(value) === (data.compareValue ?? "");
        break;
      case "contains":
        pass =
          value !== null &&
          value !== undefined &&
          typeof data.compareValue === "string" &&
          String(value).includes(data.compareValue);
        break;
    }

    return {
      true: pass ? value : null,
      false: pass ? null : value,
    };
  },
};
