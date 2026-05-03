/**
 * Image Input — accepts an asset reference at run time.
 *
 * In project mode the composer's @-mention chip flows in as `inputs.value`.
 * In test mode the user pins a specific asset via `data.testAssetRef` on
 * the node — a hard requirement when `data.required === true`.
 *
 * Output is a structured asset reference `{ assetId, projectId }` that
 * downstream nodes (especially ComfyUI) can use to fetch the binary.
 *
 * `sanitizeForExport` strips `testAssetRef` because asset IDs are
 * machine-local — the recipient's studio won't have the same assets.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface ImageInputData extends BaseNodeData {
  kind: "imageInput";
  isPrimary?: boolean;
  /** Test-mode pin: which asset (in which project) to use when running with no project context. */
  testAssetRef?: { projectId: string; assetId: string };
  required?: boolean;
  inputRole?: "reference" | "init" | "mask";
}

export const manifest: NodeManifest<ImageInputData> = {
  kind: "imageInput",
  displayName: "Image Input",
  description: "Image input from composer @-mention or test-asset pin.",
  category: "source",
  accent: "cyan",
  icon: "Image",
  inputs: [],
  outputs: [{ id: "output", label: "image", type: "image" }],
  defaultData: () => ({
    kind: "imageInput",
    label: "Image Input",
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
