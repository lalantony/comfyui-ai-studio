"use client";

import { useCallback } from "react";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { useEnvironmentStore } from "@/stores/useEnvironmentStore";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
  Panel,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NodeRunIndicator } from "@/components/workflows/node-run-indicator";
import { listNodeComponents } from "@/components/workflows/nodeComponents";
import { getManifest } from "@/lib/plugins/manifestRegistry";
import { isValidEdgeConnection } from "@/lib/plugins/connectionValidation";
import { WorkflowNode } from "@/types";
import { ComponentType } from "react";
import { NodeProps } from "@xyflow/react";
// Side-effect imports: populate the manifest + component registries.
import "@/lib/plugins/registerBuiltins";
import "@/components/workflows/registerBuiltinNodes";

function withRunIndicator<P extends NodeProps>(
  Component: ComponentType<P>,
  showIndicator: boolean
): ComponentType<P> {
  if (!showIndicator) return Component;
  const Wrapped = (props: P) => (
    <>
      <Component {...props} />
      <NodeRunIndicator nodeId={props.id} />
    </>
  );
  Wrapped.displayName = `WithRunIndicator(${Component.displayName ?? Component.name ?? "Node"})`;
  return Wrapped;
}

/**
 * Build the React Flow `nodeTypes` map from the plugin registry.
 *
 * Stable reference at module scope — React Flow remounts node instances if
 * `nodeTypes` identity changes, so we compute once after the registry
 * bootstraps have run via the side-effect imports above.
 *
 * Each component gets wrapped with `NodeRunIndicator` if its plugin is
 * executable (Note, the only inert plugin, gets the bare component).
 */
function buildNodeTypes(): Record<string, ComponentType<NodeProps>> {
  const map: Record<string, ComponentType<NodeProps>> = {};
  for (const [kind, Component] of listNodeComponents()) {
    const manifest = getManifest(kind);
    const showIndicator = manifest?.executable ?? true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map[kind] = withRunIndicator(Component as ComponentType<any>, showIndicator);
  }
  return map;
}

const nodeTypes = buildNodeTypes();

const DROP_MIME = "application/reactflow";

function WorkflowCanvasInner() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const setNodes = useWorkflowStore((s) => s.setNodes);
  const setEdges = useWorkflowStore((s) => s.setEdges);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const reactFlow = useReactFlow();

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes as Node[]);
      setNodes(next as WorkflowNode[]);
    },
    [nodes, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, edges as Edge[]);
      setEdges(next);
    },
    [edges, setEdges]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const next = addEdge({ ...params, animated: true }, edges as Edge[]);
      setEdges(next);
    },
    [edges, setEdges]
  );

  // Reject obviously-incompatible connections (text→image, image→text, …) at
  // edit time. Permissive on unresolved types — the runtime executor still
  // validates as a backstop. Reads the ComfyUI endpoint cache from the env
  // store so dynamic handle types participate.
  const findCachedEndpoint = useEnvironmentStore((s) => s.findCachedEndpoint);
  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      isValidEdgeConnection(connection, nodes, (endpointId) => {
        const ep = findCachedEndpoint(endpointId);
        if (!ep) return undefined;
        return {
          // Map ComfyEndpointInput.type → HandleType. ComfyUI's `select` is
          // a parameterised text input from a connection-validation point of
          // view, so we collapse it to `text`.
          inputs: ep.inputs.map((b) => ({
            studioPort: b.studioPort,
            type: b.type === "select" ? ("text" as const) : b.type,
          })),
          output: { outputType: ep.output.outputType },
        };
      }),
    [nodes, findCachedEndpoint]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => setSelectedNodeId(node.id),
    [setSelectedNodeId]
  );

  const onPaneClick = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData(DROP_MIME);
      if (!nodeType || !(nodeType in nodeTypes)) return;
      const manifest = getManifest(nodeType);
      if (!manifest) return;
      // Validate the manifest's defaultData() before persisting it on the
      // canvas. A buggy plugin's factory can return a shape that doesn't
      // match its declared D type — that bad shape would otherwise land
      // in workflow.json on next save and wedge the workflow on reload.
      // Per-shape rules: must be a non-null object, must carry `kind`
      // matching the manifest, and must include `label` (the runtime's
      // parseNodeData defaults this to "" so missing-label is recoverable
      // but worth flagging here).
      let initialData: Record<string, unknown>;
      try {
        const produced = manifest.defaultData();
        if (!produced || typeof produced !== "object") {
          throw new Error("defaultData() did not return an object");
        }
        const dataAsRecord = produced as unknown as Record<string, unknown>;
        if (dataAsRecord.kind !== manifest.kind) {
          throw new Error(
            `defaultData().kind = "${dataAsRecord.kind}", expected "${manifest.kind}"`
          );
        }
        initialData = dataAsRecord;
      } catch (err) {
        // We can't toast from a Zustand action context, but we can warn
        // to the console — the inspector / cookbook will eventually
        // surface this — and refuse the drop.
        console.error(
          `[canvas] refusing to drop "${nodeType}" — defaultData() is malformed:`,
          err
        );
        return;
      }
      const position = reactFlow.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const newNode: WorkflowNode = {
        id: `node-${crypto.randomUUID()}`,
        type: nodeType,
        position,
        data: initialData as WorkflowNode["data"],
      };
      setNodes([...(nodes as WorkflowNode[]), newNode]);
      setSelectedNodeId(newNode.id);
    },
    [nodes, reactFlow, setNodes, setSelectedNodeId]
  );

  return (
    <div className="flex-1 relative rounded-xl overflow-hidden border border-white/8 bg-background">
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        isValidConnection={isValidConnection}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={["Delete", "Backspace"]}
        defaultEdgeOptions={{
          animated: true,
          style: { strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="bg-background" color="rgba(255,255,255,0.05)" />
        <MiniMap
          className="!bg-panel !border !border-white/10 !rounded-xl"
          nodeStrokeWidth={3}
          nodeColor={(node) => {
            const colors: Record<string, string> = {
              textInput: "#a855f7",
              imageInput: "#06b6d4",
              workflowVariable: "#f97316",
              llm: "#a855f7",
              textCombine: "#a855f7",
              condition: "#f97316",
              comfyui: "#f97316",
              saveOutput: "#22c55e",
              note: "#6b7280",
            };
            return colors[node.type || ""] || "#6b7280";
          }}
          maskColor="rgba(0,0,0,0.4)"
        />
        <Controls className="!bg-panel !border !border-white/10 !rounded-xl !shadow-none" />

        {/* Canvas Controls */}
        <Panel position="top-right" className="m-4">
          <div className="flex items-center gap-1 bg-panel/90 backdrop-blur-xl border border-white/10 rounded-xl p-1">
            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l18 18"/><path d="M3 21l18-18"/></svg>
            </button>
            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/><path d="M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v2"/><path d="M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8"/><path d="M18 8a2 2 0 012 2v4a2 2 0 01-2 2h-1.5"/><path d="M6 16a2 2 0 01-2-2v-4a2 2 0 012-2h1.5"/></svg>
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            </button>
            <select className="bg-transparent text-xs text-muted-foreground focus:outline-none cursor-pointer">
              <option>100%</option>
              <option>75%</option>
              <option>50%</option>
              <option>25%</option>
            </select>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}

export const NODE_DROP_MIME = DROP_MIME;
