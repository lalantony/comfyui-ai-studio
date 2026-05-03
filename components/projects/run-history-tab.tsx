"use client";

/**
 * RunHistoryTab — surfaces the project's persisted runs as a browsable list.
 *
 * Data source: `/api/projects/[id]/runs` (list) + `/api/projects/[id]/runs/[runId]`
 * (detail with replayed event log). Both paths read from disk only — there
 * is no SSE subscription here. For non-terminal runs the row auto-polls
 * the list every 5s so the user sees status transitions without refreshing.
 *
 * Re-run flow: clicking "Run again" POSTs to `/api/workflow-runs` with the
 * original `inputs` map. The new run shows up at the top of the list on
 * the next refresh.
 *
 * Edge cases the UI handles:
 *   - Workflow deleted → "Workflow deleted" pill instead of name; re-run disabled.
 *   - Output assets deleted → thumbnails 404 → fall through to icon.
 *   - In-progress run on another tab → auto-poll picks up the new state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RefreshCw,
  RefreshCcw,
  SkipForward,
  XCircle,
  AlertTriangle,
  ExternalLink,
  PlayCircle,
} from "lucide-react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { toast } from "sonner";
import type { RunEvent, RunStatus, RunSummary, WorkflowRun } from "@/types";

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; runs: RunSummary[] }
  | { status: "error"; message: string };

interface DetailState {
  runId: string;
  loading: boolean;
  detail?: { run: WorkflowRun; events: RunEvent[]; workflowName: string | null };
  error?: string;
}

const POLL_INTERVAL_MS = 5_000;

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "cancelled"]);

export function RunHistoryTab({ projectId }: { projectId: string }) {
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [expanded, setExpanded] = useState<DetailState | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/runs`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { runs } = (await res.json()) as { runs: RunSummary[] };
      setState({ status: "ready", runs });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load runs",
      });
    }
  }, [projectId]);

  // Initial fetch + auto-poll while there's a non-terminal run visible.
  // Defer the loading-state set + the kickoff via queueMicrotask to satisfy
  // the react-hooks/set-state-in-effect rule (project convention; same
  // idiom used in image-input Component.tsx and elsewhere). The fetch
  // resolves async anyway, so micro-deferral has no user-visible effect.
  useEffect(() => {
    queueMicrotask(() => {
      setState({ status: "loading" });
      void refresh();
    });
  }, [refresh]);

  const hasNonTerminal = useMemo(() => {
    if (state.status !== "ready") return false;
    return state.runs.some((r) => !TERMINAL_STATUSES.has(r.status));
  }, [state]);

  useEffect(() => {
    if (!hasNonTerminal) return;
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasNonTerminal, refresh]);

  const loadDetail = useCallback(
    async (runId: string) => {
      setExpanded({ runId, loading: true });
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        const detail = (await res.json()) as {
          run: WorkflowRun;
          events: RunEvent[];
          workflowName: string | null;
        };
        setExpanded({ runId, loading: false, detail });
      } catch (err) {
        setExpanded({
          runId,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load run detail",
        });
      }
    },
    [projectId]
  );

  const toggleRow = useCallback(
    (runId: string) => {
      if (expanded?.runId === runId) {
        setExpanded(null);
        return;
      }
      void loadDetail(runId);
    },
    [expanded, loadDetail]
  );

  const handleResume = useCallback(
    async (run: RunSummary) => {
      if (!run.workflowName) {
        toast.error("Workflow has been deleted — can't resume.");
        return;
      }
      setResumingRunId(run.id);
      try {
        const res = await fetch(
          `/api/workflow-runs/${encodeURIComponent(run.id)}/resume`,
          { method: "POST" }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        const detail = (await res.json()) as {
          runId: string;
          fromNodeId: string;
          reusedNodeIds: string[];
        };
        const reused = detail.reusedNodeIds.length;
        toast.success(
          reused === 0
            ? "Resume started — picking up from the failed node."
            : `Resume started — reusing ${reused} stage${reused === 1 ? "" : "s"}.`
        );
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to resume run");
      } finally {
        setResumingRunId(null);
      }
    },
    [refresh]
  );

  const handleRunAgain = useCallback(
    async (run: RunSummary) => {
      if (!run.workflowName) {
        toast.error("Workflow has been deleted — can't re-run.");
        return;
      }
      setBusyRunId(run.id);
      try {
        // We need the original inputs — pull them from the detail endpoint.
        // Cheaper than caching: only fires when the user clicks Run again.
        const detailRes = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.id)}`,
          { cache: "no-store" }
        );
        if (!detailRes.ok) {
          const body = (await detailRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${detailRes.status} ${detailRes.statusText}`);
        }
        const { run: full } = (await detailRes.json()) as { run: WorkflowRun };

        const startRes = await fetch("/api/workflow-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId: full.workflowId,
            projectId,
            mode: "project",
            inputs: full.inputs,
          }),
        });
        if (!startRes.ok) {
          const body = (await startRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${startRes.status} ${startRes.statusText}`);
        }
        toast.success("Run started — it'll appear at the top of the list shortly.");
        // Optimistic refresh so the new row shows without waiting for the
        // 5s poll cycle. Auto-poll then takes over for status transitions.
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start run");
      } finally {
        setBusyRunId(null);
      }
    },
    [projectId, refresh]
  );

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading runs...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <GlassPanel className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-xs text-muted-foreground truncate">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-panel-soft border border-white/10 text-[11px] text-foreground hover:bg-panel-elevated transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </GlassPanel>
    );
  }

  if (state.runs.length === 0) {
    return (
      <GlassPanel className="p-8 text-center">
        <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-foreground mb-1">No runs yet</h3>
        <p className="text-xs text-muted-foreground">
          Generate something using the composer below — your workflow runs will show up here.
        </p>
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-foreground">
          {state.runs.length} run{state.runs.length === 1 ? "" : "s"}
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>
      <div className="space-y-1.5">
        {state.runs.map((run) => (
          <RunRow
            key={run.id}
            projectId={projectId}
            run={run}
            isExpanded={expanded?.runId === run.id}
            isBusy={busyRunId === run.id}
            isResuming={resumingRunId === run.id}
            detail={expanded?.runId === run.id ? expanded : undefined}
            onToggle={() => toggleRow(run.id)}
            onRunAgain={() => void handleRunAgain(run)}
            onResume={() => void handleResume(run)}
          />
        ))}
      </div>
    </div>
  );
}

function RunRow({
  projectId,
  run,
  isExpanded,
  isBusy,
  isResuming,
  detail,
  onToggle,
  onRunAgain,
  onResume,
}: {
  projectId: string;
  run: RunSummary;
  isExpanded: boolean;
  isBusy: boolean;
  isResuming: boolean;
  detail?: DetailState;
  onToggle: () => void;
  onRunAgain: () => void;
  onResume: () => void;
}) {
  const startedDate = new Date(run.startedAt);
  const startedLabel = isNaN(startedDate.getTime())
    ? run.startedAt
    : startedDate.toLocaleString();
  const durationMs =
    run.endedAt && !isNaN(new Date(run.endedAt).getTime())
      ? new Date(run.endedAt).getTime() - startedDate.getTime()
      : null;
  const workflowDeleted = run.workflowName === null;

  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={isExpanded ? "Collapse run" : "Expand run"}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors shrink-0"
        >
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
        <RunStatusPill status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium truncate ${
                workflowDeleted ? "text-muted-foreground italic" : "text-foreground"
              }`}
              title={run.workflowName ?? undefined}
            >
              {run.workflowName ?? "Workflow deleted"}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {startedLabel}
            </span>
            {durationMs !== null && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                · {formatDuration(durationMs)}
              </span>
            )}
            {run.outputAssetIds.length > 0 && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                · {run.outputAssetIds.length} output
                {run.outputAssetIds.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {run.error && (
            <p className="text-[10px] text-danger mt-0.5 truncate" title={run.error}>
              {run.error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <OutputThumbs projectId={projectId} assetIds={run.outputAssetIds} />
          {(run.status === "failed" || run.status === "cancelled") && (
            <button
              type="button"
              onClick={onResume}
              disabled={isResuming || workflowDeleted}
              title={
                workflowDeleted
                  ? "Workflow has been deleted"
                  : "Resume from the failed step — re-uses any stage outputs that already saved successfully."
              }
              className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-accent-green bg-accent-green/10 border border-accent-green/30 hover:bg-accent-green/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isResuming ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <PlayCircle className="w-3 h-3" />
              )}
              Resume
            </button>
          )}
          <button
            type="button"
            onClick={onRunAgain}
            disabled={isBusy || workflowDeleted}
            title={
              workflowDeleted
                ? "Workflow has been deleted"
                : "Run this workflow again with the same inputs"
            }
            className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-foreground bg-panel-soft border border-white/10 hover:bg-panel-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCcw className="w-3 h-3" />
            )}
            Run again
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-white/8 bg-panel-soft/40 px-4 py-3">
          {detail?.loading ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading event log...
            </div>
          ) : detail?.error ? (
            <div className="flex items-center gap-2 text-[11px] text-danger">
              <AlertTriangle className="w-3 h-3" />
              {detail.error}
            </div>
          ) : detail?.detail ? (
            <RunTimeline events={detail.detail.events} />
          ) : null}
        </div>
      )}
    </GlassPanel>
  );
}

function OutputThumbs({
  projectId,
  assetIds,
}: {
  projectId: string;
  assetIds: string[];
}) {
  if (assetIds.length === 0) return null;
  // Cap at 3 to keep the row tidy. Anything beyond becomes a "+N" badge.
  const visible = assetIds.slice(0, 3);
  const overflow = assetIds.length - visible.length;
  return (
    <div className="flex items-center gap-1">
      {visible.map((id) => (
        <a
          key={id}
          href={`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(id)}/file`}
          target="_blank"
          rel="noopener noreferrer"
          title={id}
          className="block w-8 h-8 rounded-md overflow-hidden border border-white/10 bg-panel-soft"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(id)}/file`}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              // Asset deleted — show a generic broken-output icon instead.
              const target = e.currentTarget;
              target.style.display = "none";
              const parent = target.parentElement;
              if (parent && !parent.querySelector("[data-broken]")) {
                const span = document.createElement("span");
                span.dataset.broken = "true";
                span.className =
                  "w-full h-full flex items-center justify-center text-[10px] text-muted-foreground";
                span.textContent = "?";
                parent.appendChild(span);
              }
            }}
          />
        </a>
      ))}
      {overflow > 0 && (
        <span className="px-1.5 py-0.5 rounded-md bg-panel-soft border border-white/10 text-[10px] text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}

function RunTimeline({ events }: { events: RunEvent[] }) {
  // Filter to user-meaningful events — node lifecycle + run terminus. Drop
  // run.log unless the user expands the log specifically (deferred to a
  // follow-up if needed).
  const relevant = events.filter((e) =>
    [
      "run.started",
      "node.started",
      "node.completed",
      "node.failed",
      "node.skipped",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ].includes(e.type)
  );
  if (relevant.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        No events recorded for this run.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {relevant.map((e, i) => (
        <li key={i} className="flex items-center gap-2 text-[11px]">
          <EventIcon type={e.type} />
          <span className="font-mono text-muted-foreground shrink-0">
            {formatEventLabel(e)}
          </span>
          {"nodeId" in e && typeof e.nodeId === "string" && (
            <span
              className="text-muted-foreground/70 truncate max-w-[200px]"
              title={e.nodeId}
            >
              [{e.nodeId.slice(-8)}]
            </span>
          )}
          {"error" in e && e.error && (
            <span className="text-danger truncate" title={e.error}>
              — {e.error}
            </span>
          )}
          {"outputSummary" in e && e.outputSummary && (
            <span className="text-muted-foreground/80 truncate">
              — {e.outputSummary}
            </span>
          )}
          {e.type === "node.completed" && "preview" in e && e.preview?.url && (
            <a
              href={e.preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 inline-flex items-center text-primary hover:underline"
              title="Open preview"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function EventIcon({ type }: { type: RunEvent["type"] }) {
  if (type === "node.completed" || type === "run.completed") {
    return <CheckCircle2 className="w-3 h-3 text-accent-green shrink-0" />;
  }
  if (type === "node.failed" || type === "run.failed") {
    return <XCircle className="w-3 h-3 text-danger shrink-0" />;
  }
  if (type === "node.skipped" || type === "run.cancelled") {
    return <SkipForward className="w-3 h-3 text-muted-foreground shrink-0" />;
  }
  return <Clock className="w-3 h-3 text-warning shrink-0" />;
}

function formatEventLabel(e: RunEvent): string {
  switch (e.type) {
    case "run.started":
      return "run started";
    case "run.completed":
      return "run completed";
    case "run.failed":
      return "run failed";
    case "run.cancelled":
      return "run cancelled";
    case "node.started":
      return "node started";
    case "node.completed":
      return "node completed";
    case "node.failed":
      return "node failed";
    case "node.skipped":
      return "node skipped";
    default:
      return e.type;
  }
}

function RunStatusPill({ status }: { status: RunStatus }) {
  const cls = "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border shrink-0";
  if (status === "running" || status === "queued") {
    return (
      <span className={`${cls} text-warning border-warning/30 bg-warning/10`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === "queued" ? "Queued" : "Running"}
      </span>
    );
  }
  if (status === "succeeded") {
    return (
      <span className={`${cls} text-accent-green border-accent-green/30 bg-accent-green/10`}>
        <CheckCircle2 className="w-3 h-3" />
        Succeeded
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${cls} text-danger border-danger/30 bg-danger/10`}>
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }
  return (
    <span className={`${cls} text-muted-foreground border-white/10 bg-panel-soft`}>
      <SkipForward className="w-3 h-3" />
      Cancelled
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec - min * 60);
  return `${min}m ${remSec}s`;
}
