/**
 * Workflow input contract.
 *
 * The composer (project mode) and the workflow editor's Test Run button
 * both submit a `inputs: Record<string, unknown>` keyed by source-node
 * id. This module derives the *contract* — the shape of inputs the
 * workflow expects — from the workflow definition itself, then validates
 * a candidate input set against it before submission.
 *
 * Why this exists:
 *   - Multi-slot workflows: a workflow with 2 image inputs (e.g.
 *     reference + init) couldn't be expressed in the previous "primary
 *     text + primary image" model. The slot list captures every input
 *     node so the composer can bind chips to the right slot.
 *   - Pre-flight error UX: instead of a confusing server-side failure
 *     mid-run ("missing input X"), the user gets a clear toast at
 *     Generate time: "This workflow needs an Init image but you didn't
 *     attach one."
 *   - Unified rules: the runtime still validates server-side as a
 *     backstop; the contract module is the single source of truth that
 *     both client + server can call.
 *
 * Module is loaded by both client components and server-side runtime
 * code, so no `import "server-only"`.
 */
import type { Workflow } from "@/types";
import { parseNodeData } from "@/lib/plugins/parseNodeData";
import type { TextInputData } from "@/plugins/builtin/text-input/manifest";
import type { ImageInputData } from "@/plugins/builtin/image-input/manifest";
// Side-effect: ensure manifests are registered before parseNodeData runs.
import "@/lib/plugins/registerBuiltins";

export type SlotKind = "text" | "image" | "video";

export interface InputSlot {
  nodeId: string;
  kind: SlotKind;
  /** Node label or fallback display string. */
  label: string;
  required: boolean;
  /** Image/video only — Reference / Init / Mask. */
  role?: "reference" | "init" | "mask";
  /** Source-of-truth flag from the manifest data. First-found wins as fallback. */
  isPrimary: boolean;
}

/**
 * Walk a workflow's source nodes and produce the input slot list. Order
 * is the workflow's node array order — stable and matches what the
 * canvas renders top-to-bottom.
 */
export function deriveInputSlots(workflow: Workflow | null): InputSlot[] {
  if (!workflow || !workflow.nodes) return [];
  const slots: InputSlot[] = [];
  for (const node of workflow.nodes) {
    const parsed = parseNodeData(node);
    if (!parsed) continue;
    if (parsed.kind === "textInput") {
      const data = parsed as TextInputData;
      slots.push({
        nodeId: node.id,
        kind: "text",
        label: data.label || "Text input",
        required: data.required ?? false,
        isPrimary: data.isPrimary ?? false,
      });
    } else if (parsed.kind === "imageInput") {
      const data = parsed as ImageInputData;
      slots.push({
        nodeId: node.id,
        kind: "image",
        label: data.label || "Image input",
        required: data.required ?? false,
        role: data.inputRole,
        isPrimary: data.isPrimary ?? false,
      });
    } else if (parsed.kind === "videoInput") {
      // VideoInput shares the same essential shape as ImageInput; cast to
      // the looser BaseNodeData fields since the manifest type doesn't
      // export a dedicated VideoInputData yet.
      const data = parsed as { label?: string; required?: boolean; isPrimary?: boolean };
      slots.push({
        nodeId: node.id,
        kind: "video",
        label: data.label || "Video input",
        required: data.required ?? false,
        isPrimary: data.isPrimary ?? false,
      });
    }
  }
  return slots;
}

export interface ValidationError {
  /** The slot the error refers to, when applicable. Some errors are workflow-level. */
  slotNodeId?: string;
  reason: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

/**
 * The shape of composer state that the validator inspects.
 * Kept minimal so this module doesn't need to know about Zustand or
 * `useProjectStore`.
 */
export interface ComposerInputState {
  /** Free text the user typed into the composer textarea. */
  text: string;
  /** Ordered list of @-mentioned references with their resolved type. */
  referencedAssets: { id: string; name: string; type: "image" | "video" | "music" | "file" }[];
}

/**
 * Validate that `state` satisfies every required slot in `slots`. Any
 * `required: false` slot is allowed to remain empty.
 *
 * Rules:
 *   - Required text slot → composer text must be non-empty.
 *   - Required image slot → at least one image-typed chip per required slot.
 *   - Required video slot → at least one video-typed chip per required slot.
 *   - Extra chips of the right type are allowed (extras are ignored at
 *     bind time); chips of the *wrong* type for the workflow surface as
 *     a single workflow-level warning so the user can fix the mismatch.
 */
export function validateComposerInputs(
  slots: InputSlot[],
  state: ComposerInputState
): ValidationResult {
  const errors: ValidationError[] = [];

  const requiredTextSlots = slots.filter((s) => s.kind === "text" && s.required);
  const requiredImageSlots = slots.filter((s) => s.kind === "image" && s.required);
  const requiredVideoSlots = slots.filter((s) => s.kind === "video" && s.required);

  // Text — single composer textarea today; we treat the first required
  // text slot as the binding target. Multi-text workflows aren't fully
  // supported in v1; flag them explicitly so the user knows.
  if (requiredTextSlots.length > 1) {
    errors.push({
      reason: `This workflow has ${requiredTextSlots.length} required text inputs, but the composer only fills one. Mark all but one as optional, or extend the composer.`,
    });
  } else if (requiredTextSlots.length === 1 && state.text.trim() === "") {
    errors.push({
      slotNodeId: requiredTextSlots[0].nodeId,
      reason: `"${requiredTextSlots[0].label}" is required — type a prompt above.`,
    });
  }

  // Image — count chips of type "image" against required image slots.
  const imageChips = state.referencedAssets.filter((a) => a.type === "image");
  if (requiredImageSlots.length > imageChips.length) {
    const missing = requiredImageSlots.length - imageChips.length;
    errors.push({
      reason: `Workflow needs ${requiredImageSlots.length} image input${requiredImageSlots.length === 1 ? "" : "s"} (${missing} still missing). Use @ to attach ${missing === 1 ? "another image" : `${missing} more images`}.`,
    });
  }

  // Video — same shape as image.
  const videoChips = state.referencedAssets.filter((a) => a.type === "video");
  if (requiredVideoSlots.length > videoChips.length) {
    const missing = requiredVideoSlots.length - videoChips.length;
    errors.push({
      reason: `Workflow needs ${requiredVideoSlots.length} video input${requiredVideoSlots.length === 1 ? "" : "s"} (${missing} still missing). Use @ to attach ${missing === 1 ? "another video" : `${missing} more videos`}.`,
    });
  }

  // Wrong-type chips (e.g. video attached to an image-only workflow) —
  // surface as a single warning so the user knows extras will be ignored.
  const acceptsImage = slots.some((s) => s.kind === "image");
  const acceptsVideo = slots.some((s) => s.kind === "video");
  for (const ref of state.referencedAssets) {
    if (ref.type === "image" && !acceptsImage) {
      errors.push({
        reason: `Image "${ref.name}" doesn't fit any input slot in this workflow. Remove it or pick a different workflow.`,
      });
      break;
    }
    if (ref.type === "video" && !acceptsVideo) {
      errors.push({
        reason: `Video "${ref.name}" doesn't fit any input slot in this workflow. Remove it or pick a different workflow.`,
      });
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Build the runtime inputs map from a composer state + the workflow's
 * slot list. Binds chips to slots in declaration order: the i-th image
 * chip fills the i-th image slot, etc. Optional slots that aren't filled
 * are simply omitted from the inputs map (the orchestrator handles
 * "no upstream value" the same as it does for source nodes generally).
 *
 * Caller should validate first; this function trusts the inputs are
 * already in shape.
 */
export function buildRuntimeInputs(
  slots: InputSlot[],
  state: ComposerInputState,
  projectId: string
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const textSlots = slots.filter((s) => s.kind === "text");
  if (textSlots.length > 0 && state.text.trim() !== "") {
    inputs[textSlots[0].nodeId] = state.text;
  }
  const imageSlots = slots.filter((s) => s.kind === "image");
  const imageChips = state.referencedAssets.filter((a) => a.type === "image");
  for (let i = 0; i < imageSlots.length; i++) {
    if (imageChips[i]) {
      inputs[imageSlots[i].nodeId] = {
        assetId: imageChips[i].id,
        projectId,
      };
    }
  }
  const videoSlots = slots.filter((s) => s.kind === "video");
  const videoChips = state.referencedAssets.filter((a) => a.type === "video");
  for (let i = 0; i < videoSlots.length; i++) {
    if (videoChips[i]) {
      inputs[videoSlots[i].nodeId] = {
        assetId: videoChips[i].id,
        projectId,
      };
    }
  }
  return inputs;
}
