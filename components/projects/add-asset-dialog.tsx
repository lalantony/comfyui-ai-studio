"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjectStore } from "@/stores/useProjectStore";
import { CheckCircle2, FileUp, Loader2, X, XCircle } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getAcceptString, validateUpload } from "@/lib/uploadPolicy";

interface AddAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileUpload {
  file: File;
  /**
   * `pending` — added, will upload on Start
   * `rejected` — failed client-side validation (size/type), won't upload
   * `uploading` — POST in flight
   * `success` / `failed` — terminal states from the server
   */
  status: "pending" | "rejected" | "uploading" | "success" | "failed";
  error?: string;
}

export function AddAssetDialog({ open, onOpenChange }: AddAssetDialogProps) {
  const uploadAsset = useProjectStore((s) => s.uploadAsset);
  const activeProject = useProjectStore((s) => s.activeProject);
  const [items, setItems] = useState<FileUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setItems([]);
    setDragOver(false);
    setIsUploading(false);
  };

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const next = Array.from(fileList).map<FileUpload>((file) => {
      // Pre-validate so the user gets instant feedback on a 4 GB ISO drop
      // instead of waiting for the upload to fail server-side. Server still
      // re-validates as defence in depth — see app/api/projects/[id]/assets.
      const v = validateUpload({ name: file.name, size: file.size, type: file.type });
      if (!v.ok) {
        return { file, status: "rejected", error: v.reason };
      }
      return { file, status: "pending" };
    });
    setItems((prev) => [...prev, ...next]);
  }, []);

  const acceptString = useMemo(() => getAcceptString(), []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const startUpload = async () => {
    if (items.length === 0 || isUploading) return;
    setIsUploading(true);
    for (let i = 0; i < items.length; i++) {
      const current = items[i];
      // Skip already-terminal items: success rows shouldn't re-upload, and
      // rejected rows can't (failed client validation).
      if (current.status === "success" || current.status === "rejected") continue;
      setItems((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: "uploading" } : it))
      );
      try {
        await uploadAsset(current.file);
        setItems((prev) =>
          prev.map((it, idx) => (idx === i ? { ...it, status: "success" } : it))
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: "failed", error: message } : it
          )
        );
      }
    }
    setIsUploading(false);
  };

  // "Done" once every uploadable item completed. Rejected rows count as
  // terminal too — the user removes them or proceeds without them.
  const allDone =
    items.length > 0 &&
    items.every((i) => i.status === "success" || i.status === "rejected");
  const hasUploadable = items.some((i) => i.status === "pending");

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
          <DialogTitle>Add asset{activeProject ? ` to ${activeProject.name}` : ""}</DialogTitle>
          <DialogDescription>
            Drop files here or pick from your machine. Each file is stored under the project folder.
          </DialogDescription>
        </DialogHeader>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer",
            dragOver
              ? "border-primary/60 bg-primary/5"
              : "border-white/15 hover:border-white/30 hover:bg-panel-soft/50"
          )}
        >
          <FileUp className="w-6 h-6 text-muted-foreground" />
          <p className="text-sm text-foreground">Drop files here</p>
          <p className="text-xs text-muted-foreground">or click to choose</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptString}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {items.length > 0 && (
          <div className="mt-4 max-h-60 overflow-y-auto scrollbar-thin space-y-1.5 pr-1">
            {items.map((item, i) => (
              <div
                key={`${item.file.name}-${i}`}
                className="flex items-center gap-2 p-2 rounded-lg bg-panel-soft border border-white/8"
              >
                <FileUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">{item.file.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {(item.file.size / 1024).toFixed(1)} KB
                    {item.error ? ` · ${item.error}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(item.status === "pending" || item.status === "rejected") && (
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.status === "uploading" && (
                    <Loader2 className="w-3.5 h-3.5 text-warning animate-spin" />
                  )}
                  {item.status === "success" && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
                  )}
                  {(item.status === "failed" || item.status === "rejected") && (
                    <XCircle className="w-3.5 h-3.5 text-danger" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-white/8">
          <button
            type="button"
            onClick={() => {
              if (allDone) {
                onOpenChange(false);
              } else {
                onOpenChange(false);
              }
            }}
            className="px-4 py-2 rounded-xl bg-panel-soft border border-white/10 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {allDone ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={startUpload}
            disabled={!hasUploadable || isUploading}
            className={cn(
              "brand-gradient text-white font-medium inline-flex items-center gap-2 px-4 py-2 text-[13px] rounded-xl transition-all duration-200",
              "hover:shadow-[0_0_30px_rgba(255,122,69,0.45)] hover:scale-[1.02] active:scale-[0.98]",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            )}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4" />
                Upload {items.length > 0 ? `(${items.length})` : ""}
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
