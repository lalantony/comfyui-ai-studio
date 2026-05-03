/**
 * Image Input executor — emits an asset reference for downstream nodes.
 *
 * Resolution order:
 *   1. Upstream `inputs.value` carrying `{ assetId, projectId }` (composer-attached asset)
 *   2. `data.testAssetRef` — node-local pin (works in both modes; carries its own project)
 *   3. null — fail clearly if `data.required`
 *
 * Loose forms supported: a bare assetId string from upstream is treated
 * as belonging to the run's project (only valid in project mode where
 * `ctx.projectId` is set).
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import { getAssetSidecar } from "@/lib/server/assetService";
import type { ImageInputData } from "./manifest";

export const executor: NodeExecutor<ImageInputData> = {
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
          ? `Required image input "${data.label}" was not provided.`
          : `Required image input "${data.label}" needs a test asset. Set "Test asset" on the node, or run from a project.`;
        throw new Error(hint);
      }
      return { output: null };
    }

    // Existence check: a test-pinned ref can dangle when the underlying
    // asset is deleted from its project later. The downstream consumer
    // (ComfyUI executor) would otherwise fail with "Could not read asset
    // bytes" — useful but generic. Failing here with a specific message
    // tells the user exactly which input + which assetId to fix.
    if (resolvedFromTestPin) {
      const sidecar = await getAssetSidecar(resolved.projectId, resolved.assetId);
      if (!sidecar) {
        throw new Error(
          `Image input "${data.label}" has a test asset pin pointing at a deleted asset (${resolved.assetId} in project ${resolved.projectId}). Re-pin a current asset on the node.`
        );
      }
    }

    return { output: resolved };
  },
};
