"use client";

import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Video, Upload, X } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import { TestAssetPickerDialog } from "@/components/workflows/test-asset-picker-dialog";
import { cn } from "@/lib/utils";
import type { NodeProps } from "@/lib/plugins/types";
import type { VideoInputData } from "./manifest";

const ROLES = [
  { id: "reference", label: "Reference" },
  { id: "init", label: "Init / Source" },
  { id: "source", label: "Source clip" },
] as const;

type Role = NonNullable<VideoInputData["inputRole"]>;

function VideoInputNode({ id, data }: NodeProps<VideoInputData>) {
  const update = useNodeUpdate(id);
  const role: Role = data?.inputRole ?? "reference";
  const required: boolean = !!data?.required;
  const isPrimary: boolean = !!data?.isPrimary;
  const testAssetRef = data?.testAssetRef;

  const [pickerOpen, setPickerOpen] = useState(false);

  // Build the file endpoint URL when a test asset is pinned, so we can show
  // a poster frame right on the canvas via `<video preload="metadata">`.
  const testAssetUrl = testAssetRef
    ? `/api/projects/${encodeURIComponent(testAssetRef.projectId)}/assets/${encodeURIComponent(testAssetRef.assetId)}/file`
    : null;

  const handleClearTestAsset = (e: React.MouseEvent) => {
    e.stopPropagation();
    update({ testAssetRef: undefined });
  };

  return (
    <>
      <div className="w-56 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-orange/10 border-b border-white/8">
          <div className="w-5 h-5 rounded-md bg-accent-orange/20 flex items-center justify-center">
            <Video className="w-3 h-3 text-accent-orange" />
          </div>
          <input
            type="text"
            value={data?.label ?? ""}
            onChange={(e) => update({ label: e.target.value })}
            placeholder="Video Input"
            className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
          />
        </div>

        <div className="p-3 space-y-2">
          {/* Test asset slot — click to pick from any project's video assets.
              At run time the orchestrator overrides this with the composer's
              @-mention asset (project mode); this pin is the fallback in
              test mode. */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={cn(
              "nodrag relative w-full aspect-video rounded-lg overflow-hidden border transition-all group",
              testAssetUrl
                ? "border-accent-orange/40 hover:border-accent-orange/70"
                : "border-dashed border-white/15 hover:border-white/30 bg-panel-soft"
            )}
            title={testAssetRef ? "Change test video" : "Pick a test video"}
          >
            {testAssetUrl ? (
              <>
                <video
                  src={testAssetUrl}
                  preload="metadata"
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="text-[10px] text-white font-medium">Change</span>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={handleClearTestAsset}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleClearTestAsset(e as unknown as React.MouseEvent);
                  }}
                  title="Clear test video"
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white"
                >
                  <X className="w-3 h-3" />
                </span>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground group-hover:text-foreground transition-colors">
                <Upload className="w-5 h-5" />
                <span className="text-[10px] font-medium">Pick test video</span>
              </div>
            )}
          </button>

          <p className="text-[10px] text-muted-foreground leading-tight">
            {testAssetRef
              ? "Used during Test Run. Project runs use the composer's video instead."
              : "Click to pick a test video. The composer's video overrides this at run time."}
          </p>

          <div className="space-y-1 nodrag">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Role</span>
            <select
              value={role}
              onChange={(e) => update({ inputRole: e.target.value as Role })}
              className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer nodrag">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => update({ required: e.target.checked })}
                className="accent-primary"
              />
              Required
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer nodrag">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => update({ isPrimary: e.target.checked })}
                className="accent-primary"
              />
              Primary input
            </label>
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Right}
          id="output"
          className="!w-2.5 !h-2.5 !bg-accent-orange !border-2 !border-panel"
          style={{ right: -5, top: "50%" }}
        />
      </div>

      <TestAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        type="video"
        selected={testAssetRef ?? null}
        onPick={(picked) => {
          update({
            testAssetRef: { projectId: picked.projectId, assetId: picked.assetId },
          });
        }}
      />
    </>
  );
}

export default memo(VideoInputNode);
