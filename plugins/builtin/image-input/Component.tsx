"use client";

import { memo, useEffect, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Image as ImageIcon, Upload, X, AlertTriangle } from "lucide-react";
import NextImage from "next/image";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import { TestAssetPickerDialog } from "@/components/workflows/test-asset-picker-dialog";
import { cn } from "@/lib/utils";
import type { NodeProps } from "@/lib/plugins/types";
import type { ImageInputData } from "./manifest";

const ROLES = [
  { id: "reference", label: "Reference" },
  { id: "init", label: "Init" },
  { id: "mask", label: "Mask" },
] as const;

type Role = NonNullable<ImageInputData["inputRole"]>;

function ImageInputNode({ id, data }: NodeProps<ImageInputData>) {
  const update = useNodeUpdate(id);
  const role: Role = data?.inputRole ?? "reference";
  const required: boolean = !!data?.required;
  const isPrimary: boolean = !!data?.isPrimary;
  const testAssetRef = data?.testAssetRef;

  const [pickerOpen, setPickerOpen] = useState(false);
  // Track whether the pinned asset's URL is unreachable. The NextImage
  // onError fires on 404 / 5xx — we surface a "Pin broken" badge so the
  // user can fix it on the canvas instead of waiting until they hit Run
  // and see a server-side error.
  const [pinBroken, setPinBroken] = useState(false);

  // Reset broken-state whenever the pin changes — a fresh pick should
  // start out trusted. Defer via queueMicrotask to satisfy the
  // react-hooks/set-state-in-effect rule (project convention; same
  // idiom used in dialog open-effects across the codebase).
  useEffect(() => {
    queueMicrotask(() => setPinBroken(false));
  }, [testAssetRef?.projectId, testAssetRef?.assetId]);

  // Build the file endpoint URL when a test asset is pinned, so we can show
  // a thumbnail right on the canvas.
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
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-blue/10 border-b border-white/8">
          <div className="w-5 h-5 rounded-md bg-accent-blue/20 flex items-center justify-center">
            <ImageIcon className="w-3 h-3 text-accent-blue" />
          </div>
          <input
            type="text"
            value={data?.label ?? ""}
            onChange={(e) => update({ label: e.target.value })}
            placeholder="Image Input"
            className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
          />
        </div>

        <div className="p-3 space-y-2">
          {/* Test asset slot — click to pick from any project's image assets.
              At run time the orchestrator overrides this with the composer's
              @-mention asset (project mode) and falls back to this pinned
              asset only in test mode. */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={cn(
              "nodrag relative w-full aspect-video rounded-lg overflow-hidden border transition-all group",
              testAssetUrl
                ? "border-accent-blue/40 hover:border-accent-blue/70"
                : "border-dashed border-white/15 hover:border-white/30 bg-panel-soft"
            )}
            title={testAssetRef ? "Change test image" : "Pick a test image"}
          >
            {testAssetUrl && !pinBroken ? (
              <>
                <NextImage
                  src={testAssetUrl}
                  alt="Test asset preview"
                  fill
                  sizes="224px"
                  className="object-cover"
                  onError={() => setPinBroken(true)}
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
                  title="Clear test image"
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white"
                >
                  <X className="w-3 h-3" />
                </span>
              </>
            ) : testAssetUrl && pinBroken ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-danger/10 text-danger">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-[10px] font-medium">Pin broken</span>
                <span className="text-[9px] text-danger/80">Asset deleted — click to re-pin</span>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground group-hover:text-foreground transition-colors">
                <Upload className="w-5 h-5" />
                <span className="text-[10px] font-medium">Pick test image</span>
              </div>
            )}
          </button>

          <p className="text-[10px] text-muted-foreground leading-tight">
            {testAssetRef
              ? "Used during Test Run. Project runs use the composer's image instead."
              : "Click to pick a test image. The composer's image overrides this at run time."}
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
          className="!w-2.5 !h-2.5 !bg-accent-blue !border-2 !border-panel"
          style={{ right: -5, top: "50%" }}
        />
      </div>

      <TestAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        type="image"
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

export default memo(ImageInputNode);
