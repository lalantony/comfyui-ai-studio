"use client";

import { EmptyState } from "@/components/shared/EmptyState";
import { Construction } from "lucide-react";

export default function ModelsSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Models</h1>
        <p className="text-sm text-muted-foreground mt-0.5">LLM and AI model configuration</p>
      </div>

      <EmptyState
        icon={<Construction className="w-6 h-6" />}
        title="Coming Soon"
        description="Model configuration will be done per-workflow in the workflow editor. Defaults and shared model settings live here in a future release."
      />
    </div>
  );
}
