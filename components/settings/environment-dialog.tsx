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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useEnvironmentStore } from "@/stores/useEnvironmentStore";
import { ComfyUIEnvironment } from "@/types";
import { Globe, Loader2, Save, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface EnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog is in edit mode for this env. Otherwise create mode. */
  environment?: ComfyUIEnvironment | null;
}

type AuthMode = NonNullable<ComfyUIEnvironment["authMode"]>;

const AUTH_MODE_LABEL: Record<AuthMode, string> = {
  none: "None — direct local access",
  "comfy-org-key": "ComfyUI Account API key (extra_data.api_key_comfy_org)",
  bearer: "Bearer token (Authorization header)",
};

export function EnvironmentDialog({ open, onOpenChange, environment }: EnvironmentDialogProps) {
  const createEnvironment = useEnvironmentStore((s) => s.createEnvironment);
  const updateEnvironment = useEnvironmentStore((s) => s.updateEnvironment);
  const isEditing = !!environment;

  const [name, setName] = useState("");
  const [type, setType] = useState<"local" | "remote">("local");
  const [baseUrl, setBaseUrl] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [apiKey, setApiKey] = useState("");
  // Per-stage timeout (minutes for friendlier display; converted to seconds on save).
  const [runTimeoutMin, setRunTimeoutMin] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form-init setStates run in a microtask so they don't fire in the effect's
  // synchronous frame (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (environment) {
        setName(environment.name);
        setType(environment.type);
        setBaseUrl(environment.baseUrl);
        setAuthMode(environment.authMode ?? "none");
        setApiKey(environment.apiKey ?? "");
        setRunTimeoutMin(
          String(Math.round((environment.runTimeoutSec ?? 1800) / 60))
        );
      } else {
        setName("");
        setType("local");
        setBaseUrl("http://127.0.0.1:8188");
        setAuthMode("none");
        setApiKey("");
        setRunTimeoutMin("30");
      }
      setError(null);
      setSubmitting(false);
    });
  }, [open, environment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) return setError("Name is required");
    if (!baseUrl.trim()) return setError("Base URL is required");
    try {
      new URL(baseUrl);
    } catch {
      return setError("Base URL must be a valid URL (e.g. http://127.0.0.1:8188)");
    }
    if (authMode !== "none" && !apiKey.trim()) {
      return setError("API key is required for the selected auth mode");
    }
    const timeoutMin = Number(runTimeoutMin);
    if (
      !Number.isFinite(timeoutMin) ||
      timeoutMin < 1 ||
      timeoutMin > 120
    ) {
      return setError("Run timeout must be between 1 and 120 minutes");
    }
    const runTimeoutSec = Math.round(timeoutMin * 60);

    setSubmitting(true);
    try {
      if (isEditing && environment) {
        await updateEnvironment(environment.id, {
          name: name.trim(),
          type,
          baseUrl: baseUrl.trim(),
          authMode,
          apiKey: authMode === "none" ? undefined : apiKey.trim(),
          runTimeoutSec,
        });
        toast.success(`Updated ${name.trim()}`);
      } else {
        await createEnvironment({
          name: name.trim(),
          type,
          baseUrl: baseUrl.trim(),
          authMode,
          apiKey: authMode === "none" ? undefined : apiKey.trim(),
          runTimeoutSec,
        });
        toast.success(`Added ${name.trim()}`);
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit environment" : "Add environment"}</DialogTitle>
          <DialogDescription>
            Point the studio at a local or remote ComfyUI server. You can run multiple and switch the active one anytime.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Local ComfyUI"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("local")}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors",
                  type === "local"
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-white/10 bg-panel-soft text-muted-foreground hover:text-foreground"
                )}
              >
                <Server className="w-3.5 h-3.5" />
                Local
              </button>
              <button
                type="button"
                onClick={() => setType("remote")}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors",
                  type === "remote"
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-white/10 bg-panel-soft text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                Remote
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Base URL</label>
            <Input
              mono
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:8188"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Authentication</label>
            <Select
              wrapperClassName="w-full"
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as AuthMode)}
            >
              {(Object.keys(AUTH_MODE_LABEL) as AuthMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {AUTH_MODE_LABEL[mode]}
                </option>
              ))}
            </Select>
          </div>

          {authMode !== "none" && (
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">API Key</label>
              <Input
                mono
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={authMode === "comfy-org-key" ? "comfyui-..." : "sk-..."}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Run timeout (minutes)
            </label>
            <Input
              mono
              type="number"
              min={1}
              max={120}
              value={runTimeoutMin}
              onChange={(e) => setRunTimeoutMin(e.target.value)}
              placeholder="30"
            />
            <p className="text-[10px] text-muted-foreground">
              Hard ceiling per ComfyUI node execution. Long video runs may need 60+. Default 30.
            </p>
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
              {submitting ? "Saving..." : isEditing ? "Save changes" : "Add environment"}
            </GradientButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
