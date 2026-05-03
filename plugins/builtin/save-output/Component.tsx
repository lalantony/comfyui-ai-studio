"use client";

import { memo, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Info, Save } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import type { NodeProps } from "@/lib/plugins/types";
import type { SaveOutputData } from "./manifest";

function SaveOutputNode({ id, data }: NodeProps<SaveOutputData>) {
  const update = useNodeUpdate(id);
  const filename: string = data?.filename ?? "";
  const promote: boolean = data?.promoteToAssets ?? true;

  // Detect the "redundant SaveOutput" pattern: when the only upstream is a
  // ComfyUI node, the user is using SaveOutput as a viewer — but the
  // ComfyUI executor already auto-saves, so this node just renames at best.
  // Show a hint instead of silently letting the user wire up extra nodes.
  const edges = useWorkflowStore((s) => s.edges);
  const nodes = useWorkflowStore((s) => s.nodes);
  const upstreamIsComfyOnly = useMemo(() => {
    const incoming = edges.filter((e) => e.target === id);
    if (incoming.length === 0) return false;
    return incoming.every((e) => {
      const src = nodes.find((n) => n.id === e.source);
      return (src?.data as { kind?: string } | undefined)?.kind === "comfyui";
    });
  }, [edges, nodes, id]);

  return (
    <div className="w-60 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-green/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-accent-green/20 flex items-center justify-center">
          <Save className="w-3 h-3 text-accent-green" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Save Output"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3 space-y-2">
        {upstreamIsComfyOnly && (
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-panel-soft border border-white/10 rounded-md px-2 py-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0 text-accent-blue" />
            <span>
              ComfyUI auto-saves its output already. This node now only{" "}
              <span className="text-foreground">renames</span> the saved
              asset to <span className="font-mono text-foreground">{filename || "auto"}</span>.
              You can delete it if you don&apos;t need a custom filename.
            </span>
          </div>
        )}

        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Filename</span>
          <input
            type="text"
            value={filename}
            onChange={(e) => update({ filename: e.target.value })}
            placeholder="auto"
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        <label className="flex items-center justify-between gap-2 nodrag pt-1">
          <span className="text-[10px] text-muted-foreground">Promote to project assets</span>
          <input
            type="checkbox"
            checked={promote}
            onChange={(e) => update({ promoteToAssets: e.target.checked })}
            className="accent-accent-green"
          />
        </label>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-2.5 !h-2.5 !bg-accent-blue !border-2 !border-panel"
        style={{ left: -5, top: "50%" }}
      />
    </div>
  );
}

export default memo(SaveOutputNode);
