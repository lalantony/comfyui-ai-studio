/**
 * ComfyUI — calls a registered ComfyUI endpoint.
 *
 * The node's input handles are **dynamic**: they're derived from the
 * `ComfyEndpointInput[]` of the selected endpoint, not declared statically.
 * The manifest declares zero inputs; the Component renders them at render
 * time based on `data.endpointId`.
 *
 * `endpointId` is local to the source studio (each studio assigns its own
 * IDs to registered endpoints). `sanitizeForExport` clears it so the
 * importer is forced to re-bind to one of their own endpoints — which is
 * the only meaningful behavior since the source's endpoint won't exist
 * on the target machine.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface ComfyUINodeData extends BaseNodeData {
  kind: "comfyui";
  /** Selected endpoint id; null = unconfigured. The endpoint determines this node's input handles. */
  endpointId: string | null;
  /**
   * Auto-save the output as a project asset (project mode only). Defaults
   * to true — every stage of a multi-stage chain is visible in the gallery
   * as soon as it completes, downstream nodes consume an `AssetRef` instead
   * of raw bytes, and a partial-failure run leaves the successful stages
   * already saved. Set false to opt out (rare — typically only when the
   * user knows an explicit downstream SaveOutput will handle it). Ignored
   * in test mode (test runs never auto-promote — they keep raw bytes and
   * write outputs only via SaveOutput).
   */
  saveToProject?: boolean;
}

export const manifest: NodeManifest<ComfyUINodeData> = {
  kind: "comfyui",
  displayName: "ComfyUI",
  description: "Call a registered ComfyUI endpoint. Pick which one on the node.",
  category: "comfyui",
  accent: "orange",
  icon: "Boxes",
  // Dynamic handles — Component renders them per endpoint binding.
  inputs: [],
  outputs: [{ id: "output", label: "output", type: "any" }],
  defaultData: () => ({
    kind: "comfyui",
    label: "ComfyUI",
    endpointId: null,
    saveToProject: true,
  }),
  sanitizeForExport: (data) => ({
    ...data,
    // Endpoint IDs are local — the importer re-binds to their own endpoints.
    endpointId: null,
  }),
  executable: true,
};
