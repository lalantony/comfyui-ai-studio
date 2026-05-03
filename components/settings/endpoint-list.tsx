"use client";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Callout } from "@/components/ui/callout";
import { EndpointDialog } from "./endpoint-dialog";
import { ComfyEndpoint } from "@/types";
import {
  Edit2,
  Loader2,
  Plus,
  Trash2,
  ImageIcon,
  Music,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface EndpointListProps {
  envId: string;
  envName: string;
}

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; endpoint: ComfyEndpoint }
  | { kind: "delete"; endpoint: ComfyEndpoint };

const TYPE_ICON = { image: ImageIcon, video: Video, audio: Music } as const;
const TYPE_COLOR = {
  image: "text-accent-blue",
  video: "text-accent-pink",
  audio: "text-accent-yellow",
} as const;

export function EndpointList({ envId, envName }: EndpointListProps) {
  const [endpoints, setEndpoints] = useState<ComfyEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/comfy/environments/${encodeURIComponent(envId)}/endpoints`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { endpoints } = (await res.json()) as { endpoints: ComfyEndpoint[] };
      setEndpoints(endpoints);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load endpoints");
    } finally {
      setLoading(false);
    }
  }, [envId]);

  useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);

  const handleDelete = async (endpoint: ComfyEndpoint) => {
    try {
      const res = await fetch(
        `/api/comfy/environments/${encodeURIComponent(envId)}/endpoints/${encodeURIComponent(endpoint.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      toast.success(`Deleted ${endpoint.name}`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">
          Workflow endpoints
          <span className="text-muted-foreground font-normal ml-1.5">({endpoints.length})</span>
        </h4>
        <button
          type="button"
          onClick={() => setDialog({ kind: "create" })}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-panel-soft border border-white/10 text-[11px] text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add endpoint
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-3">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading...
        </div>
      ) : error ? (
        <Callout tier="error" title="Failed to load endpoints">
          {error}
        </Callout>
      ) : endpoints.length === 0 ? (
        <Callout
          tier="warning"
          title="No endpoints registered yet"
        >
          You can&apos;t generate anything from this environment until you add at least one endpoint. Click <strong>Add endpoint</strong> and paste a <code className="font-mono text-foreground/80">workflow_api.json</code> exported from ComfyUI&apos;s dev mode.
        </Callout>
      ) : (
        <div className="space-y-1.5">
          {endpoints.map((ep) => {
            const Icon = TYPE_ICON[ep.output.outputType];
            const colorClass = TYPE_COLOR[ep.output.outputType];
            return (
              <div
                key={ep.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-panel-soft border border-white/8 hover:border-white/15 transition-colors"
              >
                <div className={cn("w-7 h-7 rounded-md bg-panel-elevated flex items-center justify-center shrink-0", colorClass)}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{ep.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {ep.inputs.length} input{ep.inputs.length === 1 ? "" : "s"}
                    {ep.description ? ` · ${ep.description}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "edit", endpoint: ep })}
                  title="Edit"
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "delete", endpoint: ep })}
                  title="Delete"
                  className="p-1.5 rounded text-danger hover:bg-danger/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <EndpointDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        envId={envId}
        endpoint={dialog.kind === "edit" ? dialog.endpoint : null}
        onSaved={() => void reload()}
      />
      <ConfirmDialog
        open={dialog.kind === "delete"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        title={dialog.kind === "delete" ? `Delete ${dialog.endpoint.name}?` : "Delete endpoint?"}
        description={
          dialog.kind === "delete"
            ? `This removes the endpoint from ${envName}. Studio canvas nodes that reference it will show a "missing endpoint" warning until you pick a new one.`
            : ""
        }
        confirmLabel="Delete endpoint"
        destructive
        onConfirm={() => {
          if (dialog.kind === "delete") void handleDelete(dialog.endpoint);
        }}
      />
    </div>
  );
}
