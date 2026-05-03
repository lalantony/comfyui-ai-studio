/**
 * Single barrel of every domain type used across the studio (client + server).
 *
 * Conventions:
 *   - Types are *exact shapes* of what we persist to disk under STUDIO_DATA_DIR.
 *     If you add a field, decide whether it's optional (older saved data won't
 *     have it) and handle the default in the corresponding service's read path.
 *   - ISO timestamp strings (not Date objects) for portability through JSON.
 *   - `id` fields obey the pattern in `lib/server/storage.assertSafeId()` —
 *     alnum + `._-`, no leading dot, no `..`. This is what stops path traversal.
 *   - Discriminated unions (notably `StudioNodeData` and `RunEvent`) are
 *     narrowed via the `kind`/`type` field. Use `parseNodeData()` for nodes;
 *     prefer switch statements over `if (x.kind === "...")` chains.
 */
import type { CSSProperties } from "react";

/**
 * A project is the top-level creative unit. It owns assets, workflow runs,
 * and a free-form composer state. Counts (`assetCount`, `workflowCount`) are
 * cached on the project record and recomputed by `recountProject` after
 * mutating operations — they're approximate, not transactional.
 */
export interface Project {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  workflowCount: number;
  thumbnail?: string;
}

/**
 * Lightweight reference to an asset, used in composer chips + workflow inputs.
 * Carries enough to render and resolve back to the full Asset record without
 * bloating canvas state.
 */
export interface AssetRef {
  id: string;
  name: string;
}

/**
 * A single piece of media in a project. Persisted as a JSON sidecar (the
 * source of truth) plus an optional binary file:
 *   - Real assets (uploaded or workflow output) have a binary on disk;
 *     `url` resolves through `/api/projects/[id]/assets/[assetId]/file`.
 *   - Mock-seeded assets have `filename: null` on the sidecar and `url` is a
 *     307-redirect target; the file endpoint forwards to `mockUrl`.
 *
 * `workflowId` is set when the asset was promoted from a workflow run via
 * the SaveOutput executor (project mode only). Provenance details (run id,
 * prompt, etc.) live on the sidecar, not on this UI-facing shape.
 */
export interface Asset {
  id: string;
  projectId: string;
  type: "image" | "video" | "music" | "file";
  name: string;
  url: string;
  thumbnail?: string;
  dimensions?: string;
  duration?: string;
  createdAt: string;
  workflowId?: string;
  isFavorite?: boolean;
}

/**
 * One published version of a workflow. Appended to `Workflow.changelog`
 * when the user clicks Publish — gives them a lightweight history without
 * full versioning infrastructure (no per-version snapshots yet).
 */
export interface WorkflowChangelogEntry {
  version: string;
  notes?: string;
  publishedAt: string;
}

/**
 * A workflow is the canvas DAG plus its metadata. Persisted at
 * `STUDIO_DATA_DIR/workflows/<id>/workflow.json`. Editing happens in the
 * canvas page; running happens through `/api/workflow-runs`.
 */
export interface Workflow {
  id: string;
  name: string;
  version: string;
  type: "image" | "video" | "music" | "mixed";
  description: string;
  nodeCount: number;
  averageTime: string;
  /** @deprecated The environment is determined by the comfyui nodes' chosen endpoints, not by the workflow itself. Kept for legacy seeded data; new workflows should leave this blank. */
  environment: string;
  status: "draft" | "published" | "archived";
  /**
   * History of publish events, oldest first. Appended by `publishWorkflow()`.
   * Optional + tolerates missing/old workflow records that predate the field.
   */
  changelog?: WorkflowChangelogEntry[];
  /**
   * Timestamp the workflow was last published. Convenient for sorting +
   * showing "Published 2 days ago" in the list. Mirrors the latest entry
   * in `changelog` when present.
   */
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  /** Loose at the React Flow boundary; runtime narrows via `parseNodeData` on `data.kind`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

/**
 * Edge in the canvas DAG.
 *
 * Important: this shape mirrors React Flow's `Edge` exactly so we can
 * round-trip through `applyEdgeChanges` without normalization:
 *   - `sourceHandle` / `targetHandle` are `string | null | undefined`
 *     (React Flow emits `null` when there's no specific handle; don't tighten).
 *   - `style` is `CSSProperties` to match React Flow; don't loosen to a
 *     generic record or you'll lose type-safety on common properties.
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  animated?: boolean;
  style?: CSSProperties;
}

// ----- Workflow bundles (import/export) -----

/**
 * Portable workflow bundle — the unit of community sharing.
 *
 * Generated by `exportWorkflow(id)` and consumed by `importWorkflow(bundle)`.
 * Saved as `.studio-workflow.json` files; human-readable, diff-friendly,
 * suitable for committing to git or pasting in a forum thread.
 *
 * Sensitive fields (LLM apiKeys, ComfyUI endpointIds, ImageInput testAssetRef)
 * are stripped on export by each plugin's `sanitizeForExport` hook. The
 * importer re-binds these on the receiving end.
 */
export interface WorkflowBundle {
  /** Schema URL for editor/IDE validation. Currently advisory. */
  $schema?: string;
  /** Bumped when the bundle format changes incompatibly. Currently `1`. */
  bundleVersion: 1;
  /** ISO timestamp when the bundle was generated. */
  exportedAt: string;
  /** Studio version that generated the bundle (from package.json). */
  exportedFromStudio: string;
  /** The workflow itself, minus identity fields the importer assigns. */
  workflow: ExportedWorkflow;
  /**
   * List of plugin kinds the workflow uses. The importer warns if any
   * aren't registered locally — those nodes will load with the
   * UnknownNodeFallback component until the user installs the plugin.
   */
  requiredPlugins: string[];
  /** Optional human-readable notes from the author. */
  notes?: string;
}

/**
 * Workflow shape inside a bundle. Strips identity + cache fields the
 * importer recomputes (id, timestamps, counts, status).
 */
export interface ExportedWorkflow {
  name: string;
  description: string;
  type: Workflow["type"];
  version: string;
  tags: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ----- Studio node data -----

/**
 * Per-node data shapes are defined by each plugin in
 * `plugins/builtin/<name>/manifest.ts` (e.g. `TextInputData`,
 * `LLMNodeData`). They're imported directly from the plugin folder where
 * needed, not re-exported here, to keep this barrel small and the plugin
 * folders self-contained.
 *
 * For the runtime narrowing of `WorkflowNode.data`, use
 * `parseNodeData()` from `@/lib/plugins/parseNodeData`.
 */

// ----- ComfyUI environments and endpoints -----

/**
 * One configured ComfyUI server (local or remote). At most one env can be
 * active at a time — the runtime hits the active env for every project run.
 * The single-active invariant is enforced server-side in `environmentService`.
 */
export interface ComfyUIEnvironment {
  id: string;
  name: string;
  type: "local" | "remote";
  baseUrl: string;
  /** v1: "none" | "comfy-org-key" | "bearer". Older seed data without this field defaults to "none" at read time. */
  authMode?: "none" | "comfy-org-key" | "bearer";
  apiKey?: string;
  isActive: boolean;
  status: "connected" | "disconnected" | "checking";
  lastChecked?: string;
  /** When true and this is the active env, the client polls /health on the configured interval. Defaults to true. */
  healthCheckEnabled?: boolean;
  /** Polling interval in seconds. Defaults to 30. */
  healthCheckIntervalSec?: number;
  /**
   * Hard ceiling per ComfyUI executor invocation. If this much wall-clock
   * elapses without `execution_success` (via WS) OR a completed `getHistory`
   * (via polling fallback), the executor fires `/interrupt` and rejects.
   * Defaults to 1800 (30 min). Range [60, 7200].
   */
  runTimeoutSec?: number;
}

/**
 * Real-time health snapshot for one ComfyUI environment.
 * `null` for any metric the server didn't report (remote envs don't expose host CPU/disk).
 */
export interface HealthSnapshot {
  envId: string;
  status: "connected" | "disconnected" | "checking";
  /** ISO timestamp of the latest probe. */
  lastChecked: string;
  /** Round-trip latency to /system_stats in ms, null if probe failed. */
  latencyMs: number | null;
  /** 0-100 percentages from ComfyUI /system_stats (system.ram_*, devices[0].vram_*). */
  ramPct: number | null;
  vramPct: number | null;
  /** 0-100 percentages from the Next.js host (only meaningful when ComfyUI is local). */
  cpuPct: number | null;
  diskFreePct: number | null;
  /** Free disk space in GB on the Next.js host (where STUDIO_DATA_DIR lives). */
  diskFreeGb: number | null;
  /** First device's name from /system_stats, e.g. "NVIDIA GeForce RTX 4090". */
  deviceName: string | null;
  /** Pending prompts in ComfyUI's queue. */
  queueRemaining: number | null;
  /** ComfyUI server version string. */
  comfyVersion: string | null;
  /** Populated when status === "disconnected" — short user-facing reason. */
  error?: string;
}

/**
 * One user-facing input on a ComfyUI endpoint. The introspection step
 * (`workflow/introspect.ts`) suggests these from a `workflow_api.json`,
 * and the user reviews them in the endpoint dialog before saving.
 *
 * At run time the executor takes the user's value and writes it into the
 * patched workflow JSON at `nodes[comfyNodeId].inputs[comfyInputPath]`.
 */
export interface ComfyEndpointInput {
  /** Human-friendly handle name surfaced on the canvas comfyui node, e.g. "prompt", "negative", "image". */
  studioPort: string;
  label: string;
  /**
   * Binding type. `image` and `video` both go through ComfyUI's `/upload/image`
   * endpoint at run time (which accepts any file in the input directory) but
   * are kept distinct on the studio side so the connection validator can
   * reject obvious mismatches (image asset → video binding, etc.) before the
   * user runs the workflow.
   */
  type: "text" | "image" | "video" | "number" | "boolean" | "select";
  /** Node id inside the workflow_api.json. */
  comfyNodeId: string;
  /** Field name under that node's `inputs`. Typically a single key like "text" or "image". */
  comfyInputPath: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

export interface ComfyEndpointOutput {
  comfyNodeId: string;
  outputType: "image" | "video" | "audio";
  /** Which key inside `history.outputs[node]` to read; usually "images" for SaveImage. */
  outputField: "images" | "video" | "audio" | "files";
}

export interface ComfyEndpoint {
  id: string;
  environmentId: string;
  name: string;
  description?: string;
  inputs: ComfyEndpointInput[];
  output: ComfyEndpointOutput;
  createdAt: string;
  updatedAt: string;
}

// ----- Runs -----

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/**
 * Per-node UI state driven by SSE on the canvas. `skipped` is the result of
 * a Condition node null-routing a branch — every downstream node in that
 * branch gets marked skipped without being executed.
 */
export type NodeRunState = "idle" | "running" | "success" | "failed" | "cancelled" | "skipped";

/**
 * One execution of a workflow. Persisted at `run.json` under either the
 * project's run dir (project mode) or the top-level test runs dir (test
 * mode). The `mode` discriminator drives almost every behavioural difference
 * — see `WORKFLOW-RUNTIME` in docs/ARCHITECTURE.md.
 */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  /**
   * SHA-256 of the canonical-form workflow nodes+edges JSON at the moment
   * this run started. The resume endpoint refuses to resume if the current
   * workflow's hash differs — preserves the assumption that upstream
   * topology + node configuration haven't drifted from when the original
   * run executed. Optional + tolerated as missing on legacy runs that
   * predate the field.
   */
  workflowHash?: string;
  /**
   * Set when this run was started via "Resume from failed step". Points at
   * the parent run whose successful upstream outputs were re-used. Lets the
   * UI render a chain of resumes for traceability.
   */
  resumedFromRunId?: string;
  /** Null for `mode: "test"`. Project runs always have a project. */
  projectId: string | null;
  mode: "test" | "project";
  status: RunStatus;
  inputs: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** Project runs only. Test runs leave this empty. */
  outputAssetIds: string[];
  /** Test runs only. Files written under the run's outputs/ dir (served via /api/workflow-runs/[id]/outputs/[filename]). */
  outputFiles?: TestRunOutputFile[];
  nodeStates: Record<string, NodeRunState>;
  /**
   * Per-node executor result, keyed by node id. Persisted after each node
   * completes so the resume endpoint can re-seed the orchestrator without
   * replaying expensive ComfyUI work. Values are the JSON-serializable
   * subset of `ExecutorOutputs` — Buffer-bearing outputs (test mode only)
   * are silently dropped at persist time.
   */
  nodeOutputs?: Record<string, Record<string, unknown>>;
}

export interface TestRunOutputFile {
  filename: string;
  name: string;
  type: "image" | "video" | "music" | "file";
  mime: string;
}

/**
 * Lightweight projection of a `WorkflowRun` for the run-history list. Adds
 * the workflow's display name (or null if the workflow has been deleted)
 * so the UI doesn't need a second fetch per row.
 *
 * Lives on the public types barrel so client components can consume it
 * without dragging in `server-only` modules. The server-side service
 * `lib/server/runHistoryService.ts` is the single producer.
 */
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string | null;
  status: RunStatus;
  mode: "test" | "project";
  startedAt: string;
  endedAt?: string;
  error?: string;
  outputAssetIds: string[];
}

/**
 * SSE event emitted during a run. Both appended to `events.ndjson` (for
 * replay on reconnect) and published live via `eventBus`. The browser's
 * `useWorkflowStore` consumes these to drive `nodeRunStates` + the test
 * output panel.
 *
 * Order guarantees: `run.started` → ([`node.started` → (`node.progress`*)
 * → (`node.completed` | `node.failed` | `node.skipped`)] for each node) →
 * (`run.completed` | `run.failed` | `run.cancelled`).
 */
export type RunEvent =
  | { type: "run.started"; runId: string; workflowId: string; projectId: string | null }
  | { type: "node.started"; runId: string; nodeId: string }
  | { type: "node.progress"; runId: string; nodeId: string; progress?: number; message?: string; partialText?: string; comfyValue?: number; comfyMax?: number }
  | { type: "node.completed"; runId: string; nodeId: string; outputSummary?: string; preview?: NodePreview }
  | { type: "node.failed"; runId: string; nodeId: string; error: string }
  | { type: "node.skipped"; runId: string; nodeId: string }
  | { type: "run.completed"; runId: string; outputAssetIds: string[]; outputFiles?: TestRunOutputFile[] }
  | { type: "run.failed"; runId: string; error: string }
  | { type: "run.cancelled"; runId: string }
  | {
      /**
       * Free-form log line scoped to a run (and optionally a node). Surfaced
       * in the test panel's Activity Log so users can copy-paste when
       * reporting issues. Auto-emitted by the runtime + ComfyUI executor at
       * key lifecycle points; plugin authors can also call `ctx.emit({
       * type: "run.log", ... })` for custom diagnostics.
       */
      type: "run.log";
      runId: string;
      nodeId?: string;
      level: "debug" | "info" | "warn" | "error";
      message: string;
      timestamp: string;
    };

/**
 * Inline preview attached to a `node.completed` event. Lets the test panel
 * render every stage's output as it lands instead of waiting for the full
 * run to complete. Bytes live on disk under the run's outputs/ dir; this
 * carries only the streaming-URL + display metadata.
 */
export interface NodePreview {
  /** URL the panel can `<img>`/`<video>`/`<audio>` directly. Test mode points at `/api/workflow-runs/[id]/outputs/[filename]`; project mode points at the asset file endpoint. */
  url: string;
  type: "image" | "video" | "music" | "file";
  mime: string;
  name: string;
}

// ----- Legacy + UI plumbing types kept as-is for now -----

export interface LLMProvider {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "gemini" | "ollama" | "custom";
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  models: string[];
  status: "connected" | "disconnected" | "checking";
}

export interface ComposerControl {
  id: string;
  label: string;
  type: "select" | "text" | "number" | "toggle" | "slider";
  options?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  min?: number;
  max?: number;
  step?: number;
}

/** @deprecated Replaced by `RunEvent` and per-node states. Kept for legacy mock data. */
export interface TestRunStep {
  id: string;
  nodeId: string;
  nodeName: string;
  status: "waiting" | "running" | "success" | "failed";
  duration: number;
  message?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
}

export interface NodeTemplate {
  id: string;
  name: string;
  type: string;
  category: "source" | "ai" | "comfyui" | "utility";
  description: string;
  icon: string;
  inputs: NodePort[];
  outputs: NodePort[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultData: Record<string, any>;
}

export interface NodePort {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "image" | "json" | "any";
  required?: boolean;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  type: "image" | "video" | "music" | "mixed";
  nodeCount: number;
  tags: string[];
  thumbnail?: string;
}
