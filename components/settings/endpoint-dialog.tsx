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
import { ComfyEndpoint, ComfyEndpointInput, ComfyEndpointOutput } from "@/types";
import {
  Loader2,
  Plus,
  Save,
  ScanSearch,
  Trash2,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface EndpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envId: string;
  /** Provided in edit mode. Null/undefined = create mode. */
  endpoint?: ComfyEndpoint | null;
  onSaved: () => void;
}

interface IntrospectionResult {
  suggestedInputs: ComfyEndpointInput[];
  suggestedOutput: ComfyEndpointOutput | null;
  detectedNodeCount: number;
  notes: string[];
}

const INPUT_TYPES: ComfyEndpointInput["type"][] = ["text", "image", "video", "number", "boolean", "select"];
const OUTPUT_TYPES: ComfyEndpointOutput["outputType"][] = ["image", "video", "audio"];
const OUTPUT_FIELDS: ComfyEndpointOutput["outputField"][] = ["images", "video", "audio", "files"];

export function EndpointDialog({ open, onOpenChange, envId, endpoint, onSaved }: EndpointDialogProps) {
  const isEditing = !!endpoint;

  const [jsonText, setJsonText] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inputs, setInputs] = useState<ComfyEndpointInput[]>([]);
  const [output, setOutput] = useState<ComfyEndpointOutput | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [introspecting, setIntrospecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setJsonText("");
    setName("");
    setDescription("");
    setInputs([]);
    setOutput(null);
    setNotes([]);
    setError(null);
    setIntrospecting(false);
    setSubmitting(false);
  }, []);

  // Hydrate from existing endpoint when editing. Form-init setStates run in
  // a microtask so they don't fire in the effect's synchronous frame.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (endpoint) {
        setName(endpoint.name);
        setDescription(endpoint.description ?? "");
        setInputs(endpoint.inputs);
        setOutput(endpoint.output);
        setNotes([]);
        setError(null);
        setLoadingExisting(true);
        void fetch(
          `/api/comfy/environments/${encodeURIComponent(envId)}/endpoints/${encodeURIComponent(
            endpoint.id
          )}/workflow-api`
        )
          .then(async (r) => (r.ok ? r.text() : Promise.reject(new Error(await r.text()))))
          .then((text) => setJsonText(text))
          .catch((err) => setError(err instanceof Error ? err.message : "Failed to load JSON"))
          .finally(() => setLoadingExisting(false));
      } else {
        reset();
      }
    });
  }, [open, endpoint, envId, reset]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJsonText(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleIntrospect = async () => {
    if (!jsonText.trim()) {
      setError("Paste or upload a workflow_api.json first");
      return;
    }
    setIntrospecting(true);
    setError(null);
    try {
      const res = await fetch("/api/comfy/introspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowApiJson: jsonText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const result = (await res.json()) as IntrospectionResult;
      setInputs(result.suggestedInputs);
      setOutput(result.suggestedOutput);
      setNotes(result.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Introspection failed");
    } finally {
      setIntrospecting(false);
    }
  };

  const updateInputAt = (idx: number, patch: Partial<ComfyEndpointInput>) => {
    setInputs((prev) => prev.map((i, x) => (x === idx ? { ...i, ...patch } : i)));
  };

  const removeInputAt = (idx: number) => {
    setInputs((prev) => prev.filter((_, x) => x !== idx));
  };

  const addInputRow = () => {
    setInputs((prev) => [
      ...prev,
      {
        studioPort: `input_${prev.length + 1}`,
        label: `Input ${prev.length + 1}`,
        type: "text",
        comfyNodeId: "",
        comfyInputPath: "",
        required: false,
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) return setError("Name is required");
    if (!jsonText.trim()) return setError("workflow_api.json is required");
    if (!output) return setError("Pick an output node before saving");
    if (inputs.some((i) => !i.studioPort.trim() || !i.comfyNodeId.trim() || !i.comfyInputPath.trim())) {
      return setError("Every input row needs a studio port, comfy node id, and input path");
    }
    setSubmitting(true);
    setError(null);
    try {
      const url = isEditing
        ? `/api/comfy/environments/${encodeURIComponent(envId)}/endpoints/${encodeURIComponent(endpoint!.id)}`
        : `/api/comfy/environments/${encodeURIComponent(envId)}/endpoints`;
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          inputs,
          output,
          workflowApiJson: jsonText,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      toast.success(isEditing ? `Updated ${name.trim()}` : `Added ${name.trim()}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit endpoint" : "Add endpoint"}</DialogTitle>
          <DialogDescription>
            Register a ComfyUI workflow_api.json so the canvas can call it. Click <strong>Introspect</strong> to
            auto-detect inputs and the output node, then review and edit.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* JSON input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                workflow_api.json
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleFile}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-panel-soft border border-white/10 text-[11px] text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={handleIntrospect}
                  disabled={!jsonText.trim() || introspecting}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {introspecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
                  {introspecting ? "Introspecting..." : "Introspect"}
                </button>
              </div>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={6}
              placeholder={loadingExisting ? "Loading..." : `{\n  "3": { "class_type": "KSampler", "inputs": { ... } },\n  ...\n}`}
              spellCheck={false}
              className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-y"
            />
          </div>

          {notes.length > 0 && (
            <div className="space-y-1">
              {notes.map((n, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning/5 border border-warning/30 text-[11px] text-warning"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{n}</span>
                </div>
              ))}
            </div>
          )}

          {/* Name + description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="SDXL Base 1.0"
                className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Description <span className="text-muted-foreground/50 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Image generation with refiner"
                className="w-full bg-panel-soft border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {/* Inputs table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Inputs
              </label>
              <button
                type="button"
                onClick={addInputRow}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-panel-soft border border-white/10 text-[11px] text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add input
              </button>
            </div>
            {inputs.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic px-3 py-4 bg-panel-soft/50 border border-white/8 rounded-lg text-center">
                No inputs yet. Run Introspect or click Add input.
              </div>
            ) : (
              <div className="space-y-2">
                {inputs.map((input, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center bg-panel-soft border border-white/8 rounded-lg p-2">
                    <input
                      type="text"
                      value={input.studioPort}
                      onChange={(e) => updateInputAt(idx, { studioPort: e.target.value })}
                      placeholder="port"
                      className="col-span-2 bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50 font-mono"
                    />
                    <input
                      type="text"
                      value={input.label}
                      onChange={(e) => updateInputAt(idx, { label: e.target.value })}
                      placeholder="Label"
                      className="col-span-3 bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
                    />
                    <select
                      value={input.type}
                      onChange={(e) => updateInputAt(idx, { type: e.target.value as ComfyEndpointInput["type"] })}
                      className="col-span-2 bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
                    >
                      {INPUT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={input.comfyNodeId}
                      onChange={(e) => updateInputAt(idx, { comfyNodeId: e.target.value })}
                      placeholder="node id"
                      className="col-span-2 bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50 font-mono"
                    />
                    <input
                      type="text"
                      value={input.comfyInputPath}
                      onChange={(e) => updateInputAt(idx, { comfyInputPath: e.target.value })}
                      placeholder="inputs.X"
                      className="col-span-2 bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => removeInputAt(idx)}
                      title="Remove"
                      className="col-span-1 flex items-center justify-center p-1 rounded text-danger hover:bg-danger/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <label className="col-span-12 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={input.required ?? false}
                        onChange={(e) => updateInputAt(idx, { required: e.target.checked })}
                        className="w-3 h-3 accent-primary"
                      />
                      Required
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Output */}
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Output</label>
            <div className="grid grid-cols-3 gap-2 bg-panel-soft border border-white/8 rounded-lg p-2.5">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Comfy node id</span>
                <input
                  type="text"
                  value={output?.comfyNodeId ?? ""}
                  onChange={(e) =>
                    setOutput({
                      comfyNodeId: e.target.value,
                      outputType: output?.outputType ?? "image",
                      outputField: output?.outputField ?? "images",
                    })
                  }
                  placeholder="e.g. 9"
                  className="w-full bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50 font-mono"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Type</span>
                <select
                  value={output?.outputType ?? "image"}
                  onChange={(e) =>
                    setOutput({
                      comfyNodeId: output?.comfyNodeId ?? "",
                      outputType: e.target.value as ComfyEndpointOutput["outputType"],
                      outputField: output?.outputField ?? "images",
                    })
                  }
                  className="w-full bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
                >
                  {OUTPUT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">History field</span>
                <select
                  value={output?.outputField ?? "images"}
                  onChange={(e) =>
                    setOutput({
                      comfyNodeId: output?.comfyNodeId ?? "",
                      outputType: output?.outputType ?? "image",
                      outputField: e.target.value as ComfyEndpointOutput["outputField"],
                    })
                  }
                  className="w-full bg-panel border border-white/10 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
                >
                  {OUTPUT_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
              icon={submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              disabled={submitting}
            >
              {submitting ? "Saving..." : isEditing ? "Save changes" : "Add endpoint"}
            </GradientButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
