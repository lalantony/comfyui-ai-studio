/**
 * resumeService — exercises the validation gates and the happy path.
 *
 * The runtime itself is end-to-end tested elsewhere (`runtime.test.ts`,
 * `comfyui/executor.test.ts`); these tests focus on the validation
 * surface specific to resume:
 *   - status must be terminal-but-not-success
 *   - workflow must still exist + match the parent's hash
 *   - asset references in seeded outputs must still resolve
 *   - test-mode runs are explicitly rejected
 *
 * `startRun` is invoked at the end of each happy-path case but we don't
 * wait for the new run to finish — we just assert the right runId is
 * returned and the parent run id is recorded for traceability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import { createProject } from "../projectService";
import { createWorkflow } from "../workflowService";
import { createAsset } from "../assetService";
import {
  ensureDir,
  getRunDir,
  getRunFile,
  writeJson,
} from "../storage";
import { __resetSeqForTests, readRunFromDisk } from "./runStore";
import { resumeRun } from "./resumeService";
import { computeWorkflowHash } from "./runtime";
import {
  __clearExecutorsForTests,
  registerExecutor,
} from "../plugins/executorRegistry";
import { registerManifest } from "@/lib/plugins/manifestRegistry";
import type { Workflow, WorkflowRun } from "@/types";

async function reregisterBuiltins(): Promise<void> {
  await import("../plugins/registerBuiltinExecutors");
}

function makeRun(
  partial: Partial<WorkflowRun> & {
    id: string;
    projectId: string;
    workflowId: string;
  }
): WorkflowRun {
  return {
    id: partial.id,
    workflowId: partial.workflowId,
    projectId: partial.projectId,
    mode: "project",
    status: "failed",
    inputs: {},
    startedAt: new Date().toISOString(),
    outputAssetIds: [],
    nodeStates: { n1: "success", n2: "failed" },
    nodeOutputs: { n1: { output: { text: "hello" } } },
    ...partial,
  };
}

async function persistRun(run: WorkflowRun): Promise<void> {
  await ensureDir(getRunDir(run.projectId, run.id));
  await writeJson(getRunFile(run.projectId, run.id), run);
}

const noopManifest = (kind: string) => ({
  kind,
  displayName: kind,
  description: `${kind} executor for resumeService tests`,
  category: "utility" as const,
  accent: "purple" as const,
  icon: "Cpu",
  inputs: [
    { id: "input", label: "in", type: "text" as const, required: false },
  ],
  outputs: [{ id: "output", label: "out", type: "text" as const }],
  defaultData: () => ({ kind, label: kind }),
  executable: true,
});

async function makeChainedWorkflow(): Promise<Workflow> {
  registerManifest(noopManifest("noop1"));
  registerManifest(noopManifest("noop2"));
  registerExecutor("noop1", {
    async execute() {
      return { output: { text: "from-n1" } };
    },
  });
  registerExecutor("noop2", {
    async execute(_ctx, inputs) {
      // Echo upstream so we can assert seeded values flow through.
      return { output: { text: `n2:${JSON.stringify(inputs.input ?? null)}` } };
    },
  });
  return createWorkflow({
    name: "Chain",
    description: "",
    type: "image",
    tags: [],
    nodes: [
      {
        id: "n1",
        type: "noop1",
        position: { x: 0, y: 0 },
        data: { kind: "noop1", label: "noop1" },
      },
      {
        id: "n2",
        type: "noop2",
        position: { x: 100, y: 0 },
        data: { kind: "noop2", label: "noop2" },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "n1",
        target: "n2",
        sourceHandle: "output",
        targetHandle: "input",
      },
    ],
  });
}

describe("resumeService — validation gates", () => {
  useTmpStudioDir();

  beforeEach(() => {
    __resetSeqForTests();
    __clearExecutorsForTests();
  });

  afterEach(async () => {
    __clearExecutorsForTests();
    vi.clearAllMocks();
    await reregisterBuiltins();
  });

  it("rejects unknown run id", async () => {
    await expect(resumeRun("run-does-not-exist")).rejects.toMatchObject({
      name: "ResumeError",
      code: "run_not_found",
    });
  });

  it("rejects a run that's still running", async () => {
    const project = await createProject({
      id: "p-running",
      name: "P",
      description: "",
      tags: [],
    });
    const wf = await makeChainedWorkflow();
    const run = makeRun({
      id: "run-running",
      projectId: project.id,
      workflowId: wf.id,
      status: "running",
      workflowHash: computeWorkflowHash(wf),
    });
    await persistRun(run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "not_resumable_status",
    });
  });

  it("rejects a successful run (resume only applies to failed/cancelled)", async () => {
    const project = await createProject({
      id: "p-success",
      name: "P",
      description: "",
      tags: [],
    });
    const wf = await makeChainedWorkflow();
    const run = makeRun({
      id: "run-success",
      projectId: project.id,
      workflowId: wf.id,
      status: "succeeded",
      workflowHash: computeWorkflowHash(wf),
    });
    await persistRun(run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "not_resumable_status",
    });
  });

  it("rejects a test-mode run", async () => {
    const wf = await makeChainedWorkflow();
    const run: WorkflowRun = {
      id: "run-test",
      workflowId: wf.id,
      projectId: null,
      mode: "test",
      status: "failed",
      inputs: {},
      startedAt: new Date().toISOString(),
      outputAssetIds: [],
      nodeStates: { n1: "success", n2: "failed" },
      nodeOutputs: { n1: { output: { text: "x" } } },
      workflowHash: computeWorkflowHash(wf),
    };
    await ensureDir(getRunDir(null, run.id));
    await writeJson(getRunFile(null, run.id), run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "test_mode_unsupported",
    });
  });

  it("rejects when the workflow has been deleted", async () => {
    const project = await createProject({
      id: "p-wfgone",
      name: "P",
      description: "",
      tags: [],
    });
    const run = makeRun({
      id: "run-wfgone",
      projectId: project.id,
      workflowId: "wf-does-not-exist",
      workflowHash: "stale-hash",
    });
    await persistRun(run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "workflow_deleted",
    });
  });

  it("rejects when the workflow hash has changed", async () => {
    const project = await createProject({
      id: "p-edited",
      name: "P",
      description: "",
      tags: [],
    });
    const wf = await makeChainedWorkflow();
    const run = makeRun({
      id: "run-edited",
      projectId: project.id,
      workflowId: wf.id,
      workflowHash: "definitely-not-the-current-hash",
    });
    await persistRun(run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "workflow_changed",
    });
  });

  it("rejects when nodeOutputs are missing (legacy run)", async () => {
    const project = await createProject({
      id: "p-legacy",
      name: "P",
      description: "",
      tags: [],
    });
    const wf = await makeChainedWorkflow();
    const run = makeRun({
      id: "run-legacy",
      projectId: project.id,
      workflowId: wf.id,
      workflowHash: computeWorkflowHash(wf),
    });
    delete run.nodeOutputs;
    await persistRun(run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "no_node_outputs",
    });
  });

  it("rejects when a referenced upstream asset has been deleted", async () => {
    const project = await createProject({
      id: "p-asset",
      name: "P",
      description: "",
      tags: [],
    });
    const wf = await makeChainedWorkflow();
    const run = makeRun({
      id: "run-asset-gone",
      projectId: project.id,
      workflowId: wf.id,
      workflowHash: computeWorkflowHash(wf),
      nodeOutputs: {
        n1: {
          output: {
            assetId: "asset-deleted-id",
            projectId: project.id,
            type: "image",
          },
        },
      },
    });
    await persistRun(run);
    await expect(resumeRun(run.id)).rejects.toMatchObject({
      code: "asset_missing",
    });
  });
});

describe("resumeService — happy path", () => {
  useTmpStudioDir();

  beforeEach(() => {
    __resetSeqForTests();
    __clearExecutorsForTests();
  });

  afterEach(async () => {
    __clearExecutorsForTests();
    vi.clearAllMocks();
    await reregisterBuiltins();
  });

  it("seeds the upstream output and starts a new run that records resumedFromRunId", async () => {
    const project = await createProject({
      id: "p-resume",
      name: "P",
      description: "",
      tags: [],
    });
    const wf = await makeChainedWorkflow();
    // Real on-disk asset so the AssetRef-existence check passes.
    const asset = await createAsset(project.id, {
      type: "image",
      name: "stage1.png",
      content: Buffer.from("PNG"),
      extension: "png",
      source: "workflow",
    });
    const parent = makeRun({
      id: "run-resume-parent",
      projectId: project.id,
      workflowId: wf.id,
      workflowHash: computeWorkflowHash(wf),
      nodeStates: { n1: "success", n2: "failed" },
      nodeOutputs: {
        n1: {
          output: {
            assetId: asset.id,
            projectId: project.id,
            type: "image",
          },
        },
      },
    });
    await persistRun(parent);

    const result = await resumeRun(parent.id);
    expect(result.fromNodeId).toBe("n2");
    expect(result.reusedNodeIds).toEqual(["n1"]);
    expect(result.runId).toMatch(/^run-/);

    // Wait for the resumed run to reach terminal state — otherwise the
    // tmp dir cleanup races with run.json writes ("ENOTEMPTY").
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const final = await readRunFromDisk(project.id, result.runId);
        if (final && ["succeeded", "failed", "cancelled"].includes(final.status)) break;
      } catch {
        /* mid-write race; retry */
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    // Verify the newly-spawned run's run.json points back at the parent
    // and pre-populates n1 as success.
    const newRunFile = path.join(
      getRunDir(project.id, result.runId),
      "run.json"
    );
    const raw = await fs.readFile(newRunFile, "utf8");
    const persisted = JSON.parse(raw) as WorkflowRun;
    expect(persisted.resumedFromRunId).toBe(parent.id);
    expect(persisted.nodeStates.n1).toBe("success");
  });
});
