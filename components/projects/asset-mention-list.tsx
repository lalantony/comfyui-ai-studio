"use client";

import { Asset } from "@/types";
import { cn } from "@/lib/utils";
import { Image as ImageIcon, Video as VideoIcon, Music as MusicIcon, File as FileIcon } from "lucide-react";
import { useEffect, useRef } from "react";

interface AssetMentionListProps {
  assets: Asset[];
  query: string;
  highlightedIndex: number;
  onHighlightChange: (index: number) => void;
  onSelect: (asset: Asset) => void;
  /** When provided, only these asset types are listed. */
  acceptTypes?: ReadonlyArray<Asset["type"]>;
}

const TYPE_ICON: Record<Asset["type"], typeof ImageIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  music: MusicIcon,
  file: FileIcon,
};

const TYPE_COLOR: Record<Asset["type"], string> = {
  image: "text-accent-blue",
  video: "text-accent-pink",
  music: "text-accent-yellow",
  file: "text-muted-foreground",
};

/**
 * Filter the asset list by name match. When `acceptTypes` is provided,
 * the result is also restricted to those types — used by the composer
 * to scope the popover to the workflow's expected input type so the
 * user can't pick a video for a workflow that wants an image.
 */
export function filterAssetsByQuery(
  assets: Asset[],
  query: string,
  acceptTypes?: ReadonlyArray<Asset["type"]>
): Asset[] {
  const q = query.trim().toLowerCase();
  const typeMatches = (a: Asset) =>
    !acceptTypes || acceptTypes.length === 0 || acceptTypes.includes(a.type);
  const baseList = assets.filter(typeMatches);
  if (!q) return baseList.slice(0, 20);
  return baseList
    .filter((a) => a.name.toLowerCase().includes(q))
    .slice(0, 20);
}

export function AssetMentionList({
  assets,
  query,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  acceptTypes,
}: AssetMentionListProps) {
  const filtered = filterAssetsByQuery(assets, query, acceptTypes);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No assets match &ldquo;{query}&rdquo;
      </div>
    );
  }

  return (
    <div ref={listRef} className="max-h-64 overflow-y-auto scrollbar-thin py-1">
      {filtered.map((asset, i) => {
        const Icon = TYPE_ICON[asset.type];
        const colorClass = TYPE_COLOR[asset.type];
        const highlighted = i === highlightedIndex;
        return (
          <button
            key={asset.id}
            data-index={i}
            type="button"
            onMouseEnter={() => onHighlightChange(i)}
            onClick={() => onSelect(asset)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
              highlighted ? "bg-primary/15" : "hover:bg-panel-soft"
            )}
          >
            <div className={cn("w-7 h-7 rounded-md bg-panel-elevated flex items-center justify-center shrink-0", colorClass)}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{asset.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {asset.type}
                {asset.dimensions ? ` • ${asset.dimensions}` : ""}
                {asset.duration ? ` • ${asset.duration}` : ""}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
