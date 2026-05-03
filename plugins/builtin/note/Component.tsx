"use client";

import { memo } from "react";
import { StickyNote } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { NoteData } from "./manifest";

function NoteNode({ id, data }: NodeProps<NoteData>) {
  const update = useNodeUpdate(id);
  const content: string = data?.content ?? "";

  return (
    <div className="w-56 rounded-xl bg-panel/50 border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-white/10 flex items-center justify-center">
          <StickyNote className="w-3 h-3 text-muted-foreground" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Note"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3">
        <textarea
          value={content}
          onChange={(e) => update({ content: e.target.value })}
          placeholder="Add a note..."
          rows={3}
          className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none nodrag"
        />
      </div>
    </div>
  );
}

export default memo(NoteNode);
