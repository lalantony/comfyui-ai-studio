"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Image as ImageIcon, Search, Loader2, Folder } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "@/components/ui/callout";
import type { Asset, Project } from "@/types";
import { cn } from "@/lib/utils";

export type TestAssetType = Asset["type"];

export interface PickedTestAsset {
  projectId: string;
  assetId: string;
  name: string;
}

interface TestAssetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filter — currently scoped to image; ready for video/audio when we surface those node types. */
  type: TestAssetType;
  /** Currently-selected asset (for highlighting). */
  selected?: { projectId: string; assetId: string } | null;
  onPick: (picked: PickedTestAsset) => void;
}

interface LoadedProject {
  project: Project;
  assets: Asset[];
}

/**
 * Cross-project asset picker for workflow test inputs.
 *
 * The workflow editor has no notion of "current project" — workflows are
 * studio-wide. So when a designer needs a test image for an Image Input
 * node, they pick from any project's assets via this dialog. The picked
 * asset is recorded as `{ projectId, assetId }` on the node's
 * `data.testAssetRef`, which the runtime resolves at test-run time.
 *
 * Read-only — copying or uploading happens elsewhere (the project asset
 * library). Keeps this dialog focused on selection.
 */
export function TestAssetPickerDialog({
  open,
  onOpenChange,
  type,
  selected,
  onPick,
}: TestAssetPickerDialogProps) {
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedProject[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadStatus("loading");
      setLoadError(null);
    });

    void (async () => {
      try {
        const projRes = await fetch("/api/projects");
        if (!projRes.ok) throw new Error(`${projRes.status} ${projRes.statusText}`);
        const { projects } = (await projRes.json()) as { projects: Project[] };
        const all = await Promise.all(
          projects.map(async (project) => {
            try {
              const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets`);
              if (!r.ok) return { project, assets: [] };
              const { assets } = (await r.json()) as { assets: Asset[] };
              return { project, assets: assets.filter((a) => a.type === type) };
            } catch {
              return { project, assets: [] };
            }
          })
        );
        if (cancelled) return;
        setData(all.filter((p) => p.assets.length > 0));
        setLoadStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load assets");
        setLoadStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, type]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data
      .map(({ project, assets }) => ({
        project,
        assets: assets.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            project.name.toLowerCase().includes(q)
        ),
      }))
      .filter((p) => p.assets.length > 0);
  }, [data, search]);

  const totalAssets = data.reduce((sum, p) => sum + p.assets.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick a test {type}</DialogTitle>
          <DialogDescription>
            Choose an asset from any of your projects. The workflow&apos;s Test Run will use it as the
            input — your projects&apos; real generations are unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search assets or projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full bg-panel-soft border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Body */}
          <div className="min-h-[200px] max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
            {loadStatus === "loading" ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-xs">Loading assets…</span>
              </div>
            ) : loadStatus === "error" ? (
              <Callout tier="error" title="Couldn't load assets">
                {loadError}
              </Callout>
            ) : totalAssets === 0 ? (
              <Callout tier="info" title={`No ${type} assets yet`}>
                Upload one to a project first, then pick it here.
              </Callout>
            ) : filtered.length === 0 ? (
              <Callout tier="info">
                No matches for &quot;{search}&quot;.
              </Callout>
            ) : (
              <div className="space-y-4">
                {filtered.map(({ project, assets }) => (
                  <div key={project.id}>
                    <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <Folder className="w-3 h-3" />
                      {project.name}
                      <span className="font-normal opacity-70 normal-case">
                        · {assets.length} {type}
                        {assets.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {assets.map((asset) => {
                        const isSelected =
                          selected?.projectId === project.id && selected?.assetId === asset.id;
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => {
                              onPick({
                                projectId: project.id,
                                assetId: asset.id,
                                name: asset.name,
                              });
                              onOpenChange(false);
                            }}
                            className={cn(
                              "group relative aspect-square rounded-lg overflow-hidden border transition-all text-left",
                              isSelected
                                ? "border-primary ring-2 ring-primary/40"
                                : "border-white/10 hover:border-white/30"
                            )}
                            title={asset.name}
                          >
                            {asset.type === "video" && asset.url ? (
                              <video
                                src={asset.url}
                                preload="metadata"
                                muted
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                              />
                            ) : asset.thumbnail || asset.url ? (
                              <Image
                                src={asset.thumbnail ?? asset.url}
                                alt={asset.name}
                                fill
                                sizes="(max-width: 640px) 33vw, 192px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-panel-soft text-muted-foreground">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                              <p className="text-[10px] text-white truncate">{asset.name}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
