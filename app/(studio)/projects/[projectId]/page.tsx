"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useProjectStore } from "@/stores/useProjectStore";
import { ProjectGallery } from "@/components/projects/project-gallery";
import { PromptComposer } from "@/components/projects/prompt-composer";
import { AddAssetDialog } from "@/components/projects/add-asset-dialog";
import { RunHistoryTab } from "@/components/projects/run-history-tab";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { cn } from "@/lib/utils";
import { imageComposerControls } from "@/lib/composerControls";
import {
  Folder,
  Pencil,
  MoreHorizontal,
  Tag,
  Clock,
  Image as ImageIcon,
  Workflow,
  Loader2,
  RefreshCw,
  AlertTriangle,
  History,
  LayoutGrid,
} from "lucide-react";

type ProjectTab = "gallery" | "runs";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>("gallery");
  const {
    activeProject,
    isLoadingProject,
    projectError,
    projectErrorKind,
    assetsLoadWarning,
    loadProject,
    setComposerControls,
  } = useProjectStore();

  useEffect(() => {
    void loadProject(projectId);
    setComposerControls(imageComposerControls);
  }, [projectId, loadProject, setComposerControls]);

  if (isLoadingProject && !activeProject) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading project...
      </div>
    );
  }

  if (projectError && !activeProject) {
    // Distinct UX per error kind: 404 → "Go to projects list" (the project
    // is gone, retrying won't help). Other errors → "Retry" (transient
    // network / server issue).
    return (
      <GlassPanel className="p-6 max-w-md mx-auto text-center">
        <h2 className="text-sm font-semibold text-foreground mb-1">
          {projectErrorKind === "not_found" ? "Project not found" : "Couldn't load project"}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">{projectError}</p>
        {projectErrorKind === "not_found" ? (
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-panel-soft border border-white/10 text-xs text-foreground hover:bg-panel-elevated transition-colors"
          >
            <Folder className="w-3.5 h-3.5" />
            Go to projects list
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void loadProject(projectId)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-panel-soft border border-white/10 text-xs text-foreground hover:bg-panel-elevated transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </GlassPanel>
    );
  }

  if (!activeProject) return null;

  return (
    <div className="space-y-4">
      {/* Project Header */}
      <GlassPanel className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent-orange/20 flex items-center justify-center shrink-0">
              <Folder className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">{activeProject.name}</h1>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{activeProject.description}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3 h-3 text-muted-foreground" />
                  {activeProject.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-panel-soft text-muted-foreground border border-white/8">
                      {tag}
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Created {activeProject.createdAt}
                </span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" /> {activeProject.assetCount} assets
                </span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Workflow className="w-3 h-3" /> {activeProject.workflowCount} workflows
                </span>
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Soft warning when assets fetch failed but the project itself loaded.
          Lets the user still navigate, with a clear retry path. */}
      {assetsLoadWarning && (
        <GlassPanel className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <p className="text-xs text-muted-foreground truncate">
              Couldn&apos;t load assets: {assetsLoadWarning}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadProject(projectId)}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-panel-soft border border-white/10 text-[11px] text-foreground hover:bg-panel-elevated transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </GlassPanel>
      )}

      {/* Tabs — Gallery (assets) | Runs (history). The composer always
          renders so the user can keep working from either tab; bottom-fixed
          so it doesn't overlap. */}
      <div className="flex items-center gap-1 border-b border-white/8 px-1">
        <TabButton
          active={activeTab === "gallery"}
          onClick={() => setActiveTab("gallery")}
          icon={<LayoutGrid className="w-3.5 h-3.5" />}
          label="Gallery"
        />
        <TabButton
          active={activeTab === "runs"}
          onClick={() => setActiveTab("runs")}
          icon={<History className="w-3.5 h-3.5" />}
          label="Runs"
        />
      </div>

      {/* Main Content */}
      <div className="min-w-0">
        {activeTab === "gallery" ? (
          <ProjectGallery onAddAsset={() => setAddAssetOpen(true)} />
        ) : (
          <RunHistoryTab projectId={projectId} />
        )}
        <PromptComposer />
      </div>

      <AddAssetDialog open={addAssetOpen} onOpenChange={setAddAssetOpen} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
        active
          ? "text-foreground border-primary"
          : "text-muted-foreground border-transparent hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
