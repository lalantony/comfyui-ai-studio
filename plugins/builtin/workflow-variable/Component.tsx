"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Variable } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { WorkflowVariableData } from "./manifest";

function WorkflowVariableNode({ id, data }: NodeProps<WorkflowVariableData>) {
  const update = useNodeUpdate(id);
  const variable: string = data?.variable ?? "";
  const value: string = data?.value ?? "";

  return (
    <div className="w-56 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-orange/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-accent-orange/20 flex items-center justify-center">
          <Variable className="w-3 h-3 text-accent-orange" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Workflow Variable"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</span>
          <input
            type="text"
            value={variable}
            onChange={(e) => update({ variable: e.target.value })}
            placeholder="e.g. style"
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Value</span>
          <textarea
            value={value}
            onChange={(e) => update({ value: e.target.value })}
            placeholder="Static text emitted to downstream nodes…"
            rows={2}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
          />
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-2.5 !h-2.5 !bg-accent-orange !border-2 !border-panel"
        style={{ right: -5, top: "50%" }}
      />
    </div>
  );
}

export default memo(WorkflowVariableNode);
