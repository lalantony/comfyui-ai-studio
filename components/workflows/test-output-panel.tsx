"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Music,
  SkipForward,
  XCircle,
} from "lucide-react";
import NextImage from "next/image";
import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import type { NodePreview } from "@/types";
import type { RunLogLine, StagePreview } from "@/stores/useWorkflowStore";

/**
 * TestOutputPanel — surface every executable node's output as a stage card,
 * live, as `node.completed` events arrive. Replaces the old single-output
 * panel that only showed `outputFiles[0]` at the end of the run.
 *
 * Why a multi-card view: with auto-save in place, every ComfyUI stage in a
 * chain produces a viewable artifact. Showing them in execution order lets
 * the user spot a bad first frame (or wrong style transfer) without
 * waiting for the entire run to finish — and keeps SaveOutput nodes from
 * being a workaround for "I want to see the intermediate output".
 *
 * Activity log: every meaningful WS lifecycle event (open/close/timeout,
 * polling probes, completion path) emits a `run.log` SSE event. The panel
 * shows a collapsible log card with copy-to-clipboard so users can attach
 * a clean timeline to bug reports.
 */
export function TestOutputPanel() {
  const status = useWorkflowStore((s) => s.testRunStatus);
  const stagePreviewsRaw = useWorkflowStore((s) => s.stagePreviews);
  const runLogLines = useWorkflowStore((s) => s.runLogLines);
  const error = useWorkflowStore((s) => s.testRunError);
  const [logOpen, setLogOpen] = useState(false);

  // Filter out stages that have nothing visual to show — Text Input,
  // SaveOutput, and other plumbing nodes get a card while *running* (so
  // the user sees progress) but drop off once they finish without a
  // preview attached. Memoised so the array reference is stable across
  // unrelated store updates (e.g. a run.log event), which prevents the
  // child StageCards from being unnecessarily reconciled and avoids a
  // visible flicker on the rendered images/videos.
  const stagePreviews = useMemo(
    () => stagePreviewsRaw.filter((s) => s.status === "running" || !!s.preview),
    [stagePreviewsRaw]
  );

  // Tally counts once per render. These were inline calls walking the full
  // log list on every render — fine for ≤500 lines but recomputed each
  // panel update. Memoising costs nothing and keeps the activity-log
  // header text stable when the panel re-renders for stage updates only.
  const { errorCount, warnCount } = useMemo(() => {
    let e = 0;
    let w = 0;
    for (const l of runLogLines) {
      if (l.level === "error") e++;
      else if (l.level === "warn") w++;
    }
    return { errorCount: e, warnCount: w };
  }, [runLogLines]);

  // Hide entirely until a run has been kicked off (no stages, no log lines, idle).
  if (status === "idle" && stagePreviews.length === 0 && runLogLines.length === 0) {
    return null;
  }

  const handleCopyLog = async () => {
    if (runLogLines.length === 0) {
      toast("Nothing to copy");
      return;
    }
    const text = runLogLines
      .map((l) => `${l.timestamp} ${l.level.toUpperCase()} ${l.nodeId ? `[${l.nodeId}] ` : ""}${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${runLogLines.length} log line${runLogLines.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Clipboard write failed");
    }
  };

  return (
    <GlassPanel className="p-4 flex flex-col gap-3 min-w-0">
      {/* Run status header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Test output</h3>
        <RunStatusPill status={status} stageCount={stagePreviews.length} />
      </div>

      {/* Stage previews */}
      {stagePreviews.length === 0 ? (
        <div className="rounded-lg bg-panel-soft border border-white/10 aspect-video flex flex-col items-center justify-center text-center p-4">
          {status === "running" ? (
            <>
              <Loader2 className="w-6 h-6 text-warning mx-auto mb-2 animate-spin" />
              <p className="text-[10px] text-muted-foreground">Waiting for first stage...</p>
            </>
          ) : status === "failed" ? (
            <>
              <XCircle className="w-6 h-6 text-danger mx-auto mb-2" />
              <p className="text-[10px] text-danger">{error ?? "Run failed"}</p>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">No stage output yet.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
          {stagePreviews.map((stage) => (
            <StageCard key={stage.nodeId} stage={stage} />
          ))}
        </div>
      )}

      {/* Activity log */}
      <div className="rounded-lg border border-white/8 bg-panel-soft/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-panel-soft transition-colors"
        >
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Activity log</span>
            <span>·</span>
            <span>{runLogLines.length} line{runLogLines.length === 1 ? "" : "s"}</span>
            {errorCount > 0 && (
              <span className="text-danger">· {errorCount} error{errorCount === 1 ? "" : "s"}</span>
            )}
            {warnCount > 0 && (
              <span className="text-warning">· {warnCount} warn{warnCount === 1 ? "" : "s"}</span>
            )}
          </div>
          {logOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        {logOpen && (
          <div className="border-t border-white/8 px-3 py-2 space-y-1 max-h-48 overflow-y-auto scrollbar-thin font-mono text-[10px]">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCopyLog}
                disabled={runLogLines.length === 0}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ClipboardCopy className="w-3 h-3" />
                Copy
              </button>
            </div>
            {runLogLines.length === 0 ? (
              <p className="text-muted-foreground italic">No log lines yet.</p>
            ) : (
              runLogLines.map((line, i) => <LogLine key={i} line={line} />)
            )}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

function RunStatusPill({
  status,
  stageCount,
}: {
  status: ReturnType<typeof useWorkflowStore.getState>["testRunStatus"];
  stageCount: number;
}) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-warning">
        <Loader2 className="w-3 h-3 animate-spin" />
        Running{stageCount > 0 ? ` · ${stageCount} stage${stageCount === 1 ? "" : "s"}` : ""}
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-accent-green">
        <CheckCircle2 className="w-3 h-3" />
        Done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-danger">
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }
  if (status === "cancelled" || status === "skipped") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <SkipForward className="w-3 h-3" />
        {status === "cancelled" ? "Cancelled" : "Skipped"}
      </span>
    );
  }
  return null;
}

// Memoised so a StageCard skips re-render when its `stage` prop reference
// is unchanged. The store's upsert helper builds a new array each time
// it patches one entry, but unchanged entries keep their referential
// identity (slice() is shallow) — so memo lets only the actually-changed
// card re-render. Critical for the test panel: a `run.log` arrives every
// few seconds during ComfyUI sampling, and without memo every event
// would force an `<img>` / `<video>` re-mount, causing visible flicker.
const StageCard = memo(function StageCard({ stage }: { stage: StagePreview }) {
  const { preview, status, label } = stage;

  const handleDownload = async () => {
    if (!preview) return;
    try {
      const res = await fetch(preview.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = preview.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleOpen = () => {
    if (!preview) return;
    window.open(preview.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-lg border border-white/8 bg-panel-soft/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/8">
        <span className="text-[11px] font-medium text-foreground truncate" title={label}>
          {label}
        </span>
        <StageStatusPill status={status} />
      </div>
      <div className="aspect-video relative bg-panel-soft flex items-center justify-center">
        {status === "running" && (
          <div className="text-center p-3">
            <Loader2 className="w-5 h-5 text-warning mx-auto mb-1.5 animate-spin" />
            <p className="text-[10px] text-muted-foreground">Working...</p>
          </div>
        )}
        {status === "success" && preview && <PreviewMedia preview={preview} />}
        {status === "success" && !preview && (
          <p className="text-[10px] text-muted-foreground p-3">Done — no preview attached.</p>
        )}
        {status === "failed" && (
          <div className="text-center p-3">
            <XCircle className="w-5 h-5 text-danger mx-auto mb-1.5" />
            <p className="text-[10px] text-danger">Failed</p>
          </div>
        )}
        {status === "skipped" && (
          <div className="text-center p-3">
            <SkipForward className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
            <p className="text-[10px] text-muted-foreground">Skipped</p>
          </div>
        )}
      </div>
      {preview && status === "success" && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-t border-white/8 bg-panel-soft/40">
          <button
            type="button"
            onClick={handleDownload}
            className="flex-1 py-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors flex items-center justify-center gap-1.5"
          >
            <Download className="w-3 h-3" />
            Download
          </button>
          <button
            type="button"
            onClick={handleOpen}
            className="flex-1 py-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>
        </div>
      )}
    </div>
  );
});

function StageStatusPill({ status }: { status: StagePreview["status"] }) {
  if (status === "running") {
    return <Loader2 className="w-3 h-3 text-warning animate-spin" />;
  }
  if (status === "success") {
    return <CheckCircle2 className="w-3 h-3 text-accent-green" />;
  }
  if (status === "failed") {
    return <XCircle className="w-3 h-3 text-danger" />;
  }
  return <SkipForward className="w-3 h-3 text-muted-foreground" />;
}

// Memoised — same NodePreview reference → no DOM update, no `<img>` /
// `<video>` re-mount. Eliminates the visible flicker on stage updates.
const PreviewMedia = memo(function PreviewMedia({ preview }: { preview: NodePreview }) {
  if (preview.type === "image") {
    return (
      <NextImage
        src={preview.url}
        alt={preview.name}
        fill
        sizes="320px"
        className="object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (preview.type === "video") {
    return (
      <video
        src={preview.url}
        controls
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-contain"
      />
    );
  }
  if (preview.type === "music") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-3 w-full">
        <Music className="w-6 h-6 text-accent-yellow" />
        <audio src={preview.url} controls className="w-full" />
      </div>
    );
  }
  // Generic file fallback (preview.type === "file"). The video/music/image
  // branches above narrow the type, so by here it's always "file".
  return (
    <div className="text-center p-3">
      <ImageIcon className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
      <p className="text-[10px] text-muted-foreground truncate max-w-[240px]" title={preview.name}>
        {preview.name}
      </p>
    </div>
  );
});

const LogLine = memo(function LogLine({ line }: { line: RunLogLine }) {
  const colorClass =
    line.level === "error"
      ? "text-danger"
      : line.level === "warn"
        ? "text-warning"
        : line.level === "debug"
          ? "text-muted-foreground"
          : "text-foreground";
  // Compact ISO timestamp → HH:mm:ss for the panel.
  const time = line.timestamp.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ?? "";
  return (
    <div className={`flex gap-2 ${colorClass}`}>
      <span className="text-muted-foreground shrink-0">{time}</span>
      <span className="uppercase text-[8px] tracking-wider shrink-0 mt-[1px]">{line.level}</span>
      {line.nodeId && (
        <span className="text-muted-foreground shrink-0 truncate max-w-[80px]" title={line.nodeId}>
          [{line.nodeId.slice(-8)}]
        </span>
      )}
      <span className="break-all">{line.message}</span>
    </div>
  );
});
