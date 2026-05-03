import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import { createProject, recountProject } from "@/lib/server/projectService";
import {
  createAsset,
  getAsset,
  getAssetSidecar,
  listAssets,
} from "@/lib/server/assetService";
import { getRunOutputsDir } from "@/lib/server/storage";
import type { ExecutorContext } from "@/lib/server/plugins/executorRegistry";
import type { SaveOutputData } from "./manifest";
import { executor } from "./executor";

function buf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

function makeCtx(over: Partial<ExecutorContext>): ExecutorContext {
  return {
    runId: "run-test",
    nodeId: "save-1",
    projectId: null,
    workflowId: "wf-1",
    mode: "test",
    abortSignal: new AbortController().signal,
    outputsDir: "",
    emit: async () => {},
    ...over,
  };
}

const data: SaveOutputData = {
  kind: "saveOutput",
  label: "Save Output",
  filename: "auto",
  promoteToAssets: true,
};

describe("SaveOutput executor — AssetRef rename semantic", () => {
  // Fresh STUDIO_DATA_DIR per test — this exercises real fs (sidecar +
  // blob pool) so the rename-vs-duplicate behaviour is verified at the
  // structural level, not just by stubbed return values.
  const _tmp = useTmpStudioDir();
  void _tmp;

  it("project mode + same-project AssetRef: renames in place, no duplicate gallery entry", async () => {
    const project = await createProject({
      id: "proj-rename",
      name: "P",
      description: "",
      tags: [],
    });
    // An upstream ComfyUI node already auto-saved this asset.
    const upstream = await createAsset(project.id, {
      type: "image",
      name: "stage1.png",
      content: buf("img"),
      extension: "png",
      source: "workflow",
      workflowRunId: "run-x",
      producedByNodeId: "comfyui-1",
    });
    await recountProject(project.id);

    // SaveOutput receives the AssetRef + has a custom filename to apply.
    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project" }),
      {
        input: { assetId: upstream.id, projectId: project.id, type: "image" },
      },
      { ...data, filename: "renamed-final" }
    );

    expect(result.savedAssetId).toBe(upstream.id);

    // Crucially: the gallery still contains exactly ONE asset — same id,
    // same blob — the only thing that changed is the display name.
    const all = await listAssets(project.id);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(upstream.id);
    expect(all[0].name).toMatch(/^renamed-final/);
  });

  it("project mode + same-project AssetRef + auto filename: asset is left untouched", async () => {
    const project = await createProject({
      id: "proj-untouched",
      name: "P",
      description: "",
      tags: [],
    });
    const upstream = await createAsset(project.id, {
      type: "image",
      name: "original.png",
      content: buf("img"),
      extension: "png",
      source: "workflow",
    });

    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project" }),
      { input: { assetId: upstream.id, projectId: project.id, type: "image" } },
      { ...data, filename: "auto" }
    );

    expect(result.savedAssetId).toBe(upstream.id);
    const after = await getAssetSidecar(project.id, upstream.id);
    expect(after!.name).toBe("original.png");
    expect(await listAssets(project.id)).toHaveLength(1);
  });

  it("project mode + cross-project AssetRef: copies into the active project", async () => {
    const sourceProject = await createProject({
      id: "proj-source",
      name: "S",
      description: "",
      tags: [],
    });
    const targetProject = await createProject({
      id: "proj-target",
      name: "T",
      description: "",
      tags: [],
    });
    const sourceAsset = await createAsset(sourceProject.id, {
      type: "image",
      name: "stage1.png",
      content: buf("img"),
      extension: "png",
      source: "workflow",
    });

    const result = await executor.execute(
      makeCtx({ projectId: targetProject.id, mode: "project" }),
      {
        input: {
          assetId: sourceAsset.id,
          projectId: sourceProject.id,
          type: "image",
        },
      },
      data
    );

    // Cross-project: we want the bytes to land in the target project, so a
    // *new* asset gets created there. Source project is untouched.
    const targetAssets = await listAssets(targetProject.id);
    expect(targetAssets).toHaveLength(1);
    expect(targetAssets[0].id).not.toBe(sourceAsset.id);
    expect(result.savedAssetId).toBe(targetAssets[0].id);

    const sourceAssets = await listAssets(sourceProject.id);
    expect(sourceAssets).toHaveLength(1);
    expect(sourceAssets[0].id).toBe(sourceAsset.id);
  });

  it("test mode + AssetRef: materialises bytes into the run outputs dir", async () => {
    // We need a project for the upstream asset to live in (createAsset
    // requires a projectId), but the SaveOutput run is test-mode so no
    // promotion to *any* project happens — bytes go to the test outputs
    // directory only.
    const project = await createProject({
      id: "proj-host",
      name: "H",
      description: "",
      tags: [],
    });
    const upstream = await createAsset(project.id, {
      type: "image",
      name: "frame.png",
      content: buf("FRAME-DATA"),
      extension: "png",
      source: "workflow",
    });

    const outputsDir = getRunOutputsDir(null, "run-test-mode");
    await fs.mkdir(outputsDir, { recursive: true });

    const result = await executor.execute(
      makeCtx({
        projectId: null,
        mode: "test",
        outputsDir,
        runId: "run-test-mode",
      }),
      { input: { assetId: upstream.id, projectId: project.id, type: "image" } },
      data
    );

    expect(result.savedFile).toBeDefined();
    const written = await fs.readFile(
      path.join(outputsDir, (result.savedFile as { filename: string }).filename)
    );
    expect(written.toString("utf8")).toBe("FRAME-DATA");
    // Test mode does NOT promote to the source project either — the source
    // asset count is unchanged.
    expect(await listAssets(project.id)).toHaveLength(1);
  });

  it("falls back gracefully when AssetRef points at a missing asset", async () => {
    const project = await createProject({
      id: "proj-missing",
      name: "M",
      description: "",
      tags: [],
    });
    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project" }),
      {
        input: {
          assetId: "asset-does-not-exist",
          projectId: project.id,
          type: "image",
        },
      },
      { ...data, filename: "renamed" }
    );
    expect(result.savedAssetId).toBeNull();
  });

  it("legacy bytes path still works (back-compat with bytes-emitting executors)", async () => {
    const project = await createProject({
      id: "proj-bytes",
      name: "B",
      description: "",
      tags: [],
    });
    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project" }),
      {
        input: {
          bytes: buf("RAW"),
          mime: "image/png",
          name: "raw.png",
          type: "image",
        },
      },
      data
    );

    expect(typeof result.savedAssetId).toBe("string");
    const all = await listAssets(project.id);
    expect(all).toHaveLength(1);
    const fetched = await getAsset(project.id, all[0].id);
    expect(fetched!.name).toBe("raw.png");
  });
});
