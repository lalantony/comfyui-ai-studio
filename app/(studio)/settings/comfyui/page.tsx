"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { GradientButton } from "@/components/shared/GradientButton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EnvironmentDialog } from "@/components/settings/environment-dialog";
import { EndpointList } from "@/components/settings/endpoint-list";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEnvironmentStore } from "@/stores/useEnvironmentStore";
import { ComfyUIEnvironment } from "@/types";
import {
  Plus,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Server,
  Trash2,
  Edit2,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; env: ComfyUIEnvironment }
  | { kind: "delete"; env: ComfyUIEnvironment };

export default function ComfyUISettingsPage() {
  const environments = useEnvironmentStore((s) => s.environments);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const setActive = useEnvironmentStore((s) => s.setActive);
  const removeEnvironment = useEnvironmentStore((s) => s.removeEnvironment);
  const updateEnvironment = useEnvironmentStore((s) => s.updateEnvironment);

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments]);

  const handleSetActive = async (id: string) => {
    try {
      await setActive(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch active environment");
    }
  };

  const handleDelete = async (env: ComfyUIEnvironment) => {
    try {
      await removeEnvironment(env.id);
      toast.success(`Deleted ${env.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const activeEnv = environments.find((e) => e.isActive) ?? environments[0];

  const healthEnabled = activeEnv?.healthCheckEnabled ?? true;
  const healthIntervalSec = activeEnv?.healthCheckIntervalSec ?? 30;

  const handleHealthEnabledChange = async (enabled: boolean) => {
    if (!activeEnv) return;
    try {
      await updateEnvironment(activeEnv.id, { healthCheckEnabled: enabled });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update health check");
    }
  };

  const handleHealthIntervalChange = async (sec: number) => {
    if (!activeEnv) return;
    try {
      await updateEnvironment(activeEnv.id, { healthCheckIntervalSec: sec });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update interval");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">ComfyUI Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage ComfyUI environments and connections</p>
        </div>
        <GradientButton icon={<Plus className="w-4 h-4" />} onClick={() => setDialog({ kind: "create" })}>
          Add Environment
        </GradientButton>
      </div>

      {/* Environments */}
      <div className="space-y-4">
        {environments.map((env) => (
          <GlassPanel key={env.id} className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                    env.type === "local" ? "bg-accent-blue/10" : "bg-accent-orange/10"
                  )}
                >
                  {env.type === "local" ? (
                    <Server className="w-6 h-6 text-accent-blue" />
                  ) : (
                    <Globe className="w-6 h-6 text-accent-orange" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{env.name}</h3>
                    {env.isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-green/10 text-accent-green border border-accent-green/20">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">{env.baseUrl}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1.5">
                      {env.status === "connected" && <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />}
                      {env.status === "disconnected" && <XCircle className="w-3.5 h-3.5 text-danger" />}
                      {env.status === "checking" && <Loader2 className="w-3.5 h-3.5 text-warning animate-spin" />}
                      <span
                        className={cn(
                          "text-xs",
                          env.status === "connected"
                            ? "text-accent-green"
                            : env.status === "checking"
                              ? "text-warning"
                              : "text-danger"
                        )}
                      >
                        {env.status}
                      </span>
                    </div>
                    {env.lastChecked && (
                      <span className="text-xs text-muted-foreground">Last checked: {env.lastChecked}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleSetActive(env.id)}
                  title={env.isActive ? "Active environment" : "Set as active"}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors"
                >
                  <Star
                    className={cn(
                      "w-4 h-4",
                      env.isActive && "fill-accent-yellow text-accent-yellow"
                    )}
                  />
                </button>
                <button
                  onClick={() => setDialog({ kind: "edit", env })}
                  title="Edit"
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDialog({ kind: "delete", env })}
                  title="Delete"
                  className="p-2 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {env.apiKey && (
              <div className="mt-3 pt-3 border-t border-white/8">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">API Key</span>
                  <span className="text-xs text-foreground font-mono">
                    {env.apiKey.replace(/.(?=.{4})/g, "•")}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-white/8">
              <EndpointList envId={env.id} envName={env.name} />
            </div>
          </GlassPanel>
        ))}

        {environments.length === 0 && (
          <GlassPanel className="p-8 text-center">
            <p className="text-sm text-foreground mb-1">No environments yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Add a local or remote ComfyUI server to start running workflows.
            </p>
            <GradientButton icon={<Plus className="w-4 h-4" />} onClick={() => setDialog({ kind: "create" })}>
              Add Environment
            </GradientButton>
          </GlassPanel>
        )}
      </div>

      {/* Active Environment selector */}
      {environments.length > 0 && (
        <GlassPanel className="p-5">
          <SectionHeader title="Active Environment" />
          <p className="text-xs text-muted-foreground mb-3">
            All workflow runs use the active environment. Only one can be active at a time.
          </p>
          <div className="flex items-center gap-3">
            <Select
              wrapperClassName="flex-1"
              value={activeEnv?.id ?? ""}
              onChange={(e) => handleSetActive(e.target.value)}
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name} — {env.baseUrl}
                </option>
              ))}
            </Select>
            {activeEnv?.isActive && (
              <span className="text-[10px] px-2 py-1 rounded-full bg-accent-green/10 text-accent-green border border-accent-green/20 shrink-0">
                Active
              </span>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Health Check Settings — apply to active env */}
      {activeEnv && (
        <GlassPanel className="p-5">
          <SectionHeader title="Health Check" />
          <p className="text-xs text-muted-foreground mb-4">
            Settings apply to the active environment ({activeEnv.name}).
          </p>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Auto Health Check</p>
                <p className="text-xs text-muted-foreground">Poll /system_stats and show live status</p>
              </div>
              <Switch
                checked={healthEnabled}
                onCheckedChange={handleHealthEnabledChange}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Check Interval</p>
                <p className="text-xs text-muted-foreground">How often to refresh metrics</p>
              </div>
              <Select
                size="sm"
                value={String(healthIntervalSec)}
                onChange={(e) => void handleHealthIntervalChange(Number(e.target.value))}
                disabled={!healthEnabled}
              >
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="300">5 minutes</option>
              </Select>
            </div>
          </div>
        </GlassPanel>
      )}

      <EnvironmentDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        environment={dialog.kind === "edit" ? dialog.env : null}
      />
      <ConfirmDialog
        open={dialog.kind === "delete"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        title={dialog.kind === "delete" ? `Delete ${dialog.env.name}?` : "Delete environment?"}
        description={
          dialog.kind === "delete"
            ? `This will remove ${dialog.env.baseUrl} from your environments. Workflows currently pointing here will need a new active environment.`
            : ""
        }
        confirmLabel="Delete environment"
        destructive
        onConfirm={() => {
          if (dialog.kind === "delete") void handleDelete(dialog.env);
        }}
      />
    </div>
  );
}
