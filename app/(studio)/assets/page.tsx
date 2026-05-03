"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { Asset, Project } from "@/types";
import {
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Heart,
  Search,
  ArrowLeft,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  FolderOpen,
  Library,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

type Filter = "all" | "image" | "video" | "music" | "favorites";

interface ProjectWithAssets extends Project {
  assets: Asset[];
}

const TYPE_COLOR: Record<Asset["type"], string> = {
  image: "text-accent-blue",
  video: "text-accent-pink",
  music: "text-accent-yellow",
  file: "text-muted-foreground",
};

function ThumbCell({ asset }: { asset: Asset | null }) {
  const [errored, setErrored] = useState(false);

  if (!asset) {
    return <div className="bg-panel-soft" />;
  }

  if (asset.type === "image" && asset.thumbnail && !errored) {
    return (
      <div className="relative w-full h-full">
        <Image
          src={asset.thumbnail}
          alt={asset.name}
          fill
          sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 192px"
          onError={() => setErrored(true)}
          className="object-cover"
        />
      </div>
    );
  }

  if (asset.type === "video" && asset.url && !errored) {
    return (
      <div className="relative w-full h-full">
        <video
          src={asset.url}
          preload="metadata"
          muted
          playsInline
          onError={() => setErrored(true)}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      </div>
    );
  }

  const Icon =
    asset.type === "image"
      ? ImageIcon
      : asset.type === "video"
        ? Video
        : asset.type === "music"
          ? Music
          : FileText;

  return (
    <div
      className={cn(
        "w-full h-full bg-gradient-to-br from-panel-soft to-panel-elevated flex items-center justify-center",
        TYPE_COLOR[asset.type]
      )}
    >
      <Icon className="w-5 h-5" />
    </div>
  );
}

function ProjectCollageCard({
  project,
  onClick,
}: {
  project: ProjectWithAssets;
  onClick: () => void;
}) {
  // Show up to 4 assets in a 2x2 collage; pad with nulls if fewer
  const cells: (Asset | null)[] = Array.from({ length: 4 }, (_, i) => project.assets[i] ?? null);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left rounded-xl border border-white/8 hover:border-white/20 bg-panel transition-all overflow-hidden hover:scale-[1.01]"
    >
      <div className="aspect-square bg-panel-soft relative overflow-hidden">
        {project.assets.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <FolderOpen className="w-7 h-7 text-muted-foreground mx-auto mb-1.5" />
              <p className="text-[10px] text-muted-foreground">No assets yet</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 grid-rows-2 gap-px h-full">
            {cells.map((asset, i) => (
              <div key={asset?.id ?? `empty-${i}`} className="overflow-hidden">
                <ThumbCell asset={asset} />
              </div>
            ))}
          </div>
        )}
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] text-white font-medium">
          {project.assets.length}
        </div>
      </div>

      <div className="p-3">
        <p className="text-sm font-medium text-foreground truncate">{project.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{project.description}</p>
      </div>
    </button>
  );
}

function CopyToMenu({
  asset,
  sourceProject,
  allProjects,
  onCopied,
}: {
  asset: Asset;
  sourceProject: ProjectWithAssets;
  allProjects: ProjectWithAssets[];
  onCopied: (target: ProjectWithAssets) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copyingTo, setCopyingTo] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targets = allProjects.filter((p) => p.id !== sourceProject.id);

  const handleCopy = async (target: ProjectWithAssets) => {
    setCopyingTo(target.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${target.id}/assets/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProjectId: sourceProject.id, sourceAssetId: asset.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      setDone(target.id);
      setTimeout(() => setDone(null), 1500);
      onCopied(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setCopyingTo(null);
      setOpen(false);
    }
  };

  if (targets.length === 0) {
    return (
      <span className="text-[10px] text-muted-foreground italic px-2">No other projects</span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-panel-elevated border border-white/10 text-[11px] text-foreground hover:border-white/20 transition-colors"
      >
        {done ? (
          <>
            <Check className="w-3 h-3 text-accent-green" />
            Copied
          </>
        ) : copyingTo ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Copying...
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" />
            Copy to
            <ChevronDown className="w-3 h-3" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 z-50 bg-panel-elevated border border-white/10 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="px-3 py-2 border-b border-white/8 text-[10px] uppercase tracking-wider text-muted-foreground">
              Copy to project
            </div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
              {targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(target);
                  }}
                  disabled={!!copyingTo}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-panel-soft transition-colors disabled:opacity-50"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-foreground truncate">{target.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="absolute right-0 top-full mt-2 px-2 py-1 rounded bg-danger/10 border border-danger/30 text-[10px] text-danger whitespace-nowrap z-50">
          {error}
        </div>
      )}
    </div>
  );
}

function ProjectAssetsView({
  project,
  allProjects,
  onBack,
  onAssetCopied,
}: {
  project: ProjectWithAssets;
  allProjects: ProjectWithAssets[];
  onBack: () => void;
  onAssetCopied: (target: ProjectWithAssets) => void;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to library
      </button>

      <div>
        <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
        <p className="text-xs text-muted-foreground">
          {project.assets.length} assets · Read-only view. Hover an asset to copy it into another project.
        </p>
      </div>

      {project.assets.length === 0 ? (
        <GlassPanel className="p-8 text-center text-xs text-muted-foreground">
          This project has no assets yet.
        </GlassPanel>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {project.assets.map((asset) => (
            <div
              key={asset.id}
              className="group relative rounded-xl overflow-hidden border border-white/8 hover:border-white/15 bg-panel transition-all"
            >
              <div className="aspect-square relative bg-panel-soft overflow-hidden">
                <ThumbCell asset={asset} />
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
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyToMenu
                    asset={asset}
                    sourceProject={project}
                    allProjects={allProjects}
                    onCopied={onAssetCopied}
                  />
                </div>
              </div>
              <div className="p-2.5">
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
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
  const [projects, setProjects] = useState<ProjectWithAssets[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refetch = async () => {
    setError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { projects: list } = (await res.json()) as { projects: Project[] };
      const withAssets = await Promise.all(
        list.map(async (p) => {
          try {
            const r = await fetch(`/api/projects/${p.id}/assets`);
            if (!r.ok) return { ...p, assets: [] };
            const { assets } = (await r.json()) as { assets: Asset[] };
            return { ...p, assets };
          } catch {
            return { ...p, assets: [] };
          }
        })
      );
      setProjects(withAssets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Defer the load to a microtask so setState calls inside refetch don't
    // happen in the effect's synchronous frame.
    queueMicrotask(() => void refetch());
  }, []);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .map((p) => {
        const matching = p.assets.filter((a) => {
          if (filter === "image" && a.type !== "image") return false;
          if (filter === "video" && a.type !== "video") return false;
          if (filter === "music" && a.type !== "music") return false;
          if (filter === "favorites" && !a.isFavorite) return false;
          if (q && !a.name.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
          return true;
        });
        return { ...p, assets: matching };
      })
      .filter((p) => {
        if (q && p.name.toLowerCase().includes(q)) return true;
        return p.assets.length > 0;
      });
  }, [projects, filter, search]);

  const selectedProject = selectedId
    ? filteredProjects.find((p) => p.id === selectedId) ?? projects.find((p) => p.id === selectedId) ?? null
    : null;

  const filters: { id: Filter; label: string; icon: typeof FileText }[] = [
    { id: "all", label: "All", icon: FileText },
    { id: "image", label: "Images", icon: ImageIcon },
    { id: "video", label: "Videos", icon: Video },
    { id: "music", label: "Music", icon: Music },
    { id: "favorites", label: "Favorites", icon: Heart },
  ];

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <GlassPanel className="p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl brand-gradient flex items-center justify-center shrink-0">
          <Library className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Asset Library</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Browse every asset across your projects. Find an existing image, video, or audio and{" "}
            <span className="text-foreground font-medium">copy it into another project</span>.
            Renames and deletions happen inside the project view.
          </p>
        </div>
      </GlassPanel>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-panel-soft border border-white/8 p-1 rounded-xl">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                filter === f.id
                  ? "bg-panel-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects or assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-panel-soft border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 min-w-[260px]"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading library...
        </div>
      ) : error ? (
        <GlassPanel className="p-6 text-center">
          <p className="text-sm text-danger mb-1">Couldn&apos;t load library</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </GlassPanel>
      ) : selectedProject ? (
        <ProjectAssetsView
          project={selectedProject}
          allProjects={projects}
          onBack={() => setSelectedId(null)}
          onAssetCopied={() => {
            void refetch();
          }}
        />
      ) : filteredProjects.length === 0 ? (
        <GlassPanel className="p-8 text-center text-xs text-muted-foreground">
          {search ? `No assets match "${search}"` : "No projects yet — create one to start collecting assets."}
        </GlassPanel>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {filteredProjects.map((p) => (
            <ProjectCollageCard key={p.id} project={p} onClick={() => setSelectedId(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
