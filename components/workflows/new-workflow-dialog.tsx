"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GradientButton } from "@/components/shared/GradientButton";
import { Workflow } from "@/types";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface NewWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPES: { id: Workflow["type"]; label: string; hint: string }[] = [
  { id: "image", label: "Image", hint: "Image generation pipelines" },
  { id: "video", label: "Video", hint: "Video / motion generation" },
  { id: "music", label: "Music", hint: "Audio / music generation" },
  { id: "mixed", label: "Mixed", hint: "Multi-modal compositions" },
];

export function NewWorkflowDialog({ open, onOpenChange }: NewWorkflowDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Workflow["type"]>("image");
  const [tagsInput, setTagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setType("image");
    setTagsInput("");
    setSubmitting(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), type, tags }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { workflow } = (await res.json()) as { workflow: Workflow };
      reset();
      onOpenChange(false);
      router.push(`/workflows/${workflow.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workflow");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>
            A workflow is a node-based DAG that the composer or editor can run. You&apos;ll start with an empty
            canvas and drag nodes in from the library.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="nw-name" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Name
            </label>
            <input
              id="nw-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Image Generation"
              autoFocus
              className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nw-description" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Description <span className="text-muted-foreground/50 normal-case">(optional)</span>
            </label>
            <textarea
              id="nw-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this workflow generates..."
              className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</label>
            <div className="grid grid-cols-4 gap-1.5">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  title={t.hint}
                  className={cn(
                    "px-2 py-2 rounded-lg border text-xs transition-colors",
                    type === t.id
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-white/10 bg-panel-soft text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nw-tags" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Tags <span className="text-muted-foreground/50 normal-case">(comma-separated)</span>
            </label>
            <input
              id="nw-tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="sdxl, draft"
              className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger">
              {error}
            </div>
          )}

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
              size="md"
              icon={submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create workflow"}
            </GradientButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
