/**
 * Video Input — accepts a video asset reference at run time.
 *
 * Use cases: video-edit / video-continuation / video-to-video workflows
 * where the user provides an input clip and the ComfyUI endpoint
 * transforms it (LTX video edit, frame interpolation, motion transfer,
 * scene continuation, etc.).
 *
 * In project mode the composer's @-mention chip flows in as `inputs.value`.
 * In test mode the user pins a specific asset via `data.testAssetRef` on
 * the node — required when `data.required === true`.
 *
 * Output is a structured asset reference `{ assetId, projectId }` that
 * downstream nodes (the ComfyUI executor) use to upload the video bytes
 * to ComfyUI's input directory and write the resulting filename into the
 * patched workflow_api.json.
 *
 * Color: orange to match the ComfyUI node's accent — visually signals
 * "input feeding ComfyUI". Image Input uses cyan (matching image data
 * elsewhere); for video we picked node identity over data convention.
 *
 * `sanitizeForExport` strips `testAssetRef` because asset IDs are
 * machine-local — the recipient's studio won't have the same assets.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface VideoInputData extends BaseNodeData {
  kind: "videoInput";
  isPrimary?: boolean;
  /** Test-mode pin: which asset (in which project) to use when running with no project context. */
  testAssetRef?: { projectId: string; assetId: string };
  required?: boolean;
  /** Future: distinguish between init / reference / motion-source roles. Free-form for now. */
  inputRole?: "reference" | "init" | "source";
}

export const manifest: NodeManifest<VideoInputData> = {
  kind: "videoInput",
  displayName: "Video Input",
  description: "Video input from composer @-mention or test-asset pin.",
  category: "source",
  accent: "orange",
  icon: "Video",
  inputs: [],
  outputs: [{ id: "output", label: "video", type: "video" }],
  defaultData: () => ({
    kind: "videoInput",
    label: "Video Input",
    inputRole: "reference",
    required: false,
  }),
  sanitizeForExport: (data) => ({
    ...data,
    // Asset IDs are local to the source studio — strip on export.
    testAssetRef: undefined,
  }),
  executable: true,
};
