"use client";

import { memo, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Combine } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { TextCombineData } from "./manifest";

const HANDLE_TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g;

function extractHandles(template: string): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = HANDLE_TOKEN.exec(template)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      handles.push(m[1]);
    }
  }
  return handles;
}

const HANDLE_BASE = "!w-2.5 !h-2.5 !border-2 !border-panel";

function TextCombineNode({ id, data }: NodeProps<TextCombineData>) {
  const update = useNodeUpdate(id);
  const template: string = data?.template ?? "";
  const handles = useMemo(() => extractHandles(template), [template]);
  const spacing = handles.length === 0 ? 0 : 1 / (handles.length + 1);

  return (
    <div className="w-64 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center">
          <Combine className="w-3 h-3 text-primary" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Text Combine"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Template</span>
          <textarea
            value={template}
            onChange={(e) => update({ template: e.target.value })}
            placeholder="{prompt}, {style}"
            rows={3}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
          />
          <p className="text-[10px] text-muted-foreground">
            Use <span className="font-mono">{"{name}"}</span> tokens — each becomes an input handle.
          </p>
        </div>

        {handles.length > 0 && (
          <div className="space-y-0.5 pt-1 border-t border-white/8">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Inputs</span>
            {handles.map((h) => (
              <div key={h} className="flex items-center justify-between text-[10px]">
                <span className="text-foreground">{`{${h}}`}</span>
                <span className="text-muted-foreground font-mono">{h}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {handles.map((h, i) => (
        <Handle
          key={h}
          type="target"
          position={Position.Left}
          id={h}
          className={`${HANDLE_BASE} !bg-primary`}
          style={{ left: -5, top: `${(i + 1) * spacing * 100}%` }}
          title={`{${h}}`}
        />
      ))}

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={`${HANDLE_BASE} !bg-primary`}
        style={{ right: -5, top: "50%" }}
      />
    </div>
  );
}

export default memo(TextCombineNode);
