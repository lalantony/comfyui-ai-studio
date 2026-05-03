import type { Workflow } from "@/types";
import { parseNodeData } from "@/lib/plugins/parseNodeData";
import type { TextInputData } from "@/plugins/builtin/text-input/manifest";
import type { ImageInputData } from "@/plugins/builtin/image-input/manifest";
// Side-effect: ensure manifests are registered before parseNodeData runs.
import "@/lib/plugins/registerBuiltins";

export interface WorkflowInputProfile {
  primaryTextInputNodeId: string | null;
  primaryImageInputNodeId: string | null;
  primaryVideoInputNodeId: string | null;
  hasImageInput: boolean;
  hasVideoInput: boolean;
  hasTextInput: boolean;
  requiresImage: boolean;
  requiresVideo: boolean;
  requiresText: boolean;
}

const EMPTY_PROFILE: WorkflowInputProfile = {
  primaryTextInputNodeId: null,
  primaryImageInputNodeId: null,
  primaryVideoInputNodeId: null,
  hasImageInput: false,
  hasVideoInput: false,
  hasTextInput: false,
  requiresImage: false,
  requiresVideo: false,
  requiresText: false,
};

/**
 * Walk a Studio workflow and surface the input handles a composer needs to populate.
 *
 * Convention: a node flagged `data.isPrimary === true` is the canonical input. If no node is
 * flagged, we fall back to the first node of that kind in document order so simple workflows
 * "just work" without requiring the designer to set the flag.
 */
export function introspectWorkflowInputs(workflow: Workflow | null): WorkflowInputProfile {
  if (!workflow || !workflow.nodes || workflow.nodes.length === 0) return EMPTY_PROFILE;

  let firstText: { id: string; data: TextInputData } | null = null;
  let primaryText: { id: string; data: TextInputData } | null = null;
  let firstImage: { id: string; data: ImageInputData } | null = null;
  let primaryImage: { id: string; data: ImageInputData } | null = null;

  for (const node of workflow.nodes) {
    const parsed = parseNodeData(node);
    if (!parsed) continue;
    if (parsed.kind === "textInput") {
      const data = parsed as TextInputData;
      const ref = { id: node.id, data };
      if (data.isPrimary && !primaryText) primaryText = ref;
      if (!firstText) firstText = ref;
    } else if (parsed.kind === "imageInput") {
      const data = parsed as ImageInputData;
      const ref = { id: node.id, data };
      if (data.isPrimary && !primaryImage) primaryImage = ref;
      if (!firstImage) firstImage = ref;
    }
  }

  const text = primaryText ?? firstText;
  const image = primaryImage ?? firstImage;

  return {
    primaryTextInputNodeId: text?.id ?? null,
    primaryImageInputNodeId: image?.id ?? null,
    primaryVideoInputNodeId: null,
    hasTextInput: !!firstText,
    hasImageInput: !!firstImage,
    hasVideoInput: false,
    requiresText: !!(text && text.data.required),
    requiresImage: !!(image && image.data.required),
    requiresVideo: false,
  };
}
