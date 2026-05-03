/**
 * Resume-from-failed-step orchestration.
 *
 * Premise: a multi-stage chain that fails on stage N has stages 0..N-1
 * already on disk (project-mode auto-save) plus their `nodeOutputs`
 * snapshot in `run.json`. Resuming with the same workflow + same upstream
 * outputs lets the user pick up at stage N without re-executing earlier
 * (often expensive) ComfyUI work.
 *
 * Validation gates (each maps to a specific user-visible error):
 *   - Run exists and is in a terminal state (failed | cancelled).
 *   - Workflow still exists.
 *   - Workflow hash matches the parent run's recorded hash. Any structural
 *     edit since the parent run forfeits resume — it'd be unsafe to re-use
 *     stale outputs against new node configs.
 *   - The parent run captured `nodeOutputs` (legacy runs without the field
 *     can't be resumed; the user starts fresh).
 *   - For every successful upstream node whose output is being re-used,
 *     any AssetRef-shaped output points at an asset that still exists on
 *     disk. (Output assets can be deleted between runs; we won't trick the
 *     orchestrator into running with a phantom upstream.)
 *
 * On success we delegate to `startRun` with `seededOutputs` populated, so
 * the new run is a normal queue entry that emits the usual SSE stream.
 */
import "server-only";

import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  AssetRef,
} from "@/types";
import { getWorkflow, WorkflowNotFoundError } from "../workflowService";
import { getAssetSidecar } from "../assetService";
import { findRunLocation, readRunFromDisk } from "./runStore";
import { computeWorkflowHash, startRun } from "./runtime";

export class ResumeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "run_not_found"
      | "not_resumable_status"
      | "test_mode_unsupported"
      | "workflow_deleted"
      | "workflow_changed"
      | "no_node_outputs"
      | "no_failed_node"
      | "asset_missing"
  ) {
    super(message);
    this.name = "ResumeError";
  }
}

export interface ResumeRunResult {
  runId: string;
  fromNodeId: string;
  reusedNodeIds: string[];
}

/**
 * Validate + start a resume of `parentRunId`. The new run id is returned
 * along with metadata for the UI ("resuming from stage 3, reused stages
 * 1-2").
 */
export async function resumeRun(parentRunId: string): Promise<ResumeRunResult> {
  const loc = await findRunLocation(parentRunId);
  if (!loc) throw new ResumeError(`Run ${parentRunId} not found.`, "run_not_found");

  const parent = await readRunFromDisk(loc.projectId, parentRunId);
  if (!parent) throw new ResumeError(`Run ${parentRunId} not found.`, "run_not_found");

  if (parent.mode !== "project") {
    throw new ResumeError(
      "Resume is only supported for project-mode runs. Test runs leave outputs on disk only and aren't auto-promoted to assets.",
      "test_mode_unsupported"
    );
  }
  if (parent.status !== "failed" && parent.status !== "cancelled") {
    throw new ResumeError(
      `Can't resume a run in status "${parent.status}". Only failed or cancelled runs can be resumed.`,
      "not_resumable_status"
    );
  }
  if (!parent.nodeOutputs) {
    throw new ResumeError(
      "This run pre-dates resume support — its per-node outputs weren't captured. Start a fresh run instead.",
      "no_node_outputs"
    );
  }

  const workflow = await getWorkflow(parent.workflowId);
  if (!workflow) {
    throw new ResumeError(
      `Workflow ${parent.workflowId} has been deleted since this run.`,
      "workflow_deleted"
    );
  }

  const currentHash = computeWorkflowHash(workflow);
  if (parent.workflowHash && parent.workflowHash !== currentHash) {
    throw new ResumeError(
      "The workflow has been edited since this run — its execution shape no longer matches. Run it fresh, or revert your edits to resume.",
      "workflow_changed"
    );
  }

  const fromNodeId = pickResumeFromNodeId(workflow.nodes, workflow.edges, parent);
  if (!fromNodeId) {
    throw new ResumeError(
      "Couldn't find a non-completed node to resume from.",
      "no_failed_node"
    );
  }

  // Seed outputs from every node that's upstream of (or earlier in topo
  // order than) the resume-from point AND has a recorded output. The
  // simpler "every success node" logic is equivalent in practice because
  // the orchestrator only halts at the first failure.
  const upstreamSet = collectAncestors(fromNodeId, workflow.edges);
  const seededOutputs: Record<string, Record<string, unknown>> = {};
  for (const nodeId of upstreamSet) {
    const out = parent.nodeOutputs[nodeId];
    if (!out) continue;
    // Validate any AssetRef-shaped fields still resolve. The auto-save
    // path produces outputs like `{ output: { assetId, projectId, ... } }`
    // — if the user deleted that asset between runs, we have to refuse
    // resume rather than dispatch a run with a phantom upstream.
    await assertAssetRefsResolve(out, nodeId);
    seededOutputs[nodeId] = out;
  }

  const { runId } = await startRun({
    workflowId: workflow.id,
    projectId: parent.projectId,
    mode: "project",
    inputs: parent.inputs,
    seededOutputs,
    resumedFromRunId: parent.id,
  });

  return {
    runId,
    fromNodeId,
    reusedNodeIds: Object.keys(seededOutputs),
  };
}

/**
 * Pick the first non-success node in topological order. The runtime's
 * topo sort is implemented in `runtime.ts`; we re-use the same Kahn's
 * algorithm here so the ordering matches what the new run will see.
 *
 * Failure-mode heuristic: if no node has the explicit "failed" state
 * (e.g. cancelled mid-flight), pick the first node whose state isn't
 * "success" — that's where the new run picks back up.
 */
function pickResumeFromNodeId(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  run: WorkflowRun
): string | null {
  const sorted = topoSort(nodes, edges);
  for (const nodeId of sorted) {
    const state = run.nodeStates[nodeId];
    if (state !== "success" && state !== "skipped") return nodeId;
  }
  return null;
}

function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
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
  return sorted;
}

/**
 * Walk backwards from `target` and return the set of every ancestor node
 * (transitive). Used to determine which seeded outputs are *required*
 * versus merely available — only ancestors of the resume point need to
 * be seeded; non-ancestor success nodes will execute again, which is
 * fine because they won't have any way to reach the resume-from node
 * via the DAG.
 *
 * Includes downstream-orphans as well? No — only ancestors. A success
 * node that's not upstream of fromNodeId may share an LLM endpoint cost
 * we'd rather not re-pay, but for v1 we keep the rule simple. Future
 * work can broaden to "every success node" if savings warrant it.
 */
function collectAncestors(
  target: string,
  edges: WorkflowEdge[]
): Set<string> {
  const ancestors = new Set<string>();
  const stack: string[] = [target];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of edges) {
      if (e.target !== id || ancestors.has(e.source)) continue;
      ancestors.add(e.source);
      stack.push(e.source);
    }
  }
  return ancestors;
}

/**
 * Walk the persisted output for AssetRef-shaped values and ensure each
 * asset still exists on disk. AssetRef shape across our executors:
 *   - `{ output: { assetId, projectId, ... } }` (ComfyUI auto-save)
 *   - `{ asset: { assetId, projectId } }` (image-input passthrough)
 * Both convention paths get checked. Anything else is left alone.
 */
async function assertAssetRefsResolve(
  output: Record<string, unknown>,
  nodeId: string
): Promise<void> {
  for (const value of Object.values(output)) {
    const ref = extractAssetRef(value);
    if (!ref) continue;
    const sidecar = await getAssetSidecar(ref.projectId, ref.assetId);
    if (!sidecar) {
      throw new ResumeError(
        `Can't resume — node "${nodeId}" expected asset ${ref.assetId} from the previous run but it's no longer in project ${ref.projectId}.`,
        "asset_missing"
      );
    }
  }
}

function extractAssetRef(
  value: unknown
): { projectId: string; assetId: string } | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.assetId === "string" &&
    typeof obj.projectId === "string"
  ) {
    return { projectId: obj.projectId, assetId: obj.assetId };
  }
  return null;
}

// Re-export for surface-clarity at call sites that import alongside startRun.
export type { AssetRef, WorkflowNotFoundError };
