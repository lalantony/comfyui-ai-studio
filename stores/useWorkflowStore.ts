/**
 * Workflow store — owns the workflow list, the active workflow's canvas
 * (nodes + edges), inspector state, and live run state.
 *
 * Important: the React Flow canvas is *driven* by this store. The
 * `WorkflowCanvas` component reads `nodes`/`edges` from here and writes back
 * via `setNodes`/`setEdges` on every change (using `applyNodeChanges` /
 * `applyEdgeChanges` from `@xyflow/react`). There is NO parallel local
 * React Flow state — this store is the source of truth. If you find
 * yourself reaching for `useReactFlow().setNodes(...)` directly, route
 * through here instead.
 *
 * `nodeRunStates: Record<nodeId, NodeRunState>` is populated from SSE
 * events during a run, drives the per-node status badges, and resets when
 * a new run starts. Test runs (initiated by the workflow editor's
 * Test Run button) flow through `runTest()` and aggregate output files
 * into `testRunOutput` for the floating output panel.
 */
"use client";

import { create } from "zustand";
import {
  NodePreview,
  NodeRunState,
  RunEvent,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from "@/types";

/** One row in the test panel's stage-preview list. */
export interface StagePreview {
  nodeId: string;
  /** Human-friendly name (node label, with a fallback). */
  label: string;
  /** "running" while the node is executing; transitions to a terminal state on node.completed/failed/skipped. */
  status: "running" | "success" | "failed" | "skipped";
  /** Populated on node.completed for executors that ship a preview field. */
  preview?: NodePreview;
  /** Order in which this row first appeared (= topo order of execution start). */
  startedAt: number;
}

/** One row in the test panel's activity log. */
export interface RunLogLine {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  /** Source node id; absent for runtime-emitted lines. */
  nodeId?: string;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface WorkflowState {
  workflows: Workflow[];
  workflowsLoadStatus: LoadStatus;
  activeWorkflow: Workflow | null;
  activeWorkflowLoadStatus: LoadStatus;
  loadError: string | null;

  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;

  testRunStatus: NodeRunState;
  /**
   * Legacy single-output cell. Now redundant with `stagePreviews` but kept
   * around in case anything still reads it; populated to the *last* preview
   * seen so old callers behave reasonably.
   */
  testRunOutput: { url: string; type: "image" | "video" | "music" | "file"; name?: string } | null;
  testRunError: string | null;
  nodeRunStates: Record<string, NodeRunState>;
  /** One row per executable node, in execution order. Drives the test panel. */
  stagePreviews: StagePreview[];
  /** Activity log scoped to the active run; cleared on each new test run. */
  runLogLines: RunLogLine[];
  inspectorTab: "settings" | "versions";

  /**
   * Auto-save state. `isDirty` flips true on any node/edge mutation and
   * back to false on a successful save. `lastSavedAt` is an ISO timestamp
   * the header pulls for "Saved Xs ago". `isSaving` gates concurrent
   * auto-save fires (we never double-write).
   */
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  saveError: string | null;

  /**
   * Active test-run id, set when `runTest` POSTs the run and cleared on
   * any terminal event (or stream drop). Drives the workflow editor's
   * Run/Stop button. Distinct from project-mode runs which the composer
   * tracks separately.
   */
  currentTestRunId: string | null;
  /** True while a /cancel request is in flight; debounces the Stop button. */
  cancellingTestRun: boolean;

  setWorkflows: (workflows: Workflow[]) => void;
  setActiveWorkflow: (workflow: Workflow | null) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, data: Partial<WorkflowNode>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (id: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  setInspectorTab: (tab: "settings" | "versions") => void;
  setNodeRunState: (id: string, status: NodeRunState) => void;
  clearNodeRunStates: () => void;

  loadWorkflows: () => Promise<void>;
  loadWorkflow: (id: string) => Promise<void>;
  saveWorkflow: () => Promise<void>;
  renameWorkflow: (name: string) => Promise<void>;
  runTest: () => Promise<void>;
  cancelTestRun: () => Promise<void>;
}

// Module-scoped sequence so concurrent `loadWorkflow` calls can detect
// when their result has been superseded and bail out before clobbering
// newer state (rapid /workflows/A → /workflows/B navigation).
let loadWorkflowToken = 0;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${message}`);
  }
  return (await res.json()) as T;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  workflowsLoadStatus: "idle",
  activeWorkflow: null,
  activeWorkflowLoadStatus: "idle",
  loadError: null,

  nodes: [],
  edges: [],
  selectedNodeId: null,

  testRunStatus: "idle",
  testRunOutput: null,
  testRunError: null,
  nodeRunStates: {},
  stagePreviews: [],
  runLogLines: [],
  inspectorTab: "settings",

  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  saveError: null,
  currentTestRunId: null,
  cancellingTestRun: false,

  setWorkflows: (workflows) => set({ workflows }),
  setActiveWorkflow: (workflow) =>
    set({
      activeWorkflow: workflow,
      nodes: workflow?.nodes ?? [],
      edges: workflow?.edges ?? [],
      nodeRunStates: {},
      testRunStatus: "idle",
      testRunOutput: null,
      testRunError: null,
      stagePreviews: [],
      runLogLines: [],
      // Loading/switching workflows resets the dirty/save state — the
      // store is now showing the persisted snapshot, nothing to save.
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      saveError: null,
    }),
  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),
  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node], isDirty: true })),
  updateNode: (id, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...data } : n)),
      isDirty: true,
    })),
  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      // Clear the inspector's pointer if it referenced the removed node.
      // The inspector currently doesn't render per-node settings, but
      // when it does, a stale selectedNodeId would crash on lookup.
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      isDirty: true,
    })),
  addEdge: (edge) => set((state) => ({ edges: [...state.edges, edge], isDirty: true })),
  removeEdge: (id) =>
    set((state) => ({ edges: state.edges.filter((e) => e.id !== id), isDirty: true })),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setNodeRunState: (id, status) =>
    set((state) => ({ nodeRunStates: { ...state.nodeRunStates, [id]: status } })),
  clearNodeRunStates: () => set({ nodeRunStates: {} }),

  loadWorkflows: async () => {
    if (get().workflowsLoadStatus === "loading") return;
    set({ workflowsLoadStatus: "loading", loadError: null });
    try {
      const { workflows } = await fetchJson<{ workflows: Workflow[] }>("/api/workflows");
      set({ workflows, workflowsLoadStatus: "ready" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load workflows";
      set({ workflowsLoadStatus: "error", loadError: message });
    }
  },

  loadWorkflow: async (id) => {
    // Generation token: rapid navigation between workflow URLs can put two
    // loadWorkflow calls in flight; without this guard, A's slow response
    // can overwrite B's after B already populated the canvas. The token
    // discards stale fulfilments.
    loadWorkflowToken += 1;
    const myToken = loadWorkflowToken;
    set({ activeWorkflowLoadStatus: "loading", loadError: null });
    try {
      const { workflow } = await fetchJson<{ workflow: Workflow }>(
        `/api/workflows/${encodeURIComponent(id)}`
      );
      if (myToken !== loadWorkflowToken) return;
      set({
        activeWorkflow: workflow,
        nodes: workflow.nodes ?? [],
        edges: workflow.edges ?? [],
        nodeRunStates: {},
        testRunStatus: "idle",
        testRunOutput: null,
        testRunError: null,
        stagePreviews: [],
        runLogLines: [],
        activeWorkflowLoadStatus: "ready",
      });
    } catch (err) {
      if (myToken !== loadWorkflowToken) return;
      const message = err instanceof Error ? err.message : "Failed to load workflow";
      set({ activeWorkflowLoadStatus: "error", loadError: message });
    }
  },

  saveWorkflow: async () => {
    const { activeWorkflow, nodes, edges, isSaving } = get();
    if (!activeWorkflow) return;
    // Concurrent-save guard: a debounced auto-save can fire while a manual
    // Save click is in-flight (or vice versa). We never want two PUTs
    // racing — return silently and let the in-flight call finish. The
    // dirty flag will still be true if there were edits during that
    // window, and the next debounce fire will pick them up.
    if (isSaving) return;
    set({ isSaving: true, saveError: null });
    try {
      const { workflow } = await fetchJson<{ workflow: Workflow }>(
        `/api/workflows/${encodeURIComponent(activeWorkflow.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodes, edges }),
        }
      );
      // Capture the dirty flag observed when we started; if the user kept
      // editing during the save round-trip, isDirty was bumped to true
      // again — don't clobber that.
      set((state) => ({
        activeWorkflow: workflow,
        isSaving: false,
        lastSavedAt: new Date().toISOString(),
        // Only clear isDirty if no edits arrived while we were saving.
        // We check by comparing references: if `nodes` and `edges` are
        // the same objects we sent, nothing changed underneath us.
        isDirty: state.nodes !== nodes || state.edges !== edges,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      set({ isSaving: false, saveError: message, loadError: message });
      throw err;
    }
  },

  renameWorkflow: async (name) => {
    const { activeWorkflow, workflows } = get();
    if (!activeWorkflow) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === activeWorkflow.name) return;
    const { workflow } = await fetchJson<{ workflow: Workflow }>(
      `/api/workflows/${encodeURIComponent(activeWorkflow.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      }
    );
    set({
      activeWorkflow: workflow,
      workflows: workflows.map((w) => (w.id === workflow.id ? workflow : w)),
    });
  },

  runTest: async () => {
    const { activeWorkflow, nodes } = get();
    if (!activeWorkflow) {
      set({ testRunStatus: "failed", testRunError: "No workflow loaded" });
      return;
    }
    if (nodes.length === 0) {
      set({ testRunStatus: "failed", testRunError: "Workflow has no nodes" });
      return;
    }

    // Test runs are project-independent — they live under .studio-data/runs/<runId>/
    // and never touch project assets. Image inputs that need a real asset must
    // pin one on the node via `data.testAssetRef`.

    set({
      testRunStatus: "running",
      testRunOutput: null,
      testRunError: null,
      nodeRunStates: Object.fromEntries(nodes.map((n) => [n.id, "idle" as NodeRunState])),
      stagePreviews: [],
      runLogLines: [],
      currentTestRunId: null,
      cancellingTestRun: false,
    });

    let runId: string;
    try {
      const res = await fetch("/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: activeWorkflow.id,
          mode: "test",
          inputs: {},
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as { runId: string };
      runId = json.runId;
      set({ currentTestRunId: runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start run";
      set({ testRunStatus: "failed", testRunError: message });
      return;
    }

    // Stream events directly via fetch; we can't use EventSource inside a Zustand action
    // (no addEventListener-style API in the store layer), and fetch + ReadableStream is fine here.
    //
    // Idle timeout: a malformed server response (network blip, dev hot-reload,
    // etc.) could leave the reader.read() hanging indefinitely. Reset a 60s
    // timer on every SSE event; if it fires, abort the fetch and fall back
    // to a "Stream idle, server may still be running" failure mode. The
    // runtime's hard timeout per stage bounds the worst case but the read
    // loop deserves its own fence.
    const sseAbort = new AbortController();
    let idleHandle: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      if (idleHandle) clearTimeout(idleHandle);
      idleHandle = setTimeout(() => {
        sseAbort.abort();
      }, 60_000);
    };
    try {
      const evRes = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}/events`, {
        signal: sseAbort.signal,
      });
      if (!evRes.ok || !evRes.body) throw new Error(`SSE ${evRes.status}`);
      const reader = evRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalEvent: RunEvent | null = null;
      resetIdleTimer();

      readLoop: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n\n");
        while (nl !== -1) {
          const block = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            resetIdleTimer();
            // Wrap the WHOLE event handling in try/catch — not just JSON.parse —
            // so a single malformed event or a handler exception can't kill
            // the read loop and leave testRunStatus stuck in "running".
            try {
              const event = JSON.parse(line.slice(5).trim()) as RunEvent;
              try {
                handleEvent(event, set, get);
              } catch (handlerErr) {
                // Fall through to terminal-event check even if the handler
                // exploded — the run might still report success/failure.
                console.warn("[workflow runtest] handleEvent threw", handlerErr);
              }
              if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
                finalEvent = event;
                break readLoop;
              }
            } catch {
              /* ignore parse errors */
            }
          }
          nl = buffer.indexOf("\n\n");
        }
      }

      if (!finalEvent) {
        set({ testRunStatus: "failed", testRunError: "Stream ended without a terminal event" });
      }
    } catch (err) {
      // Distinguish "the user stopped" / "the idle timer fired" from
      // genuine network / server errors so the UI shows the right state.
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted/i.test(err.message));
      if (aborted) {
        // The cancellation path's terminal event will have already
        // updated testRunStatus to "cancelled" if the user pressed Stop;
        // otherwise we treat it as an idle-timeout failure.
        const status = get().testRunStatus;
        if (status === "running") {
          set({ testRunStatus: "failed", testRunError: "Stream idle — server may still be running. Check the runs folder for output." });
        }
      } else {
        const message = err instanceof Error ? err.message : "Stream error";
        set({ testRunStatus: "failed", testRunError: message });
      }
    } finally {
      if (idleHandle) clearTimeout(idleHandle);
      // Always clear the runId on stream end so the Test Run button
      // returns to its idle state.
      set({ currentTestRunId: null, cancellingTestRun: false });
    }
  },

  cancelTestRun: async () => {
    const runId = get().currentTestRunId;
    if (!runId || get().cancellingTestRun) return;
    set({ cancellingTestRun: true });
    try {
      const res = await fetch(
        `/api/workflow-runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST" }
      );
      // 200 with { status: "already_finished" } is a no-op; 404 means
      // the run id is unknown (also harmless, the SSE loop will end).
      // Any other status surfaces as a save error.
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      // Don't clear currentTestRunId here — let the SSE stream observe
      // run.cancelled and clean up via the finally block in runTest.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cancel failed";
      set({ cancellingTestRun: false, testRunError: message });
    }
  },
}));

function nodeLabelFor(nodes: WorkflowNode[], nodeId: string): string {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  // Walk a few common label-bearing fields without trapping ourselves in any
  // one plugin's `data` shape.
  const data = node.data as { label?: string; kind?: string } | undefined;
  return data?.label || data?.kind || node.type || nodeId;
}

function upsertStagePreview(
  current: StagePreview[],
  nodeId: string,
  patch: Partial<StagePreview>,
  fallbackLabel: string
): StagePreview[] {
  const idx = current.findIndex((p) => p.nodeId === nodeId);
  if (idx === -1) {
    return [
      ...current,
      {
        nodeId,
        label: fallbackLabel,
        status: "running",
        startedAt: Date.now(),
        ...patch,
      },
    ];
  }
  const next = current.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

function handleEvent(
  event: RunEvent,
  set: (partial: Partial<WorkflowState>) => void,
  get: () => WorkflowState
): void {
  switch (event.type) {
    case "run.started":
      // Already in "running"
      break;
    case "node.started": {
      const state = get();
      const label = nodeLabelFor(state.nodes, event.nodeId);
      set({
        nodeRunStates: { ...state.nodeRunStates, [event.nodeId]: "running" },
        stagePreviews: upsertStagePreview(
          state.stagePreviews,
          event.nodeId,
          { status: "running" },
          label
        ),
      });
      break;
    }
    case "node.progress":
      // Visible via progress bar; no state change beyond keeping "running"
      break;
    case "node.completed": {
      const state = get();
      const label = nodeLabelFor(state.nodes, event.nodeId);
      set({
        nodeRunStates: { ...state.nodeRunStates, [event.nodeId]: "success" },
        stagePreviews: upsertStagePreview(
          state.stagePreviews,
          event.nodeId,
          {
            status: "success",
            ...(event.preview ? { preview: event.preview } : {}),
          },
          label
        ),
        // Keep `testRunOutput` populated to the latest preview so any legacy
        // consumer still gets *something* viewable.
        ...(event.preview
          ? {
              testRunOutput: {
                url: event.preview.url,
                type: event.preview.type,
                name: event.preview.name,
              },
            }
          : {}),
      });
      break;
    }
    case "node.failed": {
      const state = get();
      const label = nodeLabelFor(state.nodes, event.nodeId);
      set({
        nodeRunStates: { ...state.nodeRunStates, [event.nodeId]: "failed" },
        stagePreviews: upsertStagePreview(
          state.stagePreviews,
          event.nodeId,
          { status: "failed" },
          label
        ),
      });
      break;
    }
    case "node.skipped": {
      const state = get();
      const label = nodeLabelFor(state.nodes, event.nodeId);
      set({
        nodeRunStates: { ...state.nodeRunStates, [event.nodeId]: "skipped" },
        stagePreviews: upsertStagePreview(
          state.stagePreviews,
          event.nodeId,
          { status: "skipped" },
          label
        ),
      });
      break;
    }
    case "run.log": {
      const state = get();
      // Cap at 500 lines to keep memory bounded on long-running test sessions.
      const next: RunLogLine[] = [
        ...state.runLogLines,
        {
          timestamp: event.timestamp,
          level: event.level,
          message: event.message,
          nodeId: event.nodeId,
        },
      ];
      const trimmed = next.length > 500 ? next.slice(next.length - 500) : next;
      set({ runLogLines: trimmed });
      break;
    }
    case "run.completed": {
      // Test mode: outputs are files under the run's outputs dir.
      const firstFile = event.outputFiles?.[0];
      if (firstFile) {
        useWorkflowStore.setState({
          testRunOutput: {
            url: `/api/workflow-runs/${encodeURIComponent(event.runId)}/outputs/${encodeURIComponent(firstFile.filename)}`,
            type: firstFile.type,
            name: firstFile.name,
          },
        });
      }
      set({ testRunStatus: "success" });
      break;
    }
    case "run.failed":
      set({ testRunStatus: "failed", testRunError: event.error });
      break;
    case "run.cancelled":
      set({ testRunStatus: "cancelled" });
      break;
  }
}
