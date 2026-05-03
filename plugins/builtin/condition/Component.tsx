"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { ConditionData } from "./manifest";

const PREDICATES = [
  { id: "isSet", label: "is set" },
  { id: "isEmpty", label: "is empty" },
  { id: "equals", label: "equals" },
  { id: "contains", label: "contains" },
] as const;

type Predicate = ConditionData["predicate"];

function ConditionNode({ id, data }: NodeProps<ConditionData>) {
  const update = useNodeUpdate(id);
  const predicate: Predicate = data?.predicate ?? "isSet";
  const compareValue: string = data?.compareValue ?? "";
  const needsValue = predicate === "equals" || predicate === "contains";

  return (
    <div className="w-56 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-orange/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-accent-orange/20 flex items-center justify-center">
          <GitBranch className="w-3 h-3 text-accent-orange" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Condition"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">If input…</span>
          <select
            value={predicate}
            onChange={(e) => update({ predicate: e.target.value as Predicate })}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
          >
            {PREDICATES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {needsValue && (
          <div className="space-y-1 nodrag">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Value</span>
            <input
              type="text"
              value={compareValue}
              onChange={(e) => update({ compareValue: e.target.value })}
              placeholder={predicate === "equals" ? "Exact match…" : "Substring…"}
              className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            <span className="text-[10px] text-accent-green">true</span>
          </div>
          <div className="flex-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-danger" />
            <span className="text-[10px] text-danger">false</span>
          </div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-2.5 !h-2.5 !bg-accent-orange !border-2 !border-panel"
        style={{ left: -5, top: "50%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        className="!w-2.5 !h-2.5 !bg-accent-green !border-2 !border-panel"
        style={{ right: -5, top: "35%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        className="!w-2.5 !h-2.5 !bg-danger !border-2 !border-panel"
        style={{ right: -5, top: "65%" }}
      />
    </div>
  );
}

export default memo(ConditionNode);
