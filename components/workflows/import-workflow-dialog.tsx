"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, FileJson, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "@/components/ui/callout";
import { GradientButton } from "@/components/shared/GradientButton";
import type { Workflow, WorkflowBundle } from "@/types";
import { hasManifest } from "@/lib/plugins/manifestRegistry";

interface ImportWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BundlePreview {
  bundle: WorkflowBundle;
  rawText: string;
  missingPlugins: string[];
}

/**
 * Import dialog for `.studio-workflow.json` bundles.
 *
 * Two-step flow:
 *   1. User picks a file. We parse + preview locally — no server call yet.
 *      Catches obvious problems (malformed JSON, wrong shape) before the
 *      user commits to importing.
 *   2. User confirms. We POST to `/api/workflows/import`, surface any
 *      server-side warnings (re-bind reminders, validation issues), then
 *      navigate to the new workflow's editor.
 */
export function ImportWorkflowDialog({ open, onOpenChange }: ImportWorkflowDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPreview(null);
    setParseError(null);
    setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    setParseError(null);
    if (file.size > 1_000_000) {
      setParseError("Bundle is over 1 MB — likely malformed");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setParseError("Could not read file");
      return;
    }
    let parsed: WorkflowBundle;
    try {
      parsed = JSON.parse(text) as WorkflowBundle;
    } catch {
      setParseError("File is not valid JSON");
      return;
    }
    if (!parsed || typeof parsed !== "object" || parsed.bundleVersion !== 1 || !parsed.workflow) {
      setParseError("This file isn't a valid workflow bundle (bundleVersion 1).");
      return;
    }
    const required = parsed.requiredPlugins ?? [];
    const missing = required.filter((kind) => !hasManifest(kind));
    setPreview({ bundle: parsed, rawText: text, missingPlugins: missing });
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/workflows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: preview.rawText,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { workflow, warnings } = (await res.json()) as {
        workflow: Workflow;
        warnings: string[];
      };
      toast.success(`Imported "${workflow.name}"`);
      for (const w of warnings) {
        toast.warning(w, { duration: 8000 });
      }
      onOpenChange(false);
      reset();
      router.push(`/workflows/${workflow.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import workflow</DialogTitle>
          <DialogDescription>
            Load a <code className="font-mono text-foreground/80">.studio-workflow.json</code>{" "}
            bundle exported from another studio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!preview && !parseError && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-6 rounded-xl border-2 border-dashed border-white/15 hover:border-white/30 hover:bg-panel-soft transition-all flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <FileJson className="w-8 h-8" />
              <p className="text-sm font-medium">Choose a bundle</p>
              <p className="text-xs">
                or drop a <code className="font-mono">.studio-workflow.json</code> here
              </p>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.studio-workflow.json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />

          {parseError && (
            <Callout tier="error" title="Couldn't read this bundle">
              {parseError}
            </Callout>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-panel-soft p-3 space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {preview.bundle.workflow.name}
                </p>
                {preview.bundle.workflow.description && (
                  <p className="text-xs text-muted-foreground">
                    {preview.bundle.workflow.description}
                  </p>
                )}
                <div className="flex items-center gap-3 pt-1.5 text-[11px] text-muted-foreground">
                  <span>{preview.bundle.workflow.nodes.length} nodes</span>
                  <span>·</span>
                  <span>{preview.bundle.workflow.edges.length} edges</span>
                  <span>·</span>
                  <span>v{preview.bundle.workflow.version}</span>
                </div>
              </div>

              {preview.bundle.notes && (
                <Callout tier="info" title="Notes from the author">
                  {preview.bundle.notes}
                </Callout>
              )}

              {preview.missingPlugins.length > 0 ? (
                <Callout tier="warning" title="Missing plugins">
                  These node types aren&apos;t installed —{" "}
                  <span className="font-mono text-foreground/80">
                    {preview.missingPlugins.join(", ")}
                  </span>
                  . The workflow will load but those nodes won&apos;t function until you install them.
                </Callout>
              ) : (
                <Callout tier="success">
                  All required plugins are available locally.
                </Callout>
              )}

              <Callout tier="info">
                <strong>You may need to re-bind</strong> ComfyUI endpoints and
                LLM API keys after import — those are stripped from shared
                bundles for security.
              </Callout>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            className="px-4 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-muted-foreground hover:text-foreground transition-colors"
            disabled={submitting}
          >
            Cancel
          </button>
          {preview && (
            <GradientButton
              onClick={handleConfirm}
              icon={submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              disabled={submitting}
            >
              {submitting ? "Importing..." : "Import workflow"}
            </GradientButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
