"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { GradientButton } from "@/components/shared/GradientButton";
import { NewWorkflowDialog } from "@/components/workflows/new-workflow-dialog";
import { ImportWorkflowDialog } from "@/components/workflows/import-workflow-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { Workflow } from "@/types";
import {
  Plus,
  Search,
  Image as ImageIcon,
  Video,
  Music,
  Layers,
  Clock,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function WorkflowsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"my" | "team" | "community">("my");
  const [showArchived, setShowArchived] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);

  const workflows = useWorkflowStore((s) => s.workflows);
  const loadStatus = useWorkflowStore((s) => s.workflowsLoadStatus);
  const loadWorkflows = useWorkflowStore((s) => s.loadWorkflows);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const handleDelete = async (workflow: Workflow) => {
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      toast.success(`Deleted ${workflow.name}`);
      void loadWorkflows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const filteredWorkflows = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return workflows
      .filter((w) => (showArchived ? true : w.status !== "archived"))
      .filter(
        (w) =>
          w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q)
      );
  }, [workflows, searchQuery, showArchived]);

  const archivedCount = useMemo(
    () => workflows.filter((w) => w.status === "archived").length,
    [workflows]
  );

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image": return <ImageIcon className="w-4 h-4" />;
      case "video": return <Video className="w-4 h-4" />;
      case "music": return <Music className="w-4 h-4" />;
      default: return <Layers className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "image": return "text-accent-blue";
      case "video": return "text-accent-pink";
      case "music": return "text-accent-yellow";
      default: return "text-primary";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Build and manage AI generation workflows</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="px-3 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-foreground hover:bg-panel-elevated transition-colors flex items-center gap-2"
            title="Import a .studio-workflow.json bundle"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <GradientButton icon={<Plus className="w-4 h-4" />} onClick={() => setNewDialogOpen(true)}>
            New Workflow
          </GradientButton>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 bg-panel-soft border border-white/8 p-1 rounded-xl">
          {(["my", "team", "community"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTab === tab
                  ? "bg-panel-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-panel-soft border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              title={
                showArchived
                  ? "Hide archived workflows"
                  : `Show ${archivedCount} archived workflow${archivedCount === 1 ? "" : "s"}`
              }
              className={cn(
                "shrink-0 px-3 py-2.5 rounded-xl border text-xs transition-colors",
                showArchived
                  ? "bg-panel-elevated border-white/15 text-foreground"
                  : "bg-panel-soft border-white/10 text-muted-foreground hover:text-foreground"
              )}
            >
              {showArchived ? "Hide archived" : `Archived · ${archivedCount}`}
            </button>
          )}
        </div>
      </div>

      {/* Workflows Grid */}
      {loadStatus === "loading" && workflows.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading workflows...
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <GlassPanel className="p-8 text-center text-xs text-muted-foreground">
          {searchQuery ? `No workflows match "${searchQuery}"` : "No workflows yet — create one to get started."}
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkflows.map((workflow) => (
            <Link key={workflow.id} href={`/workflows/${workflow.id}`}>
              <GlassPanel className="p-5 hover:border-white/15 transition-all cursor-pointer group h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn("w-10 h-10 rounded-xl bg-panel-elevated flex items-center justify-center", getTypeColor(workflow.type))}>
                    {getTypeIcon(workflow.type)}
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full",
                        workflow.status === "published" &&
                          "bg-accent-green/10 text-accent-green",
                        workflow.status === "draft" && "bg-warning/10 text-warning",
                        workflow.status === "archived" &&
                          "bg-muted/15 text-muted-foreground"
                      )}
                    >
                      {workflow.status}
                    </span>
                    <button
                      type="button"
                      title="Delete workflow"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget(workflow);
                      }}
                      className="p-1 rounded-lg text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-foreground mb-1">{workflow.name}</h3>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{workflow.description}</p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {workflow.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-panel-soft text-muted-foreground border border-white/8">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="pt-3 border-t border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Layers className="w-3 h-3" /> {workflow.nodeCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {workflow.averageTime}
                    </span>
                  </div>
                  <span className="text-[10px] text-accent-green capitalize">{workflow.type}</span>
                </div>
              </GlassPanel>
            </Link>
          ))}
        </div>
      )}

      <NewWorkflowDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      <ImportWorkflowDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete workflow?"}
        description={
          deleteTarget
            ? `This permanently removes the workflow and its node graph. Project assets created by past runs of this workflow are kept.`
            : ""
        }
        confirmLabel="Delete workflow"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </div>
  );
}
