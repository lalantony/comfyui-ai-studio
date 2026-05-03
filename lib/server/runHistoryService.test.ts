/**
 * Run history service tests.
 *
 * Covers list ordering, malformed-run skipping, workflow-name lookup
 * (including deleted workflows), cross-project isolation, and detail
 * read-back of events.ndjson.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import {
  getProjectRunDetail,
  listProjectRuns,
  RunNotFoundError,
} from "./runHistoryService";
import {
  getProjectDir,
  getRunDir,
  getRunFile,
  ensureDir,
  writeJson,
} from "./storage";
import { createProject } from "./projectService";
import { createWorkflow } from "./workflowService";
import * as eventBus from "./workflow/eventBus";
import { __resetSeqForTests, emitEvent, initRun } from "./workflow/runStore";
import type { WorkflowRun } from "@/types";

function makeRun(overrides: Partial<WorkflowRun> & { id: string; projectId: string }): WorkflowRun {
  return {
    id: overrides.id,
    workflowId: "wf-test",
    projectId: overrides.projectId,
    mode: "project",
    status: "succeeded",
    inputs: {},
    startedAt: new Date().toISOString(),
    outputAssetIds: [],
    nodeStates: {},
    ...overrides,
  };
}

async function writeRunOnDisk(run: WorkflowRun): Promise<void> {
  await ensureDir(getRunDir(run.projectId, run.id));
  await writeJson(getRunFile(run.projectId, run.id), run);
}

describe("runHistoryService — listProjectRuns", () => {
  useTmpStudioDir();

  beforeEach(() => {
    __resetSeqForTests();
  });

  afterEach(() => {
    eventBus.clear("run-1");
    eventBus.clear("run-2");
    eventBus.clear("run-3");
  });

  it("returns an empty list when the project has no runs", async () => {
    const project = await createProject({ id: "p-empty", name: "Empty", description: "", tags: [] });
    const runs = await listProjectRuns(project.id);
    expect(runs).toEqual([]);
  });

  it("returns runs newest-first by startedAt", async () => {
    const project = await createProject({ id: "p-order", name: "P", description: "", tags: [] });
    await writeRunOnDisk(
      makeRun({ id: "run-1", projectId: project.id, startedAt: "2026-01-01T00:00:00.000Z" })
    );
    await writeRunOnDisk(
      makeRun({ id: "run-2", projectId: project.id, startedAt: "2026-03-01T00:00:00.000Z" })
    );
    await writeRunOnDisk(
      makeRun({ id: "run-3", projectId: project.id, startedAt: "2026-02-01T00:00:00.000Z" })
    );
    const runs = await listProjectRuns(project.id);
    expect(runs.map((r) => r.id)).toEqual(["run-2", "run-3", "run-1"]);
  });

  it("hydrates the workflow name when the workflow exists", async () => {
    const project = await createProject({ id: "p-wfname", name: "P", description: "", tags: [] });
    const wf = await createWorkflow({
      name: "My Workflow",
      type: "image",
      description: "",
      tags: [],
    });
    await writeRunOnDisk(
      makeRun({
        id: "run-1",
        projectId: project.id,
        workflowId: wf.id,
      })
    );
    const runs = await listProjectRuns(project.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].workflowName).toBe("My Workflow");
  });

  it("returns workflowName: null for runs whose workflow was deleted", async () => {
    const project = await createProject({ id: "p-wfgone", name: "P", description: "", tags: [] });
    await writeRunOnDisk(
      makeRun({
        id: "run-1",
        projectId: project.id,
        workflowId: "wf-does-not-exist",
      })
    );
    const runs = await listProjectRuns(project.id);
    expect(runs[0].workflowName).toBeNull();
  });

  it("skips a run with malformed run.json instead of failing the whole list", async () => {
    const project = await createProject({ id: "p-malformed", name: "P", description: "", tags: [] });
    await writeRunOnDisk(
      makeRun({ id: "run-good", projectId: project.id, startedAt: "2026-01-01T00:00:00.000Z" })
    );
    // Hand-craft a corrupt run.json
    const badDir = path.join(getProjectDir(project.id), "runs", "run-bad");
    await ensureDir(badDir);
    await fs.writeFile(path.join(badDir, "run.json"), "{ this is not json", "utf8");

    const runs = await listProjectRuns(project.id);
    expect(runs.map((r) => r.id)).toEqual(["run-good"]);
  });

  it("does not leak runs from sibling projects", async () => {
    const a = await createProject({ id: "p-a", name: "A", description: "", tags: [] });
    const b = await createProject({ id: "p-b", name: "B", description: "", tags: [] });
    await writeRunOnDisk(makeRun({ id: "run-a", projectId: a.id }));
    await writeRunOnDisk(makeRun({ id: "run-b", projectId: b.id }));
    const aRuns = await listProjectRuns(a.id);
    const bRuns = await listProjectRuns(b.id);
    expect(aRuns.map((r) => r.id)).toEqual(["run-a"]);
    expect(bRuns.map((r) => r.id)).toEqual(["run-b"]);
  });
});

describe("runHistoryService — getProjectRunDetail", () => {
  useTmpStudioDir();

  beforeEach(() => {
    __resetSeqForTests();
  });

  afterEach(() => {
    eventBus.clear("run-detail");
  });

  it("returns run + replayed events from disk", async () => {
    const project = await createProject({ id: "p-detail", name: "P", description: "", tags: [] });
    const run = makeRun({ id: "run-detail", projectId: project.id });
    await initRun(run);
    await emitEvent("run-detail", {
      type: "node.started",
      runId: "run-detail",
      nodeId: "n1",
    });
    await emitEvent("run-detail", {
      type: "node.completed",
      runId: "run-detail",
      nodeId: "n1",
    });

    const detail = await getProjectRunDetail(project.id, "run-detail");
    expect(detail.run.id).toBe("run-detail");
    expect(detail.events.map((e) => e.type)).toEqual([
      "node.started",
      "node.completed",
    ]);
  });

  it("throws RunNotFoundError when the run id is unknown", async () => {
    const project = await createProject({ id: "p-unknown", name: "P", description: "", tags: [] });
    await expect(
      getProjectRunDetail(project.id, "run-does-not-exist")
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("refuses to serve a run from another project even if the runId is valid", async () => {
    const a = await createProject({ id: "p-cross-a", name: "A", description: "", tags: [] });
    const b = await createProject({ id: "p-cross-b", name: "B", description: "", tags: [] });
    await writeRunOnDisk(makeRun({ id: "run-cross", projectId: a.id }));
    await expect(
      getProjectRunDetail(b.id, "run-cross")
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("tolerates a missing events.ndjson (init crashed before any emit)", async () => {
    const project = await createProject({ id: "p-noevents", name: "P", description: "", tags: [] });
    const run = makeRun({ id: "run-no-events", projectId: project.id });
    await ensureDir(getRunDir(project.id, run.id));
    await writeJson(getRunFile(project.id, run.id), run);
    // Intentionally do NOT touch getRunEventsFile.

    const detail = await getProjectRunDetail(project.id, "run-no-events");
    expect(detail.events).toEqual([]);
  });
});
