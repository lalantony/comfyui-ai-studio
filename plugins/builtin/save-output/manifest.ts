/**
 * Save Output — promotes the upstream value to a sink.
 *
 * Project mode → creates a project asset (sidecar + blob) tagged with
 * `source: "workflow"` and the run id.
 * Test mode    → writes to the run's `outputs/` dir; surfaced via the
 * test-run output panel and the `/api/workflow-runs/[id]/outputs/[filename]`
 * endpoint.
 *
 * Accepts upstream values in several shapes (string, `{bytes, mime, name?}`,
 * `{url, type?, name?}`) — see executor for the dispatch order.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface SaveOutputData extends BaseNodeData {
  kind: "saveOutput";
  filename?: string;
  promoteToAssets: boolean;
}

export const manifest: NodeManifest<SaveOutputData> = {
  kind: "saveOutput",
  displayName: "Save Output",
  description:
    "Optional. ComfyUI nodes auto-save in both project and test mode now — most chains don't need this. Useful for primitive outputs (string from LLM, fetched URLs) or for renaming a ComfyUI output to a custom filename.",
  category: "utility",
  accent: "green",
  icon: "Save",
  inputs: [{ id: "input", label: "input", type: "any", required: true }],
  outputs: [],
  defaultData: () => ({
    kind: "saveOutput",
    label: "Save Output",
    filename: "auto",
    promoteToAssets: true,
  }),
  executable: true,
};
