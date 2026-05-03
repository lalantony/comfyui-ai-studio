"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { GradientButton } from "@/components/shared/GradientButton";
import type { Workflow } from "@/types";

interface PublishWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow | null;
  onPublished: (workflow: Workflow) => void;
}

/**
 * Dialog for publishing a workflow.
 *
 * UX flow:
 *   1. Show current status + version
 *   2. Suggest the next minor (1.0 → 1.1, 1.2.3 → 1.3) — user can override
 *   3. Optional changelog notes (free text)
 *   4. POST /api/workflows/[id]/publish → updated workflow returned
 *
 * Validation happens server-side. We surface server errors via the inline
 * `Callout` rather than a toast so the user can see them next to the form.
 */
export function PublishWorkflowDialog({
  open,
  onOpenChange,
  workflow,
  onPublished,
}: PublishWorkflowDialogProps) {
  const suggestedVersion = useMemo(
    () => suggestNextVersion(workflow?.version),
    [workflow?.version]
  );

  const [version, setVersion] = useState(suggestedVersion);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog opens for a different workflow.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setVersion(suggestedVersion);
      setNotes("");
      setError(null);
      setSubmitting(false);
    });
  }, [open, suggestedVersion]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflow || submitting) return;
    setError(null);
    if (!version.trim()) {
      setError("Version is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workflows/${encodeURIComponent(workflow.id)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: version.trim(), notes: notes.trim() || undefined }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { workflow: updated } = (await res.json()) as { workflow: Workflow };
      toast.success(`Published ${updated.name} v${updated.version}`);
      onPublished(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish workflow</DialogTitle>
          <DialogDescription>
            Mark this workflow as production-ready. The version is bumped + a changelog entry is added.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {workflow && (
            <div className="rounded-lg border border-white/10 bg-panel-soft p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current</span>
                <span className="font-mono text-foreground">
                  v{workflow.version}{" "}
                  <span
                    className={
                      workflow.status === "published"
                        ? "text-accent-green"
                        : workflow.status === "archived"
                          ? "text-muted-foreground"
                          : "text-warning"
                    }
                  >
                    · {workflow.status}
                  </span>
                </span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              New version
            </label>
            <Input
              mono
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 1.1"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Semver-ish: <code className="font-mono">1</code>, <code className="font-mono">1.0</code>,{" "}
              <code className="font-mono">1.2.3</code>, optional <code className="font-mono">v</code> prefix.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Changelog (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What changed in this version?"
              className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {error && <Callout tier="error" title="Couldn't publish">{error}</Callout>}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-muted-foreground hover:text-foreground transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <GradientButton
              type="submit"
              icon={
                submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )
              }
              disabled={submitting}
            >
              {submitting ? "Publishing..." : `Publish v${version || "?"}`}
            </GradientButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bump the minor component of a semver-ish version string.
 *   "1"        → "1.1"
 *   "1.0"      → "1.1"
 *   "1.2.3"    → "1.3"
 *   "v1.0"     → "v1.1"
 *   undefined  → "1.0"
 *
 * Conservative — preserves prefix, only touches the second component. If the
 * input doesn't parse cleanly, fall back to "1.0".
 */
function suggestNextVersion(current: string | undefined): string {
  if (!current) return "1.0";
  const match = current.trim().match(/^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return "1.0";
  const [, prefix, majorRaw, minorRaw] = match;
  const minor = (minorRaw ? parseInt(minorRaw, 10) : 0) + 1;
  return `${prefix}${majorRaw}.${minor}`;
}
