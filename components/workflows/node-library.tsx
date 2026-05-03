"use client";

import { cn } from "@/lib/utils";
import { createElement, useState } from "react";
import { Search, Filter, Plus } from "lucide-react";
import {
  listManifests,
  listManifestsByCategory,
} from "@/lib/plugins/manifestRegistry";
import { getIcon } from "@/lib/plugins/icons";
import type { NodeManifest, NodeCategory } from "@/lib/plugins/types";
import { NODE_DROP_MIME } from "./workflow-canvas";
// Side-effect: ensure manifests are registered before we read from the registry.
import "@/lib/plugins/registerBuiltins";

const accentColors: Record<string, string> = {
  purple: "text-primary",
  cyan: "text-accent-blue",
  orange: "text-accent-orange",
  green: "text-accent-green",
  yellow: "text-accent-yellow",
  pink: "text-accent-pink",
  blue: "text-accent-blue",
};

const CATEGORY_ORDER: Array<{ id: NodeCategory; label: string }> = [
  { id: "source", label: "Source" },
  { id: "ai", label: "AI" },
  { id: "processing", label: "Processing" },
  { id: "comfyui", label: "ComfyUI" },
  { id: "utility", label: "Utilities" },
];

function NodeItem({ manifest }: { manifest: NodeManifest }) {
  const colorClass = accentColors[manifest.accent] ?? "text-muted-foreground";

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(NODE_DROP_MIME, manifest.kind);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg border border-white/8 hover:border-white/15 hover:bg-panel-soft cursor-grab active:cursor-grabbing transition-all duration-200 group"
      draggable
      onDragStart={handleDragStart}
      title={manifest.description}
    >
      <div className={cn("w-8 h-8 rounded-lg bg-panel-elevated flex items-center justify-center shrink-0", colorClass)}>
        {createElement(getIcon(manifest.icon), { className: "w-4 h-4" })}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          {manifest.displayName}
          {manifest.experimental && (
            <span className="text-[8px] uppercase tracking-wider text-warning">exp</span>
          )}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">{manifest.description}</p>
      </div>
    </div>
  );
}

export function NodeLibrary() {
  const [searchQuery, setSearchQuery] = useState("");

  const allManifests = listManifests().filter((m) => !m.deprecated);

  const filtered = searchQuery
    ? allManifests.filter(
        (m) =>
          m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : null;

  return (
    <div className="w-64 shrink-0 flex flex-col gap-4">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-panel-soft border border-white/10 rounded-lg pl-8 pr-8 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <Filter className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground cursor-pointer hover:text-foreground" />
        </div>

        <div className="space-y-4 max-h-[calc(100vh-240px)] overflow-y-auto scrollbar-thin pr-1">
          {filtered ? (
            <div className="space-y-1">
              {filtered.map((manifest) => (
                <NodeItem key={manifest.kind} manifest={manifest} />
              ))}
            </div>
          ) : (
            CATEGORY_ORDER.map((category) => {
              const items = listManifestsByCategory(category.id).filter((m) => !m.deprecated);
              if (items.length === 0) return null;
              return (
                <div key={category.id}>
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
                    {category.label}
                  </h3>
                  <div className="space-y-1">
                    {items.map((manifest) => (
                      <NodeItem key={manifest.kind} manifest={manifest} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button className="w-full py-2.5 rounded-lg border border-dashed border-white/15 hover:border-white/30 hover:bg-panel-soft transition-all duration-200 flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="w-3.5 h-3.5" />
          Add Custom Node
        </button>
      </div>
    </div>
  );
}
