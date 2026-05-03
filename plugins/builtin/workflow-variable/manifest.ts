/**
 * Workflow Variable — static text bound to the workflow.
 *
 * Always available to downstream nodes regardless of run mode. Useful for
 * style tokens, constant prompt fragments, model identifiers, etc.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface WorkflowVariableData extends BaseNodeData {
  kind: "workflowVariable";
  variable: string;
  value: string;
}

export const manifest: NodeManifest<WorkflowVariableData> = {
  kind: "workflowVariable",
  displayName: "Workflow Variable",
  description: "Static text bound to the workflow, always available to downstream nodes.",
  category: "source",
  accent: "orange",
  icon: "Variable",
  inputs: [],
  outputs: [{ id: "output", label: "value", type: "text" }],
  defaultData: () => ({
    kind: "workflowVariable",
    label: "Workflow Variable",
    variable: "style",
    value: "Cinematic",
  }),
  executable: true,
};
