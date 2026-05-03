"use client";

import { EmptyState } from "@/components/shared/EmptyState";
import { Construction } from "lucide-react";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Connect with external services</p>
      </div>

      <EmptyState
        icon={<Construction className="w-6 h-6" />}
        title="Coming Soon"
        description="Third-party integrations are under development. Check back later for updates."
      />
    </div>
  );
}
