"use client";

import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/useProjectStore";
import { Asset } from "@/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Select } from "@/components/ui/select";
import { AssetViewerDialog } from "./asset-viewer-dialog";
import {
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Heart,
  Eye,
  Download,
  Trash2,
  Play,
  Plus,
  Grid3X3,
  List,
  Filter,
  Check,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";

const TYPE_COLOR: Record<Asset["type"], string> = {
  image: "text-accent-blue",
  video: "text-accent-pink",
  music: "text-accent-yellow",
  file: "text-muted-foreground",
};

function AssetThumbnail({ asset }: { asset: Asset }) {
  const [errored, setErrored] = useState(false);

  // Image: optimized via next/image. Video: browser-native first-frame preview
  // through `<video preload="metadata">` — the browser shows the first frame
  // as a still without downloading the whole file. Audio + file types fall
  // through to the icon below.
  if (asset.type === "image" && asset.thumbnail && !errored) {
    return (
      <Image
        src={asset.thumbnail}
        alt={asset.name}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 256px"
        onError={() => setErrored(true)}
        className="object-cover"
      />
    );
  }

  if (asset.type === "video" && asset.url && !errored) {
    return (
      <>
        <video
          src={asset.url}
          preload="metadata"
          muted
          playsInline
          onError={() => setErrored(true)}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
        </div>
      </>
    );
  }

  const icon = (() => {
    switch (asset.type) {
      case "image":
        return <ImageIcon className="w-7 h-7" />;
      case "video":
        return <Video className="w-7 h-7" />;
      case "music":
        return <Music className="w-7 h-7" />;
      default:
        return <FileText className="w-7 h-7" />;
    }
  })();

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-panel-soft to-panel-elevated flex items-center justify-center">
      <div className={cn("flex items-center justify-center", TYPE_COLOR[asset.type])}>
        {icon}
      </div>
      {asset.type === "video" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <Play className="w-4 h-4 text-white ml-0.5" />
          </div>
        </div>
      )}
    </div>
  );
}

function AssetCard({
  asset,
  isSelected,
  onSelect,
  onView,
  onDownload,
  onDelete,
}: {
  asset: Asset;
  isSelected: boolean;
  onSelect: () => void;
  onView: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // "Just generated" pulse: assets created within the last ~10s briefly
  // ring in the brand colour so the user sees which card is the new one
  // when a multi-stage chain drops several outputs in quick succession.
  // The freshness check happens in an effect (so the render itself stays
  // pure / deterministic) — and clears itself with a timer.
  const [isFresh, setIsFresh] = useState(false);
  useEffect(() => {
    const t = Date.parse(asset.createdAt);
    if (Number.isNaN(t)) return;
    const remaining = 10_000 - (Date.now() - t);
    if (remaining <= 0) return;
    queueMicrotask(() => setIsFresh(true));
    const handle = setTimeout(() => setIsFresh(false), remaining);
    return () => clearTimeout(handle);
  }, [asset.createdAt]);

  return (
    <div
      className={cn(
        "group relative rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer",
        isSelected
          ? "border-primary/60 shadow-[0_0_0_1px_rgba(124,92,255,0.5)]"
          : "border-white/8 hover:border-white/15",
        isFresh && !isSelected && "ring-2 ring-accent-orange/50 animate-pulse"
      )}
      onClick={onSelect}
      onDoubleClick={(e) => {
        stop(e);
        onView();
      }}
    >
      <div className="aspect-square relative bg-panel-soft overflow-hidden">
        <AssetThumbnail asset={asset} />

        {/* Top-right action cluster */}
        <div
          className={cn(
            "absolute top-2 right-2 flex items-center gap-1 transition-opacity duration-200",
            "opacity-0 group-hover:opacity-100",
            isSelected && "opacity-100"
          )}
        >
          <button
            type="button"
            title="Favorite"
            onClick={(e) => stop(e)}
            className="w-7 h-7 rounded-lg bg-black/55 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/75 transition-colors"
          >
            <Heart className={cn("w-3.5 h-3.5", asset.isFavorite && "fill-accent-pink text-accent-pink")} />
          </button>
          <button
            type="button"
            title="View"
            onClick={(e) => {
              stop(e);
              onView();
            }}
            className="w-7 h-7 rounded-lg bg-black/55 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/75 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Download"
            onClick={(e) => {
              stop(e);
              onDownload();
            }}
            className="w-7 h-7 rounded-lg bg-black/55 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/75 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Delete"
            onClick={(e) => {
              stop(e);
              onDelete();
            }}
            className="w-7 h-7 rounded-lg bg-black/55 backdrop-blur-sm flex items-center justify-center text-white hover:bg-danger/80 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="absolute bottom-2 left-2">
          <span
            className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm",
              TYPE_COLOR[asset.type]
            )}
          >
            {asset.type}
          </span>
        </div>

        {isSelected && (
          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      <div className="p-2.5 bg-panel">
        <p className="text-xs font-medium text-foreground truncate" title={asset.name}>
          {asset.name}
        </p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-muted-foreground">{asset.createdAt}</span>
          {asset.dimensions && <span className="text-[10px] text-muted-foreground">{asset.dimensions}</span>}
          {asset.duration && <span className="text-[10px] text-muted-foreground">{asset.duration}</span>}
        </div>
      </div>
    </div>
  );
}

function AddAssetCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square flex flex-col items-center justify-center rounded-xl border border-dashed border-white/15 hover:border-white/30 hover:bg-panel-soft/50 transition-all duration-200 gap-2"
    >
      <Plus className="w-5 h-5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">Add asset</span>
    </button>
  );
}

interface ProjectGalleryProps {
  onAddAsset: () => void;
}

export function ProjectGallery({ onAddAsset }: ProjectGalleryProps) {
  const {
    assets,
    selectedAssets,
    galleryFilter,
    gallerySort,
    viewMode,
    toggleAssetSelection,
    setGalleryFilter,
    setGallerySort,
    setViewMode,
    removeAsset,
  } = useProjectStore();

  const [viewerAsset, setViewerAsset] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);

  const handleDownload = async (asset: Asset) => {
    try {
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = asset.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await removeAsset(target.id);
      toast.success(`Deleted ${target.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const filtered = useMemo(() => {
    let arr = assets.filter((asset) => {
      if (galleryFilter === "all") return true;
      if (galleryFilter === "favorites") return asset.isFavorite;
      return asset.type === galleryFilter;
    });
    arr = [...arr].sort((a, b) => {
      switch (gallerySort) {
        case "oldest":
          return a.createdAt < b.createdAt ? -1 : 1;
        case "name":
          return a.name.localeCompare(b.name);
        case "type":
          return a.type.localeCompare(b.type);
        case "newest":
        default:
          return a.createdAt < b.createdAt ? 1 : -1;
      }
    });
    return arr;
  }, [assets, galleryFilter, gallerySort]);

  const filters = [
    { id: "all", label: "All", count: assets.length },
    { id: "images", label: "Images", count: assets.filter((a) => a.type === "image").length },
    { id: "videos", label: "Videos", count: assets.filter((a) => a.type === "video").length },
    { id: "music", label: "Music", count: assets.filter((a) => a.type === "music").length },
    { id: "favorites", label: "Favorites", count: assets.filter((a) => a.isFavorite).length },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {filters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setGalleryFilter(filter.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                galleryFilter === filter.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-panel-soft"
              )}
            >
              {filter.label}
              <span className="text-[10px] opacity-70">{filter.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            value={gallerySort}
            onChange={(e) => setGallerySort(e.target.value)}
            className="text-muted-foreground"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name</option>
            <option value="type">Type</option>
          </Select>
          <div className="flex items-center bg-panel-soft rounded-lg border border-white/10 p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                viewMode === "grid"
                  ? "bg-panel-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                viewMode === "list"
                  ? "bg-panel-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Gallery */}
      {viewMode === "grid" ? (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {filtered.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              isSelected={selectedAssets.includes(asset.id)}
              onSelect={() => toggleAssetSelection(asset.id)}
              onView={() => setViewerAsset(asset)}
              onDownload={() => void handleDownload(asset)}
              onDelete={() => setDeleteTarget(asset)}
            />
          ))}
          <AddAssetCard onClick={onAddAsset} />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((asset) => (
            <div
              key={asset.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 cursor-pointer",
                selectedAssets.includes(asset.id)
                  ? "border-primary/60 bg-primary/5"
                  : "border-white/8 hover:border-white/15 hover:bg-panel-soft/50"
              )}
              onClick={() => toggleAssetSelection(asset.id)}
            >
              <div className="w-12 h-12 rounded-lg bg-panel-elevated overflow-hidden shrink-0 relative">
                <AssetThumbnail asset={asset} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{asset.name}</p>
                <p className="text-xs text-muted-foreground">{asset.createdAt}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {asset.dimensions && <span>{asset.dimensions}</span>}
                {asset.duration && <span>{asset.duration}</span>}
                <span className="capitalize">{asset.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AssetViewerDialog
        asset={viewerAsset}
        onOpenChange={(open) => !open && setViewerAsset(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete asset?"}
        description="This permanently removes the asset from the project. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDeleteConfirmed()}
      />
    </div>
  );
}
