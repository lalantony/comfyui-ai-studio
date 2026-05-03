/**
 * Workflow runtime — the orchestrator that turns a Studio canvas DAG into a
 * real execution against ComfyUI + LLM providers.
 *
 * Responsibilities:
 *   1. Validate the start request (`mode === "test"` => `projectId === null`;
 *      `mode === "project"` => required `projectId`).
 *   2. Topologically sort the DAG (Kahn's algorithm). Cycles are rejected.
 *   3. Walk nodes in order; per node, collect upstream edge values, dispatch
 *      to the right executor, persist run state, and emit a SSE event.
 *   4. Honour the run's `AbortSignal` between every node (and inside long-
 *      running executors that opt in, e.g. ComfyUI's `/interrupt`).
 *   5. Aggregate outputs: project mode promotes binaries to project assets;
 *      test mode keeps them under `.studio-data/runs/<runId>/outputs/`.
 *
 * Concurrency is controlled by `queue.queueKeyForRun(projectId)` — see
 * `queue.ts` for the per-key FIFO semantics. Project runs are keyed
 * `project:<id>` (one per project at a time; different projects parallel);
 * test runs are keyed `test` (serialize among themselves but never block
 * project runs).
 *
 * Persistence: `runStore` writes `run.json` + appends `events.ndjson` after
 * each event. The SSE handler at `/api/workflow-runs/[id]/events` replays
 * `events.ndjson` then subscribes to `eventBus` for live tail.
 */
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  NodeRunState,
  RunEvent,
  TestRunOutputFile,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun,
} from "@/types";
import { parseNodeData } from "@/lib/plugins/parseNodeData";
import { getRunOutputsDir } from "../storage";
import { getWorkflow, WorkflowNotFoundError } from "../workflowService";
import * as runStore from "./runStore";
import * as queue from "./queue";
import type { ExecutorContext, ExecutorOutputs } from "@/lib/server/plugins/executorRegistry";
import { getExecutor } from "@/lib/server/plugins/executorRegistry";
// Side-effect import: registers all built-in executors at module load.
import "@/lib/server/plugins/registerBuiltinExecutors";

export interface StartRunInput {
  workflowId: string;
  /** Required for `mode: "project"`. Must be null/omitted for `mode: "test"`. */
  projectId: string | null;
  mode: "test" | "project";
  /**
   * Initial inputs keyed by source-node id (e.g. text input, image input).
   * Source-node executors read these for nodes with no upstream edges.
   */
  inputs?: Record<string, unknown>;
  /**
   * When set, the orchestrator skips re-executing nodes whose ids are keys
   * here and uses the supplied output instead. Used by the resume-from-
   * failed-step flow: callers seed every successful upstream output from
   * the parent run, so the resumed run picks up at the failed node.
   *
   * The seeded values must be plain JSON shapes — the resume service
   * already validated their referenced assets exist before invoking
   * startRun, so the orchestrator trusts them blindly.
   */
  seededOutputs?: Record<string, Record<string, unknown>>;
  /** When `seededOutputs` is set, the parent run id is recorded for traceability. */
  resumedFromRunId?: string;
}

export interface StartRunResult {
  runId: string;
}

/**
 * Compute a stable SHA-256 over a workflow's executable shape (nodes +
 * edges, sorted into canonical order). Used by the resume endpoint to
 * reject when the workflow definition has changed since the parent run.
 *
 * Why this shape:
 *   - Nodes contribute id, type, and data — anything that affects how a
 *     node executes. Position/style omitted (cosmetic only).
 *   - Edges contribute source/target/sourceHandle/targetHandle.
 *   - Both arrays are sorted by id so the hash is independent of array
 *     order (which the canvas can shuffle on save without semantic change).
 */
export function computeWorkflowHash(workflow: Workflow): string {
  const nodes = [...workflow.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({ id: n.id, type: n.type, data: n.data }));
  const edges = [...workflow.edges]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    }));
  return createHash("sha256")
    .update(JSON.stringify({ nodes, edges }))
    .digest("hex");
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  // Mode contracts
  if (input.mode === "project" && !input.projectId) {
    throw new Error("project mode requires a projectId");
  }
  const projectId = input.mode === "test" ? null : input.projectId;

  const workflow = await getWorkflow(input.workflowId);
  if (!workflow) throw new WorkflowNotFoundError(input.workflowId);

  // Full UUID (36 chars) instead of a 12-char slice — collision space is
  // 2^122 vs 2^48. Length is fine: ID_PATTERN allows up to 128, our prefix
  // + UUID is 40, and runId is opaque to URLs/logs/sidecars alike.
  const runId = `run-${randomUUID()}`;
  const initialNodeStates: Record<string, NodeRunState> = Object.fromEntries(
    workflow.nodes.map((n) => {
      // Seeded outputs short-circuit execution; mark them success up-front
      // so the canvas paints them green from the start of the resumed run
      // instead of flashing through "idle → success".
      const seeded = input.seededOutputs?.[n.id] !== undefined;
      return [n.id, seeded ? ("success" as NodeRunState) : ("idle" as NodeRunState)];
    })
  );

  const run: WorkflowRun = {
    id: runId,
    workflowId: workflow.id,
    workflowHash: computeWorkflowHash(workflow),
    projectId,
    mode: input.mode,
    status: "queued",
    inputs: input.inputs ?? {},
    startedAt: new Date().toISOString(),
    outputAssetIds: [],
    nodeStates: initialNodeStates,
    nodeOutputs: input.seededOutputs ? { ...input.seededOutputs } : undefined,
    resumedFromRunId: input.resumedFromRunId,
  };
  await runStore.initRun(run);

  queue.enqueue(queue.queueKeyForRun(projectId), () =>
    execute(run, workflow, input.seededOutputs ?? {})
  );
  return { runId };
}

/* ---------- Topological sort (Kahn's algorithm) ---------- */

function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const ready: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) ready.push(id);

  const sorted: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    sorted.push(id);
    for (const e of edges) {
      if (e.source !== id) continue;
      const next = (inDegree.get(e.target) ?? 0) - 1;
      inDegree.set(e.target, next);
      if (next === 0) ready.push(e.target);
    }
  }
  if (sorted.length !== nodes.length) {
    throw new Error("Workflow has a cycle — execution is impossible");
  }
  return sorted;
}

/* ---------- The runtime loop ---------- */

async function execute(
  run: WorkflowRun,
  workflow: Workflow,
  seededOutputs: Record<string, Record<string, unknown>>
): Promise<void> {
  const entry = runStore.getRunInMemory(run.id);
  if (!entry) return;

  await runStore.setRunStatus(run.id, "running");
  await runStore.emitEvent(run.id, {
    type: "run.started",
    runId: run.id,
    workflowId: workflow.id,
    projectId: run.projectId,
  });

  let sorted: string[];
  try {
    sorted = topoSort(workflow.nodes, workflow.edges);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Topological sort failed";
    await runStore.setRunStatus(run.id, "failed", { error: message });
    await runStore.emitEvent(run.id, { type: "run.failed", runId: run.id, error: message });
    runStore.disposeRun(run.id);
    return;
  }

  // Empty-workflow guard: an empty workflow could "succeed" silently with
  // no outputs, which is almost never what the user wants and produces
  // no signal. Fail explicitly with a clear message.
  if (sorted.length === 0) {
    const message = "Workflow has no nodes — add at least one before running.";
    await runStore.setRunStatus(run.id, "failed", { error: message });
    await runStore.emitEvent(run.id, { type: "run.failed", runId: run.id, error: message });
    runStore.disposeRun(run.id);
    return;
  }

  // Cancellation that landed between `initRun` and the first node — honour
  // it before we emit any per-node events. Otherwise a fast-cancelling
  // user sees `run.started` immediately followed by an unrelated success.
  if (entry.abortController.signal.aborted) {
    await runStore.setRunStatus(run.id, "cancelled");
    await runStore.emitEvent(run.id, { type: "run.cancelled", runId: run.id });
    runStore.disposeRun(run.id);
    return;
  }

  const outputsByNode = new Map<string, ExecutorOutputs>();
  // Resume seed: hydrate the in-memory map from persisted upstream outputs
  // BEFORE any nodes run. Downstream nodes will see these via the existing
  // edge-collection loop without any further special-casing.
  for (const [nodeId, output] of Object.entries(seededOutputs)) {
    outputsByNode.set(nodeId, output as ExecutorOutputs);
  }

  for (let i = 0; i < sorted.length; i++) {
    const nodeId = sorted[i];

    // Cancellation check between nodes
    if (entry.abortController.signal.aborted) {
      for (let j = i; j < sorted.length; j++) {
        const remaining = sorted[j];
        await runStore.setNodeRunState(run.id, remaining, "cancelled");
        await runStore.emitEvent(run.id, { type: "node.skipped", runId: run.id, nodeId: remaining });
      }
      await runStore.setRunStatus(run.id, "cancelled");
      await runStore.emitEvent(run.id, { type: "run.cancelled", runId: run.id });
      runStore.disposeRun(run.id);
      return;
    }

    // Seeded-from-resume short-circuit: a node whose output was inherited
    // from the parent run is *already* in `outputsByNode` and was marked
    // success up-front. Skip execution for it but emit the lifecycle events
    // so downstream tooling (test panel, run-history) sees a clean trail.
    if (seededOutputs[nodeId] !== undefined) {
      await runStore.emitEvent(run.id, { type: "node.started", runId: run.id, nodeId });
      await runStore.emitEvent(run.id, {
        type: "node.completed",
        runId: run.id,
        nodeId,
        outputSummary: "(reused from previous run)",
      });
      continue;
    }

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const data = parseNodeData(node);

    // Notes / unknown nodes: skip — but emit a `node.skipped` event so the
    // canvas badge updates, and a `run.log` line so users debugging a
    // missing-plugin install have a signal beyond "the node just didn't
    // run". M1 from F1 audit: silent bypass made dropped nodes
    // indistinguishable from successful no-ops.
    if (!data || data.kind === "note") {
      await runStore.setNodeRunState(run.id, nodeId, "skipped");
      await runStore.emitEvent(run.id, { type: "node.skipped", runId: run.id, nodeId });
      if (!data) {
        const rawKind = (node.data as { kind?: string } | undefined)?.kind ?? node.type ?? "<unknown>";
        await runStore.emitEvent(run.id, {
          type: "run.log",
          runId: run.id,
          nodeId,
          level: "warn",
          message: `Skipped node: kind "${rawKind}" has no registered manifest. Plugin missing?`,
          timestamp: new Date().toISOString(),
        });
      }
      outputsByNode.set(nodeId, {});
      continue;
    }

    // Collect inputs from upstream edges
    const nodeInputs: Record<string, unknown> = {};
    const incomingEdges = workflow.edges.filter((e) => e.target === nodeId);
    for (const edge of incomingEdges) {
      const upstream = outputsByNode.get(edge.source) ?? {};
      const sourceHandle = edge.sourceHandle ?? "output";
      const targetHandle = edge.targetHandle ?? "input";
      nodeInputs[targetHandle] = upstream[sourceHandle];
    }
    // Source-node injection: if the run.inputs map contains a value keyed by this node id,
    // expose it as a synthetic 'value' input. Stage 4+ executors will use this for primary inputs.
    if (incomingEdges.length === 0 && run.inputs[nodeId] !== undefined) {
      nodeInputs.value = run.inputs[nodeId];
    }

    // Condition null-routing: if every incoming handle is null/undefined, skip this node.
    const everyInputNullish =
      incomingEdges.length > 0 && incomingEdges.every((e) => {
        const handle = e.targetHandle ?? "input";
        const v = nodeInputs[handle];
        return v === null || v === undefined;
      });
    if (everyInputNullish) {
      await runStore.setNodeRunState(run.id, nodeId, "skipped");
      await runStore.emitEvent(run.id, { type: "node.skipped", runId: run.id, nodeId });
      outputsByNode.set(nodeId, {});
      continue;
    }

    const executor = getExecutor(data.kind);
    if (!executor) {
      const message = `No executor registered for kind: ${data.kind}`;
      await runStore.setNodeRunState(run.id, nodeId, "failed");
      await runStore.emitEvent(run.id, { type: "node.failed", runId: run.id, nodeId, error: message });
      await runStore.setRunStatus(run.id, "failed", { error: message });
      await runStore.emitEvent(run.id, { type: "run.failed", runId: run.id, error: message });
      runStore.disposeRun(run.id);
      return;
    }

    await runStore.setNodeRunState(run.id, nodeId, "running");
    await runStore.emitEvent(run.id, { type: "node.started", runId: run.id, nodeId });

    const ctx: ExecutorContext = {
      runId: run.id,
      nodeId,
      projectId: run.projectId,
      workflowId: workflow.id,
      mode: run.mode,
      abortSignal: entry.abortController.signal,
      outputsDir: getRunOutputsDir(run.projectId, run.id),
      // Wrap emit so executors don't have to know their own nodeId
      emit: async (event: RunEvent) => {
        const stamped: RunEvent =
          "nodeId" in event && (event as { nodeId?: string }).nodeId === ""
            ? ({ ...event, nodeId } as RunEvent)
            : event;
        await runStore.emitEvent(run.id, stamped);
      },
    };

    try {
      const result = await executor.execute(ctx, nodeInputs, data);
      outputsByNode.set(nodeId, result);
      await runStore.setNodeRunState(run.id, nodeId, "success");
      // Persist a JSON-serializable subset of the output so a future
      // resume can re-seed this node without re-executing it. Buffer-bearing
      // fields (test mode only) drop silently — resume of test mode is out
      // of scope and we never need to re-hydrate Buffers anyway.
      const persistable = jsonOnly(result);
      if (persistable !== null) {
        await runStore.setNodeOutput(run.id, nodeId, persistable);
      }
      // Executors that produce a viewable artifact (ComfyUI in test mode,
      // ComfyUI in project mode auto-save) attach a `preview` field on
      // their result. We forward it on `node.completed` so the test panel
      // and the canvas can show the output the moment the stage finishes,
      // without waiting for run.completed.
      const previewFromResult = (result as { preview?: import("@/types").NodePreview }).preview;
      await runStore.emitEvent(run.id, {
        type: "node.completed",
        runId: run.id,
        nodeId,
        outputSummary: summarize(result),
        ...(previewFromResult ? { preview: previewFromResult } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Cancel that landed *during* an in-flight executor surfaces here as
      // a thrown "Cancelled" — the executor honoured the abort signal and
      // bailed cleanly. Treat that as a cancellation, not a failure: the
      // user pressed Stop and expects the neutral "cancelled" status, not
      // a red "failed" toast or a permanent `failed` record on disk.
      const wasCancelled = entry.abortController.signal.aborted;
      const nodeFinalState = wasCancelled ? "cancelled" : "failed";
      await runStore.setNodeRunState(run.id, nodeId, nodeFinalState);
      if (wasCancelled) {
        await runStore.emitEvent(run.id, { type: "node.skipped", runId: run.id, nodeId });
      } else {
        await runStore.emitEvent(run.id, { type: "node.failed", runId: run.id, nodeId, error: message });
      }

      // Mark every downstream node as cancelled regardless of cause —
      // they were never going to run in either case.
      for (let j = i + 1; j < sorted.length; j++) {
        await runStore.setNodeRunState(run.id, sorted[j], "cancelled");
        await runStore.emitEvent(run.id, { type: "node.skipped", runId: run.id, nodeId: sorted[j] });
      }

      if (wasCancelled) {
        await runStore.setRunStatus(run.id, "cancelled");
        await runStore.emitEvent(run.id, { type: "run.cancelled", runId: run.id });
      } else {
        await runStore.setRunStatus(run.id, "failed", { error: message });
        await runStore.emitEvent(run.id, { type: "run.failed", runId: run.id, error: message });
      }
      runStore.disposeRun(run.id);
      return;
    }
  }

  // Collect outputs from every SaveOutput node:
  //   - project mode: it created assets (savedAssetId)
  //   - test mode:    it wrote files to the run's outputs dir (savedFile)
  const outputAssetIds: string[] = [];
  const outputFiles: TestRunOutputFile[] = [];
  for (const [nodeId, result] of outputsByNode) {
    void nodeId;
    const r = result as Record<string, unknown>;
    if (typeof r.savedAssetId === "string") outputAssetIds.push(r.savedAssetId);
    if (r.savedFile && typeof r.savedFile === "object") {
      outputFiles.push(r.savedFile as TestRunOutputFile);
    }
  }
  // Terminal-write defence: if `setRunStatus` (writeFile) fails on the
  // final state — disk full, EPERM, transient FS error — the run would
  // sit in `running` forever in memory and on disk, with no terminal
  // SSE event delivered to clients. Catch + force the terminal event
  // out so the UI at least transitions, and dispose unconditionally.
  try {
    await runStore.setRunStatus(run.id, "succeeded", {
      outputAssetIds,
      outputFiles: outputFiles.length > 0 ? outputFiles : undefined,
    });
    await runStore.emitEvent(run.id, {
      type: "run.completed",
      runId: run.id,
      outputAssetIds,
      outputFiles: outputFiles.length > 0 ? outputFiles : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to persist terminal run state";
    await runStore
      .emitEvent(run.id, { type: "run.failed", runId: run.id, error: message })
      .catch(() => {
        /* even the emit failed — at this point we've done what we can; dispose below */
      });
  } finally {
    runStore.disposeRun(run.id);
  }
}

/**
 * Filter an executor result down to its JSON-serializable subset for
 * persistence in `run.json`. Returns null if the result has nothing
 * useful to keep.
 *
 * In project mode the executors we ship return plain objects (AssetRef,
 * strings, primitives). Test mode's ComfyUI executor returns a Buffer
 * inside `output.bytes`; resume of test mode isn't supported, so we
 * just drop those keys here.
 */
function jsonOnly(
  result: ExecutorOutputs
): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (Buffer.isBuffer(v)) continue;
    if (v === null || v === undefined) {
      out[k] = v;
      continue;
    }
    try {
      // Round-trip through JSON to catch nested Buffers / circular refs.
      out[k] = JSON.parse(JSON.stringify(v));
    } catch {
      // Skip un-serializable fields rather than poison the whole snapshot.
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build a one-line summary of an executor's result for the
 * `node.completed` event. Strips fields that don't summarize well
 * (Buffers, arbitrarily-large nested JSON) and falls back to a shape
 * description when nothing useful is available.
 */
function summarize(result: ExecutorOutputs): string {
  if (!result || Object.keys(result).length === 0) return "ok";
  const first = Object.entries(result)[0];
  const [k, v] = first;
  if (typeof v === "string") return `${k}: ${v.length > 60 ? v.slice(0, 57) + "..." : v}`;
  if (Buffer.isBuffer(v)) return `${k}: <Buffer ${v.length}B>`;
  if (v && typeof v === "object") {
    // Strip Buffer fields before stringify so a single byte buffer doesn't
    // produce 60 chars of `{"type":"Buffer","data":[...`. Also handles
    // potential circular refs by catching the JSON.stringify throw.
    try {
      const cleaned: Record<string, unknown> = {};
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
        cleaned[ck] = Buffer.isBuffer(cv) ? `<Buffer ${cv.length}B>` : cv;
      }
      const s = JSON.stringify(cleaned);
      return `${k}: ${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
    } catch {
      return `${k}: <object>`;
    }
  }
  return `${k}: ${String(v)}`;
}
