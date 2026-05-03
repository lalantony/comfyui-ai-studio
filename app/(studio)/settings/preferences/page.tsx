"use client";

import { EmptyState } from "@/components/shared/EmptyState";
import { Construction } from "lucide-react";

export default function PreferencesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Preferences</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Studio-wide settings and personal defaults</p>
      </div>

      <EmptyState
        icon={<Construction className="w-6 h-6" />}
        title="Coming Soon"
        description="Theme, keyboard shortcuts, default workflow, storage location, and other studio preferences are under development."
      />
    </div>
  );
}
