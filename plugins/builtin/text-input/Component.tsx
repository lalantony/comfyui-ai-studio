"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Type } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { TextInputData } from "./manifest";

function TextInputNode({ id, data }: NodeProps<TextInputData>) {
  const update = useNodeUpdate(id);
  const testValue: string = data?.testValue ?? "";
  const required: boolean = !!data?.required;
  const isPrimary: boolean = !!data?.isPrimary;
  const maxLength: number | "" = typeof data?.maxLength === "number" ? data.maxLength : "";

  return (
    <div className="w-64 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center">
          <Type className="w-3 h-3 text-primary" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Text Input"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Test value</span>
          <textarea
            value={testValue}
            onChange={(e) => update({ testValue: e.target.value })}
            placeholder="Prompt used during Test Run…"
            rows={3}
            maxLength={typeof maxLength === "number" ? maxLength : undefined}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none nodrag"
          />
          {typeof maxLength === "number" && (
            <p className="text-[10px] text-muted-foreground text-right">
              {testValue.length}/{maxLength}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer nodrag">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => update({ required: e.target.checked })}
              className="accent-primary"
            />
            Required
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer nodrag">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => update({ isPrimary: e.target.checked })}
              className="accent-primary"
            />
            Primary input
          </label>
        </div>

        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Max length</span>
          <input
            type="number"
            min={1}
            value={maxLength}
            onChange={(e) => {
              const v = e.target.value;
              update({ maxLength: v === "" ? undefined : Math.max(1, Number(v)) });
            }}
            placeholder="No limit"
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-panel"
        style={{ right: -5, top: "50%" }}
      />
    </div>
  );
}

export default memo(TextInputNode);
