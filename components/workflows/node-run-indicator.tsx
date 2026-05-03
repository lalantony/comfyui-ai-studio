"use client";

import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export function NodeRunIndicator({ nodeId }: { nodeId: string }) {
  const status = useWorkflowStore((s) => s.nodeRunStates[nodeId] ?? "idle");
  if (status === "idle") return null;

  return (
    <>
      {/* Indeterminate progress bar under the header (~36px down). Pure CSS — no plugin needed. */}
      {status === "running" && (
        <div className="absolute top-[34px] left-2 right-2 h-0.5 rounded-full bg-accent-green/15 overflow-hidden pointer-events-none">
          <div
            className="h-full w-1/3 bg-accent-green rounded-full"
            style={{ animation: "node-progress-slide 1.4s ease-in-out infinite" }}
          />
        </div>
      )}

      {/* Status pill at top-right */}
      <div className="absolute -top-2 -right-2 pointer-events-none">
        {status === "running" && (
          <div className="w-5 h-5 rounded-full bg-background border border-warning/40 flex items-center justify-center shadow-md">
            <Loader2 className="w-3 h-3 text-warning animate-spin" />
          </div>
        )}
        {status === "success" && (
          <div className="w-5 h-5 rounded-full bg-background border border-accent-green/50 flex items-center justify-center shadow-md">
            <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
          </div>
        )}
        {status === "failed" && (
          <div className="w-5 h-5 rounded-full bg-background border border-danger/50 flex items-center justify-center shadow-md">
            <XCircle className="w-3.5 h-3.5 text-danger" />
          </div>
        )}
      </div>
    </>
  );
}
