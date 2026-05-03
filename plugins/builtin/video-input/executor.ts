/**
 * Video Input executor — emits an asset reference for downstream nodes.
 *
 * Mirrors the Image Input executor exactly; the only difference is the
 * error message wording (clearer for the user when something's wired
 * wrong). Returns `{ output: { assetId, projectId } }` on success — the
 * ComfyUI executor downstream uploads the bytes via `/upload/image`
 * (which accepts video files too) and writes the returned filename into
 * the patched workflow_api.json.
 *
 * Resolution order:
 *   1. Upstream `inputs.value` carrying `{ assetId, projectId }` (composer-attached)
 *   2. `data.testAssetRef` — node-local pin (works in both modes)
 *   3. null — fail clearly if `data.required`
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import { getAssetSidecar } from "@/lib/server/assetService";
import type { VideoInputData } from "./manifest";

export const executor: NodeExecutor<VideoInputData> = {
  async execute(ctx, inputs, data) {
    let resolved: { assetId: string; projectId: string } | null = null;
    let resolvedFromTestPin = false;

    if (
      inputs.value &&
      typeof inputs.value === "object" &&
      "assetId" in inputs.value &&
      "projectId" in inputs.value &&
      typeof (inputs.value as { assetId: unknown }).assetId === "string" &&
      typeof (inputs.value as { projectId: unknown }).projectId === "string"
    ) {
      const v = inputs.value as { assetId: string; projectId: string };
      resolved = { assetId: v.assetId, projectId: v.projectId };
    } else if (typeof inputs.value === "string" && ctx.projectId) {
      resolved = { assetId: inputs.value, projectId: ctx.projectId };
    } else if (data.testAssetRef && data.testAssetRef.assetId && data.testAssetRef.projectId) {
      resolved = {
        assetId: data.testAssetRef.assetId,
        projectId: data.testAssetRef.projectId,
      };
      resolvedFromTestPin = true;
    }

    if (!resolved) {
      if (data.required) {
        const hint = ctx.projectId
          ? `Required video input "${data.label}" was not provided.`
          : `Required video input "${data.label}" needs a test asset. Set "Test video" on the node, or run from a project.`;
        throw new Error(hint);
      }
      return { output: null };
    }

    // Existence check for a test-pinned ref — see image-input/executor.ts
    // for rationale. Specific error message lets the user fix the right
    // node without grepping through generic "Could not read asset bytes".
    if (resolvedFromTestPin) {
      const sidecar = await getAssetSidecar(resolved.projectId, resolved.assetId);
      if (!sidecar) {
        throw new Error(
          `Video input "${data.label}" has a test asset pin pointing at a deleted asset (${resolved.assetId} in project ${resolved.projectId}). Re-pin a current asset on the node.`
        );
      }
    }

    return { output: resolved };
  },
};
