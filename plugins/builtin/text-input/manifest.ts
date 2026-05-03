/**
 * Text Input — primary text source.
 *
 * In project mode, the orchestrator injects the composer's prompt into
 * this node's input when `data.isPrimary === true`. In test mode, falls
 * back to `data.testValue` configured on the node.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface TextInputData extends BaseNodeData {
  kind: "textInput";
  isPrimary?: boolean;
  testValue?: string;
  required?: boolean;
  maxLength?: number;
}

export const manifest: NodeManifest<TextInputData> = {
  kind: "textInput",
  displayName: "Text Input",
  description: "Text input from user prompt composer or test value.",
  category: "source",
  accent: "purple",
  icon: "Type",
  inputs: [],
  outputs: [{ id: "output", label: "text", type: "text" }],
  defaultData: () => ({
    kind: "textInput",
    label: "Text Input",
    isPrimary: false,
    testValue: "",
    required: true,
    maxLength: 500,
  }),
  executable: true,
};
