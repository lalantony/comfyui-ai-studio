/**
 * Run history service — surfaces persisted runs for a project to the UI.
 *
 * Runs are written by `runStore.ts` under
 * `<dataDir>/projects/<projectId>/runs/<runId>/{run.json,events.ndjson,outputs/}`.
 * The orchestrator process is the only writer; this service is read-only
 * apart from the cosmetic workflow-name lookup.
 *
 * Why a separate module from `runStore.ts`:
 *   - `runStore.ts` is the runtime's persistence layer (in-memory cache,
 *     event emission, cancellation). It has no business knowing about
 *     run summaries or workflow names.
 *   - This module is the "history reader" — pure disk reads, used by the
 *     project page's Runs tab. Keeping it separate keeps the runtime's
 *     hot path small and the read-side easy to reason about.
 *
 * Sort order: newest first by `startedAt` (ISO strings sort lexicographically
 * the right way). Malformed `run.json` files are skipped with a console.warn
 * so a single corrupt run doesn't black-hole the whole list.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { RunEvent, RunSummary, WorkflowRun } from "@/types";
import {
  assertSafeId,
  getRunEventsFile,
  getRunFile,
  getRunsDir,
  pathExists,
  readJson,
} from "./storage";
import { getWorkflow } from "./workflowService";
import { readEventsFromDisk } from "./workflow/runStore";

/** Re-export for backwards-compatible ergonomics at server call sites. */
export type { RunSummary } from "@/types";

export interface RunDetail {
  run: WorkflowRun;
  events: RunEvent[];
  workflowName: string | null;
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

/**
 * List all runs for a project, newest first.
 *
 * Performance: reads every `run.json` from disk on every call. Fine for
 * the project counts the studio targets (hundreds, not thousands). If a
 * project ever crosses ~500 runs we should add an index file or paginate.
 * Logged in BACKLOG.md.
 */
export async function listProjectRuns(projectId: string): Promise<RunSummary[]> {
  assertSafeId(projectId);
  const runsDir = getRunsDir(projectId);
  if (!(await pathExists(runsDir))) return [];

  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runs: WorkflowRun[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const runFile = path.join(runsDir, e.name, "run.json");
    try {
      const run = await readJson<WorkflowRun>(runFile);
      runs.push(run);
    } catch (err) {
      console.warn(`[runHistoryService] skipping unreadable run ${e.name}:`, err);
    }
  }

  // Cache workflow lookups so a list of 50 runs sharing the same workflow
  // id only reads workflow.json once. Workflow lookups can fail (deleted)
  // — null sentinel distinguishes "not yet looked up" from "confirmed gone".
  const workflowNames = new Map<string, string | null>();
  const summaries: RunSummary[] = [];
  for (const run of runs) {
    if (!workflowNames.has(run.workflowId)) {
      try {
        const wf = await getWorkflow(run.workflowId);
        workflowNames.set(run.workflowId, wf?.name ?? null);
      } catch {
        workflowNames.set(run.workflowId, null);
      }
    }
    summaries.push({
      id: run.id,
      workflowId: run.workflowId,
      workflowName: workflowNames.get(run.workflowId) ?? null,
      status: run.status,
      mode: run.mode,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      error: run.error,
      outputAssetIds: run.outputAssetIds ?? [],
    });
  }

  // ISO strings sort lexicographically in chronological order — newest
  // first means descending.
  summaries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return summaries;
}

/**
 * Read full detail for a single run: the `WorkflowRun` snapshot plus the
 * complete event log replayed from `events.ndjson`. Throws `RunNotFoundError`
 * if the run doesn't exist for this project.
 */
export async function getProjectRunDetail(
  projectId: string,
  runId: string
): Promise<RunDetail> {
  assertSafeId(projectId);
  assertSafeId(runId);
  const runFile = getRunFile(projectId, runId);
  if (!(await pathExists(runFile))) {
    throw new RunNotFoundError(runId);
  }
  const run = await readJson<WorkflowRun>(runFile);
  // Defence in depth: a runId from one project must not be servable from
  // another. Prevents a mis-pasted URL from leaking another project's
  // event log.
  if (run.projectId !== projectId) {
    throw new RunNotFoundError(runId);
  }
  // events.ndjson may be missing if the run never emitted (init failed).
  // readEventsFromDisk handles that and returns []. We pass it `projectId`
  // matching the run, so its lookup hits the right path.
  let events: RunEvent[] = [];
  if (await pathExists(getRunEventsFile(projectId, runId))) {
    events = await readEventsFromDisk(projectId, runId);
  }
  let workflowName: string | null = null;
  try {
    const wf = await getWorkflow(run.workflowId);
    workflowName = wf?.name ?? null;
  } catch {
    workflowName = null;
  }
  return { run, events, workflowName };
}
