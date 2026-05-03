"use client";

import { useEffect, useRef, useState, use } from "react";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { WorkflowCanvas } from "@/components/workflows/workflow-canvas";
import { NodeLibrary } from "@/components/workflows/node-library";
import { NodeInspector } from "@/components/workflows/node-inspector";
import { TestOutputPanel } from "@/components/workflows/test-output-panel";
import { PublishWorkflowDialog } from "@/components/workflows/publish-workflow-dialog";
import { WorkflowOverflowMenu } from "@/components/workflows/workflow-overflow-menu";
import { GradientButton } from "@/components/shared/GradientButton";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { toast } from "sonner";
import {
  Play,
  Save,
  Square,
  Download,
  Upload,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";

export default function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = use(params);

  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const loadStatus = useWorkflowStore((s) => s.activeWorkflowLoadStatus);
  const loadError = useWorkflowStore((s) => s.loadError);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const renameWorkflow = useWorkflowStore((s) => s.renameWorkflow);
  const testRunStatus = useWorkflowStore((s) => s.testRunStatus);
  const testRunError = useWorkflowStore((s) => s.testRunError);
  const runTest = useWorkflowStore((s) => s.runTest);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const isSaving = useWorkflowStore((s) => s.isSaving);
  const lastSavedAt = useWorkflowStore((s) => s.lastSavedAt);
  const saveError = useWorkflowStore((s) => s.saveError);
  const cancellingTestRun = useWorkflowStore((s) => s.cancellingTestRun);
  const cancelTestRun = useWorkflowStore((s) => s.cancelTestRun);

  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadWorkflow(workflowId);
  }, [workflowId, loadWorkflow]);

  // Surface test-run errors as toasts (otherwise silent failures look like the button does nothing)
  useEffect(() => {
    if (testRunStatus === "failed" && testRunError) {
      toast.error(testRunError);
    }
  }, [testRunStatus, testRunError]);

  // Debounced auto-save: save 1s after the user stops editing. The store's
  // saveWorkflow is its own concurrency-guard, so a rapid sequence of edits
  // collapses to a single PUT after the typing/dragging settles. Without
  // this, closing the tab mid-edit silently loses everything.
  useEffect(() => {
    if (!activeWorkflow || !isDirty || isSaving) return;
    const handle = setTimeout(() => {
      void saveWorkflow().catch(() => {
        /* error already in saveError */
      });
    }, 1000);
    return () => clearTimeout(handle);
  }, [activeWorkflow, isDirty, isSaving, saveWorkflow]);

  // beforeunload guard: if the user closes the tab during the
  // save-debounce window (or while a save is in flight), warn them. The
  // browser shows its own generic message; the empty returnValue is the
  // modern way to trigger the prompt.
  useEffect(() => {
    if (!isDirty && !isSaving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, isSaving]);

  // Tick state so "Saved Xs ago" updates without a separate timer per
  // mount. One module-shared tick at 30s granularity is sufficient for
  // this header.
  const [, setHeaderTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setHeaderTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleTestRun = async () => {
    try {
      await runTest();
      const finalStatus = useWorkflowStore.getState().testRunStatus;
      if (finalStatus === "success") toast.success("Test run completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test run failed");
    }
  };

  const handleSave = async () => {
    try {
      await saveWorkflow();
      toast.success("Workflow saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const startEditingName = () => {
    if (!activeWorkflow) return;
    setDraftName(activeWorkflow.name);
    setIsEditingName(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setDraftName("");
  };

  const commitName = async () => {
    if (!activeWorkflow) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      toast.error("Workflow name can't be empty");
      return;
    }
    if (trimmed === activeWorkflow.name) {
      cancelEditingName();
      return;
    }
    setRenameSubmitting(true);
    try {
      await renameWorkflow(trimmed);
      toast.success("Workflow renamed");
      setIsEditingName(false);
      setDraftName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameSubmitting(false);
    }
  };

  const isRunning = testRunStatus === "running";

  if (loadStatus === "loading" && !activeWorkflow) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading workflow...
      </div>
    );
  }

  if (loadStatus === "error" && !activeWorkflow) {
    return (
      <GlassPanel className="p-6 max-w-md mx-auto text-center">
        <h2 className="text-sm font-semibold text-foreground mb-1">Couldn&apos;t load workflow</h2>
        <p className="text-xs text-muted-foreground">{loadError}</p>
      </GlassPanel>
    );
  }

  if (!activeWorkflow) return null;

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col">
      {/* Workflow Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              {isEditingName ? (
                <>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitName();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEditingName();
                      }
                    }}
                    disabled={renameSubmitting}
                    className="text-lg font-semibold text-foreground bg-panel-soft border border-primary/40 rounded-md px-2 py-0.5 focus:outline-none focus:border-primary/70 min-w-[16rem]"
                  />
                  <button
                    type="button"
                    onClick={() => void commitName()}
                    disabled={renameSubmitting}
                    title="Save name"
                    className="p-1 rounded-md text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50"
                  >
                    {renameSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditingName}
                    disabled={renameSubmitting}
                    title="Cancel"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <h1 className="text-lg font-semibold text-foreground">{activeWorkflow.name}</h1>
                  <span className="text-xs text-muted-foreground">v{activeWorkflow.version}</span>
                  <button
                    type="button"
                    onClick={startEditingName}
                    title="Rename workflow"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{activeWorkflow.nodeCount} Nodes</span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground">{activeWorkflow.averageTime} avg</span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs text-accent-green capitalize">{activeWorkflow.type}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={() => {
                void cancelTestRun();
              }}
              disabled={cancellingTestRun}
              title={cancellingTestRun ? "Cancelling..." : "Stop the test run"}
              className="px-4 py-2 rounded-xl bg-danger/15 border border-danger/40 text-danger hover:bg-danger/25 transition-colors text-xs flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {cancellingTestRun ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  Stop
                </>
              )}
            </button>
          ) : (
            <GradientButton
              size="sm"
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() => {
                void handleTestRun();
              }}
              className="px-4"
            >
              Test Run
            </GradientButton>
          )}
          <SaveIndicator
            isDirty={isDirty}
            isSaving={isSaving}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            onSave={handleSave}
          />
          <button
            onClick={handleSave}
            className="px-3 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-foreground hover:bg-panel-elevated transition-colors flex items-center gap-2"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
          <a
            href={`/api/workflows/${encodeURIComponent(workflowId)}/export`}
            download
            title="Download a portable .studio-workflow.json bundle. API keys and local references are stripped."
            className="px-3 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-foreground hover:bg-panel-elevated transition-colors flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </a>
          <button
            onClick={() => setPublishOpen(true)}
            disabled={!activeWorkflow}
            title={
              activeWorkflow?.status === "published"
                ? `Currently published v${activeWorkflow.version}`
                : "Mark this workflow as production-ready"
            }
            className="px-3 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-foreground hover:bg-panel-elevated transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {activeWorkflow?.status === "published" ? "Republish" : "Publish"}
          </button>
          <WorkflowOverflowMenu
            workflow={activeWorkflow}
            onChanged={() => void loadWorkflow(workflowId)}
          />
        </div>
      </div>

      <PublishWorkflowDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        workflow={activeWorkflow}
        onPublished={() => void loadWorkflow(workflowId)}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Node Library */}
        <NodeLibrary />

        {/* Canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          <WorkflowCanvas />
        </div>

        {/* Right column: Test Output + Inspector */}
        <div className="w-80 shrink-0 flex flex-col gap-4 overflow-y-auto scrollbar-thin">
          <TestOutputPanel />
          <NodeInspector />
        </div>
      </div>
    </div>
  );
}

/**
 * Inline status pill that summarises the auto-save state. Click-to-retry
 * if the last save errored. The relative-time string updates every 30s
 * via the parent's tick state.
 */
function SaveIndicator({
  isDirty,
  isSaving,
  lastSavedAt,
  saveError,
  onSave,
}: {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  onSave: () => void;
}) {
  const baseClass =
    "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border";
  if (saveError) {
    return (
      <button
        type="button"
        onClick={onSave}
        title={`${saveError}. Click to retry.`}
        className={`${baseClass} border-danger/40 bg-danger/10 text-danger hover:bg-danger/15`}
      >
        <X className="w-3 h-3" />
        Save failed — retry
      </button>
    );
  }
  if (isSaving) {
    return (
      <span className={`${baseClass} border-white/10 bg-panel-soft text-muted-foreground`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Saving...
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className={`${baseClass} border-warning/30 bg-warning/10 text-warning`}>
        <span className="w-1.5 h-1.5 rounded-full bg-warning" />
        Unsaved
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className={`${baseClass} border-white/10 bg-panel-soft text-muted-foreground`}>
        <Check className="w-3 h-3 text-accent-green" />
        Saved {formatRelativeTime(lastSavedAt)}
      </span>
    );
  }
  return null;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return "just now";
  if (ms < 5_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
