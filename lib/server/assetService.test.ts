import { describe, expect, it } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import { createProject } from "./projectService";
import {
  AssetNotFoundError,
  createAsset,
  getAsset,
  getAssetSidecar,
  renameAsset,
} from "./assetService";

function buf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

describe("assetService", () => {
  // useTmpStudioDir gives every test its own isolated STUDIO_DATA_DIR
  // so we can exercise real fs writes without leaking across tests.
  const _tmp = useTmpStudioDir();
  void _tmp;

  describe("createAsset", () => {
    it("records producedByNodeId on the sidecar when supplied", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const asset = await createAsset(project.id, {
        type: "image",
        name: "stage1.png",
        content: buf("img-bytes"),
        extension: "png",
        source: "workflow",
        workflowRunId: "run-abc",
        producedByNodeId: "comfyui-1",
      });

      const sidecar = await getAssetSidecar(project.id, asset.id);
      expect(sidecar).not.toBeNull();
      expect(sidecar!.producedByNodeId).toBe("comfyui-1");
      expect(sidecar!.workflowRunId).toBe("run-abc");
      expect(sidecar!.source).toBe("workflow");
    });

    it("leaves producedByNodeId null when not supplied (e.g. user upload)", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const asset = await createAsset(project.id, {
        type: "image",
        name: "uploaded.png",
        content: buf("img-bytes"),
        extension: "png",
        source: "upload",
      });

      const sidecar = await getAssetSidecar(project.id, asset.id);
      expect(sidecar!.producedByNodeId).toBeNull();
    });
  });

  describe("renameAsset", () => {
    it("updates the sidecar name without rewriting the blob", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const asset = await createAsset(project.id, {
        type: "image",
        name: "original.png",
        content: buf("img-bytes"),
        extension: "png",
        source: "workflow",
      });
      const before = await getAssetSidecar(project.id, asset.id);

      const renamed = await renameAsset(project.id, asset.id, "renamed.png");
      const after = await getAssetSidecar(project.id, asset.id);

      expect(renamed.name).toBe("renamed.png");
      expect(after!.name).toBe("renamed.png");
      // Blob hash + createdAt are stable — only the display name changed.
      expect(after!.contentHash).toBe(before!.contentHash);
      expect(after!.createdAt).toBe(before!.createdAt);
    });

    it("returns the existing asset when the new name matches the old", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const asset = await createAsset(project.id, {
        type: "image",
        name: "same.png",
        content: buf("img-bytes"),
        extension: "png",
        source: "workflow",
      });
      const result = await renameAsset(project.id, asset.id, "same.png");
      expect(result.name).toBe("same.png");
    });

    it("rejects empty / whitespace-only names", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const asset = await createAsset(project.id, {
        type: "image",
        name: "x.png",
        content: buf("x"),
        extension: "png",
        source: "workflow",
      });
      await expect(renameAsset(project.id, asset.id, "")).rejects.toThrow(/empty/);
      await expect(renameAsset(project.id, asset.id, "   ")).rejects.toThrow(/empty/);
    });

    it("trims whitespace around the new name", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const asset = await createAsset(project.id, {
        type: "image",
        name: "x.png",
        content: buf("x"),
        extension: "png",
        source: "workflow",
      });
      const renamed = await renameAsset(project.id, asset.id, "  trimmed.png  ");
      expect(renamed.name).toBe("trimmed.png");
    });

    it("throws AssetNotFoundError for unknown ids", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      await expect(
        renameAsset(project.id, "asset-does-not-exist", "anything.png")
      ).rejects.toBeInstanceOf(AssetNotFoundError);
    });

    it("does not affect the asset's url/thumbnail endpoints", async () => {
      const project = await createProject({ id: `proj-${Math.random().toString(36).slice(2)}`, name: "P", description: "", tags: [] });
      const original = await createAsset(project.id, {
        type: "image",
        name: "x.png",
        content: buf("x"),
        extension: "png",
        source: "workflow",
      });
      const renamed = await renameAsset(project.id, original.id, "y.png");
      const fetched = await getAsset(project.id, original.id);
      expect(renamed.url).toBe(original.url);
      expect(fetched!.url).toBe(original.url);
    });
  });
});
