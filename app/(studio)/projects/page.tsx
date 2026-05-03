"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { GradientButton } from "@/components/shared/GradientButton";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Project } from "@/types";
import {
  Folder,
  Plus,
  Search,
  Grid3X3,
  List,
  Clock,
  Image as ImageIcon,
  Workflow,
  ArrowRight,
  Trash2,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type LoadStatus = "idle" | "loading" | "ready" | "error";

export default function ProjectsPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const loadProjects = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { projects } = (await res.json()) as { projects: Project[] };
      setProjects(projects);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      toast.error(err instanceof Error ? err.message : "Failed to load projects");
    }
  };

  useEffect(() => {
    // Defer setState calls inside loadProjects out of the effect's sync frame.
    queueMicrotask(() => void loadProjects());
  }, []);

  const handleDelete = async (project: Project) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      toast.success(`Deleted ${project.name}`);
      void loadProjects();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.description.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [projects, searchQuery]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your creative projects</p>
        </div>
        <GradientButton icon={<Plus className="w-4 h-4" />} onClick={() => setNewDialogOpen(true)}>
          New Project
        </GradientButton>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-panel-soft border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-panel-soft rounded-xl border border-white/10 p-1">
            <button
              onClick={() => setViewMode("grid")}
              className="p-2 rounded-lg transition-colors"
              style={{ backgroundColor: viewMode === "grid" ? "hsl(var(--panel-elevated))" : "transparent" }}
            >
              <Grid3X3 className="w-4 h-4 text-foreground" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="p-2 rounded-lg transition-colors"
              style={{ backgroundColor: viewMode === "list" ? "hsl(var(--panel-elevated))" : "transparent" }}
            >
              <List className="w-4 h-4 text-foreground" />
            </button>
          </div>
        </div>
      </div>

      {status === "loading" && projects.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading projects...
        </div>
      ) : filteredProjects.length === 0 ? (
        <GlassPanel className="p-8 text-center text-xs text-muted-foreground">
          {searchQuery ? `No projects match "${searchQuery}"` : "No projects yet — create one to get started."}
        </GlassPanel>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <GlassPanel className="p-5 hover:border-white/15 transition-all cursor-pointer group h-full">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent-orange/20 flex items-center justify-center">
                    <Folder className="w-6 h-6 text-primary" />
                  </div>
                  <button
                    type="button"
                    title="Delete project"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget(project);
                    }}
                    className="p-1 rounded-lg text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <h3 className="text-sm font-semibold text-foreground mb-1">{project.name}</h3>
                <p className="text-xs text-muted-foreground mb-4 line-clamp-2">{project.description}</p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {project.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-panel-soft text-muted-foreground border border-white/8">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="pt-3 border-t border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> {project.assetCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Workflow className="w-3 h-3" /> {project.workflowCount}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" /> {project.updatedAt}
                  </span>
                </div>
              </GlassPanel>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <GlassPanel className="p-4 hover:border-white/15 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent-orange/20 flex items-center justify-center shrink-0">
                    <Folder className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground">{project.name}</h3>
                    <p className="text-xs text-muted-foreground">{project.description}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{project.assetCount} assets</span>
                    <span>{project.workflowCount} workflows</span>
                    <span>{project.updatedAt}</span>
                  </div>
                  <button
                    type="button"
                    title="Delete project"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget(project);
                    }}
                    className="p-1 rounded-lg text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </GlassPanel>
            </Link>
          ))}
        </div>
      )}

      <NewProjectDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete project?"}
        description={
          deleteTarget
            ? `This permanently removes the project, all of its assets, and any past workflow runs.`
            : ""
        }
        confirmLabel="Delete project"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </div>
  );
}
