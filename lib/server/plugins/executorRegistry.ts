/**
 * Server-side executor registry. One executor per node `kind`.
 *
 * Populated at module load by `registerBuiltinExecutors.ts`. Read by
 * `lib/server/workflow/runtime.ts` during run execution.
 *
 * The shape of `NodeExecutor<D>` is the production contract for plugin
 * executors. See `docs/PLUGIN-API.md` for the full execution lifecycle
 * and what guarantees the runtime makes (input ordering, abort signal,
 * event emission, etc.).
 */
import "server-only";

import type { BaseNodeData } from "@/lib/plugins/types";
import type { RunEvent } from "@/types";

/** Outputs from one node, keyed by source-handle id. */
export type ExecutorOutputs = Record<string, unknown>;

/** Per-run context handed to every executor invocation. */
export interface ExecutorContext {
  /** Stable run id; same across every node in a single run. */
  runId: string;
  /** The current node id this executor was invoked for. */
  nodeId: string;
  /** Owning project id, or `null` for test-mode runs. */
  projectId: string | null;
  /** Workflow id this run was created from. */
  workflowId: string;
  /** Run mode discriminator. Affects asset promotion semantics. */
  mode: "test" | "project";
  /**
   * Honour this — the runtime sets it on cancel; long-running executors
   * (LLM streaming, ComfyUI `/prompt`) MUST check it periodically and
   * abort cleanly when triggered.
   */
  abortSignal: AbortSignal;
  /**
   * Filesystem path to this run's outputs directory. SaveOutput writes
   * here; other executors that produce binaries can use this as scratch.
   */
  outputsDir: string;
  /**
   * Publish a SSE event. Awaiting this guarantees persistence to
   * `events.ndjson` before resolution — useful for `node.completed` events
   * where downstream nodes might already be reading.
   */
  emit: (event: RunEvent) => Promise<void>;
}

/** Resolved inputs for one node, keyed by target-handle id. */
export interface ExecutorInputs {
  [handleId: string]: unknown;
}

/**
 * The executor contract. Every executable plugin's `executor.ts` exports
 * a value satisfying this for its specific `D` shape.
 *
 * Behavioural contract:
 *   - Read user values from `inputs` (resolved by the runtime from
 *     upstream-edge values).
 *   - Read static config from `data` (the node's blob from the canvas).
 *   - Honour `ctx.abortSignal`. Throw on abort, or return early gracefully.
 *   - Emit `node.progress` events via `ctx.emit()` for any work worth
 *     showing on the canvas.
 *   - Return outputs keyed by source-handle id. The runtime feeds these
 *     into downstream nodes and persists them to the run record.
 *
 * Errors:
 *   - Throwing maps to a `node.failed` event with the error message.
 *     Make messages user-actionable — they surface in toast + inline.
 */
export interface NodeExecutor<D extends BaseNodeData> {
  execute(
    ctx: ExecutorContext,
    inputs: ExecutorInputs,
    data: D
  ): Promise<ExecutorOutputs>;
}

// ----- Registry -----

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- map values are unioned over plugin-specific D shapes
const registry = new Map<string, NodeExecutor<any>>();

/**
 * Register an executor for a kind. Last-write-wins to match
 * `manifestRegistry.registerManifest` and stay friendly to dev hot-reload.
 *
 * The runtime's lookup site (`getExecutor`) is responsible for surfacing
 * a clear error if a kind is encountered with no executor — happens in
 * practice only for `executable: false` nodes, which the runtime skips.
 */
export function registerExecutor<D extends BaseNodeData>(
  kind: string,
  executor: NodeExecutor<D>
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry.set(kind, executor as NodeExecutor<any>);
}

/** Look up an executor by kind. Returns undefined for unregistered or inert kinds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getExecutor(kind: string): NodeExecutor<any> | undefined {
  return registry.get(kind);
}

/** Whether an executor is registered for the given kind. */
export function hasExecutor(kind: string): boolean {
  return registry.has(kind);
}

/** All registered kinds with executors. Used by the runtime for sanity checks. */
export function listExecutorKinds(): string[] {
  return Array.from(registry.keys());
}

/** INTERNAL: clear the registry. Tests only. */
export function __clearExecutorsForTests(): void {
  registry.clear();
}
