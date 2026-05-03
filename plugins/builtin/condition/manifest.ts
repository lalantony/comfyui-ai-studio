/**
 * Condition — null-routing branch.
 *
 * Passes the input through to either the `true` or `false` output handle
 * depending on the configured predicate; the OTHER handle emits null.
 * Downstream nodes that receive null from every incoming edge are
 * auto-skipped by the orchestrator.
 *
 * **Predicate semantics**:
 *   - `isSet`    — true if the input is not null/undefined/empty string.
 *   - `isEmpty`  — inverse of isSet.
 *   - `equals`   — string equality. Coerces input via String() first; a
 *                  number `42` matches compareValue `"42"`. For typed
 *                  comparison (number = number, structural object equality)
 *                  build a custom condition plugin — this one is intentionally
 *                  scalar-string-only to keep the surface tiny.
 *   - `contains` — substring match against String(input).
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface ConditionData extends BaseNodeData {
  kind: "condition";
  predicate: "isSet" | "isEmpty" | "equals" | "contains";
  compareValue?: string;
}

export const manifest: NodeManifest<ConditionData> = {
  kind: "condition",
  displayName: "Condition",
  description: "Branch downstream nodes based on a predicate over the input.",
  category: "processing",
  accent: "orange",
  icon: "GitBranch",
  inputs: [{ id: "input", label: "input", type: "any", required: true }],
  outputs: [
    { id: "true", label: "true", type: "any" },
    { id: "false", label: "false", type: "any" },
  ],
  defaultData: () => ({
    kind: "condition",
    label: "Condition",
    predicate: "isSet",
  }),
  executable: true,
};
