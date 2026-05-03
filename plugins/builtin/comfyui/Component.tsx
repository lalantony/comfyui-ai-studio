"use client";

import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Cpu, ChevronDown, AlertTriangle, FolderOpen, FolderX } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { ComfyEndpoint, ComfyUIEnvironment } from "@/types";
import { useEnvironmentStore } from "@/stores/useEnvironmentStore";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import type { NodeProps } from "@/lib/plugins/types";
import type { ComfyUINodeData } from "./manifest";

const HANDLE_BASE = "!w-2.5 !h-2.5 !border-2 !border-panel";

function ComfyUINode({ id, data }: NodeProps<ComfyUINodeData>) {
  const reactFlow = useReactFlow();

  const environments = useEnvironmentStore((s) => s.environments);
  const loadStatus = useEnvironmentStore((s) => s.loadStatus);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const setEndpointsForEnv = useEnvironmentStore((s) => s.setEndpointsForEnv);
  const activeEnv: ComfyUIEnvironment | undefined =
    environments.find((e) => e.isActive) ?? environments[0];

  const [endpoints, setEndpoints] = useState<ComfyEndpoint[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
  const [endpointsError, setEndpointsError] = useState<string | null>(null);

  useEffect(() => {
    if (loadStatus === "idle") queueMicrotask(() => void loadEnvironments());
  }, [loadStatus, loadEnvironments]);

  useEffect(() => {
    if (!activeEnv) {
      queueMicrotask(() => setEndpoints([]));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setEndpointsLoading(true);
      setEndpointsError(null);
    });
    void fetch(`/api/comfy/environments/${encodeURIComponent(activeEnv.id)}/endpoints`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return (await r.json()) as { endpoints: ComfyEndpoint[] };
      })
      .then(({ endpoints }) => {
        if (cancelled) return;
        setEndpoints(endpoints);
        // Cache for the canvas connection validator (and any other consumer
        // that needs to resolve dynamic ComfyUI handle types synchronously).
        setEndpointsForEnv(activeEnv.id, endpoints);
      })
      .catch((err) => {
        if (!cancelled) setEndpointsError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setEndpointsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEnv, setEndpointsForEnv]);

  const selectedEndpoint = endpoints.find((e) => e.id === data?.endpointId) ?? null;
  const missingEndpoint = !!data?.endpointId && !selectedEndpoint && !endpointsLoading;

  const updateEndpointId = (newId: string) => {
    const endpointId = newId || null;
    reactFlow.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id ? { ...n, data: { ...(n.data ?? {}), kind: "comfyui", endpointId } } : n
      )
    );
  };

  // Default ON: undefined and true both mean "auto-save".
  const saveToProject = data?.saveToProject !== false;
  const toggleSaveToProject = () => {
    reactFlow.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...(n.data ?? {}), kind: "comfyui", saveToProject: !saveToProject } }
          : n
      )
    );
  };

  // Each binding becomes an input handle. If no endpoint is selected, expose nothing.
  // Memoized so the orphan-handle useMemo below has a stable dependency.
  const inputBindings = useMemo(() => selectedEndpoint?.inputs ?? [], [selectedEndpoint]);
  const handleSpacing = inputBindings.length === 0 ? 0 : 1 / (inputBindings.length + 1);

  // Orphan-edge handles: handles are dynamically derived from the endpoint
  // binding which is async-fetched. Until the fetch resolves (and for any
  // edges referencing handles that no longer exist on the current endpoint),
  // we render invisible placeholder handles so React Flow doesn't log
  // "Couldn't create edge for target handle id" warnings on every render.
  // Real bindings, once loaded, render at proper positions and the placeholders
  // step aside (their IDs are excluded from `orphanHandleIds`).
  const workflowEdges = useWorkflowStore((s) => s.edges);
  const orphanHandleIds = useMemo(() => {
    const realIds = new Set(inputBindings.map((b) => b.studioPort));
    const incoming = workflowEdges
      .filter((e) => e.target === id)
      .map((e) => e.targetHandle)
      .filter((h): h is string => !!h && !realIds.has(h));
    return Array.from(new Set(incoming));
  }, [workflowEdges, id, inputBindings]);

  return (
    <div className="w-72 rounded-xl bg-panel border border-accent-orange/30 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-orange/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-accent-orange/20 flex items-center justify-center">
          <Cpu className="w-3 h-3 text-accent-orange" />
        </div>
        <span className="text-xs font-semibold text-foreground">{data?.label || "ComfyUI"}</span>
        {missingEndpoint && (
          <span title="Selected endpoint no longer exists" className="ml-auto">
            <AlertTriangle className="w-3.5 h-3.5 text-danger" />
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Endpoint</span>
          {!activeEnv ? (
            <p className="text-[11px] text-muted-foreground italic">
              No active environment. Configure one in <span className="text-foreground">Settings → ComfyUI</span>.
            </p>
          ) : endpointsError ? (
            <p className="text-[11px] text-danger">{endpointsError}</p>
          ) : (
            <label className="relative block nodrag">
              <select
                value={data?.endpointId ?? ""}
                onChange={(e) => updateEndpointId(e.target.value)}
                disabled={endpointsLoading}
                className="appearance-none w-full bg-panel-soft border border-white/10 rounded-md pl-2 pr-6 py-1.5 text-[11px] text-foreground hover:border-white/20 focus:outline-none focus:border-primary/50 cursor-pointer transition-colors disabled:opacity-50"
              >
                <option value="">{endpointsLoading ? "Loading..." : "— Select an endpoint —"}</option>
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </label>
          )}
        </div>

        {selectedEndpoint ? (
          <>
            <div className="text-[10px] text-muted-foreground">
              <span className="capitalize">{selectedEndpoint.output.outputType}</span> output ·{" "}
              {inputBindings.length} input{inputBindings.length === 1 ? "" : "s"} on{" "}
              <span className="text-foreground">{activeEnv?.name}</span>
            </div>

            <button
              type="button"
              onClick={toggleSaveToProject}
              title={
                saveToProject
                  ? "Output is saved to the project gallery as soon as it completes. Click to opt out."
                  : "Output is held in-memory until a downstream Save Output (or another stage) consumes it. Click to auto-save."
              }
              className={`nodrag w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[10px] transition-colors ${
                saveToProject
                  ? "bg-accent-green/10 border-accent-green/30 text-accent-green hover:bg-accent-green/15"
                  : "bg-panel-soft border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {saveToProject ? <FolderOpen className="w-3 h-3" /> : <FolderX className="w-3 h-3" />}
                {saveToProject ? "Save to project" : "Don't save"}
              </span>
              <span
                className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors ${
                  saveToProject ? "bg-accent-green/60" : "bg-white/15"
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 transform rounded-full bg-foreground transition-transform ${
                    saveToProject ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </span>
            </button>

            {inputBindings.length > 0 && (
              <div className="pt-2 mt-1 border-t border-white/8 space-y-1">
                {inputBindings.map((b) => (
                  <div key={b.studioPort} className="flex items-center justify-between text-[10px]">
                    <span className="text-foreground">{b.label}</span>
                    <span className="text-muted-foreground font-mono">{b.studioPort}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : missingEndpoint ? (
          <p className="text-[10px] text-danger">
            Endpoint <span className="font-mono">{data.endpointId}</span> not found on{" "}
            <span className="text-foreground">{activeEnv?.name}</span>.
          </p>
        ) : null}
      </div>

      {/* Dynamic input handles, one per binding */}
      {inputBindings.map((b, i) => (
        <Handle
          key={b.studioPort}
          type="target"
          position={Position.Left}
          id={b.studioPort}
          className={`${HANDLE_BASE} ${
            b.type === "image" ? "!bg-accent-blue" : b.type === "number" ? "!bg-accent-orange" : "!bg-primary"
          }`}
          style={{ left: -5, top: `${(i + 1) * handleSpacing * 100}%` }}
          title={`${b.label} (${b.type})`}
        />
      ))}

      {/* Orphan-edge placeholder handles — invisible mounts that satisfy
          React Flow during the async endpoint-fetch window (and for stale
          edges referencing handles that no longer exist). They occupy the
          same anchor as the would-be real handle so the edge has somewhere
          to terminate without spamming the console. */}
      {orphanHandleIds.map((handleId, i) => (
        <Handle
          key={`orphan-${handleId}`}
          type="target"
          position={Position.Left}
          id={handleId}
          className="!w-2.5 !h-2.5 !bg-muted/40 !border-2 !border-panel"
          style={{
            left: -5,
            top: `${((i + 1) / (orphanHandleIds.length + 1)) * 100}%`,
            opacity: 0,
            pointerEvents: "none",
          }}
          title={`${handleId} (loading…)`}
        />
      ))}

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={`${HANDLE_BASE} ${
          selectedEndpoint?.output.outputType === "video"
            ? "!bg-accent-pink"
            : selectedEndpoint?.output.outputType === "audio"
              ? "!bg-accent-yellow"
              : "!bg-accent-blue"
        }`}
        style={{ right: -5, top: "50%" }}
      />
    </div>
  );
}

export default memo(ComfyUINode);
