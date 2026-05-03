"use client";

import { EmptyState } from "@/components/shared/EmptyState";
import { Construction } from "lucide-react";

export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Tools</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Utility tools and helpers</p>
      </div>

      <EmptyState
        icon={<Construction className="w-6 h-6" />}
        title="Coming Soon"
        description="Tools and utilities are under development. Check back later for updates."
      />
    </div>
  );
}
