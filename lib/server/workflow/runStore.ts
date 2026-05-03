/**
 * Run persistence layer. Two storage roots, dispatched via the run's
 * `projectId`:
 *
 *   - `mode: "project"` → `.studio-data/projects/<projectId>/runs/<runId>/`
 *   - `mode: "test"`    → `.studio-data/runs/<runId>/`  (project-independent)
 *
 * Two files per run:
 *   - `run.json`       — `WorkflowRun` snapshot, rewritten on every state change
 *   - `events.ndjson`  — append-only log; the SSE handler replays this on
 *                        connect, then subscribes to `eventBus` for live tail
 *
 * `findRunLocation(runId)` is the lookup primitive used by routes that don't
 * know upfront whether a run is project-scoped or test-scoped — it checks
 * in-memory cache → `runs/` → every `projects/<id>/runs/`.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { RunEvent, RunStatus, NodeRunState, WorkflowRun } from "@/types";
import {
  ensureDir,
  getProjectsDir,
  getRunDir,
  getRunEventsFile,
  getRunFile,
  getRunOutputsDir,
  getTestRunsDir,
  pathExists,
  readJson,
  writeJson,
} from "../storage";
import * as eventBus from "./eventBus";

export interface RunLocation {
  /** null = test run (lives under .studio-data/runs/<runId>) */
  projectId: string | null;
}

interface InMemoryRun {
  run: WorkflowRun;
  abortController: AbortController;
}

const runs = new Map<string, InMemoryRun>();

export function getRunInMemory(runId: string): InMemoryRun | null {
  return runs.get(runId) ?? null;
}

export async function readRunFromDisk(projectId: string | null, runId: string): Promise<WorkflowRun | null> {
  const file = getRunFile(projectId, runId);
  if (!(await pathExists(file))) return null;
  return readJson<WorkflowRun>(file);
}

export async function readEventsFromDisk(projectId: string | null, runId: string): Promise<RunEvent[]> {
  const file = getRunEventsFile(projectId, runId);
  if (!(await pathExists(file))) return [];
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const events: RunEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      // Skip malformed lines defensively
    }
  }
  return events;
}

export async function initRun(run: WorkflowRun): Promise<InMemoryRun> {
  await ensureDir(getRunDir(run.projectId, run.id));
  await ensureDir(getRunOutputsDir(run.projectId, run.id));
  await writeJson(getRunFile(run.projectId, run.id), run);
  // Truncate events file so a re-run with the same id starts fresh (shouldn't happen but defensive)
  await fs.writeFile(getRunEventsFile(run.projectId, run.id), "", "utf8");
  const entry: InMemoryRun = { run, abortController: new AbortController() };
  runs.set(run.id, entry);
  return entry;
}

/** Persist current run snapshot to run.json. */
async function persistRun(run: WorkflowRun): Promise<void> {
  await writeJson(getRunFile(run.projectId, run.id), run);
}

/**
 * Monotonic sequence stamped onto every emitted event before it lands on
 * disk + the bus. Lets the SSE handler dedup events that arrive on both
 * the disk-replay path AND the live-bus path during the subscribe race
 * window. Process-lifetime; restarts at 1 on each Node boot — that's fine
 * because seq numbers are only meaningful within a single run's stream.
 *
 * Stamped as a non-typed extra field (`_seq`) so we don't need to widen
 * every RunEvent variant in the public schema.
 */
let nextSeq = 1;

/** Append an event to events.ndjson and broadcast via the in-memory bus. */
export async function emitEvent(runId: string, event: RunEvent): Promise<void> {
  const entry = runs.get(runId);
  if (!entry) return;
  const file = getRunEventsFile(entry.run.projectId, runId);
  // Stamp with a sequence number so subscribe-after-read races can dedup.
  const stamped = { ...event, _seq: nextSeq++ } as RunEvent & { _seq: number };
  await fs.appendFile(file, JSON.stringify(stamped) + "\n", "utf8");
  eventBus.emit(runId, stamped);
}

/** TEST-ONLY: reset the sequence counter so test order is deterministic. */
export function __resetSeqForTests(): void {
  nextSeq = 1;
}

export async function setRunStatus(runId: string, status: RunStatus, patch?: Partial<WorkflowRun>): Promise<void> {
  const entry = runs.get(runId);
  if (!entry) return;
  entry.run = {
    ...entry.run,
    ...patch,
    status,
    endedAt:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? new Date().toISOString()
        : entry.run.endedAt,
  };
  await persistRun(entry.run);
}

export async function setNodeRunState(runId: string, nodeId: string, state: NodeRunState): Promise<void> {
  const entry = runs.get(runId);
  if (!entry) return;
  entry.run = {
    ...entry.run,
    nodeStates: { ...entry.run.nodeStates, [nodeId]: state },
  };
  await persistRun(entry.run);
}

/**
 * Record a node's executor output on the run snapshot. Used by the
 * runtime after each successful execution so the resume endpoint can
 * re-seed without replaying. Stored values must be JSON-serializable —
 * the runtime's `jsonOnly` filter is responsible for that.
 */
export async function setNodeOutput(
  runId: string,
  nodeId: string,
  output: Record<string, unknown>
): Promise<void> {
  const entry = runs.get(runId);
  if (!entry) return;
  entry.run = {
    ...entry.run,
    nodeOutputs: { ...(entry.run.nodeOutputs ?? {}), [nodeId]: output },
  };
  await persistRun(entry.run);
}

export type CancelOutcome =
  | "cancelled"
  | "already_finished"
  | "unknown";

/**
 * Try to cancel a run. Distinguishes three cases for the API layer:
 *   - "cancelled":        in-memory + running/queued → AbortController fired
 *   - "already_finished": in-memory but terminal, OR on-disk only (already
 *                          disposed) — caller should respond 200 idempotent
 *   - "unknown":          run id is not in memory; the API caller should
 *                          fall back to a disk lookup before deciding
 *                          between 404 and "already_finished"
 */
export function cancel(runId: string): CancelOutcome {
  const entry = runs.get(runId);
  if (!entry) return "unknown";
  if (entry.run.status !== "running" && entry.run.status !== "queued") {
    return "already_finished";
  }
  entry.abortController.abort();
  return "cancelled";
}

/** Clean up the in-memory entry; the on-disk run.json + events.ndjson stay for inspection. */
export function disposeRun(runId: string): void {
  runs.delete(runId);
  eventBus.clear(runId);
}

/**
 * Resolve where a runId lives on disk. Checks in-memory first, then test-runs dir, then
 * scans project dirs (cheap at the project counts this app sees).
 *
 * Returns `{ projectId: null }` for test runs, `{ projectId }` for project runs,
 * or `null` if the run can't be found anywhere.
 */
export async function findRunLocation(runId: string): Promise<RunLocation | null> {
  const inMem = runs.get(runId);
  if (inMem) return { projectId: inMem.run.projectId };

  // Test runs first (cheaper — single dir lookup)
  const testCandidate = path.join(getTestRunsDir(), runId);
  if (await pathExists(testCandidate)) return { projectId: null };

  const projectsDir = getProjectsDir();
  if (await pathExists(projectsDir)) {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const candidate = path.join(projectsDir, e.name, "runs", runId);
      if (await pathExists(candidate)) return { projectId: e.name };
    }
  }
  return null;
}
