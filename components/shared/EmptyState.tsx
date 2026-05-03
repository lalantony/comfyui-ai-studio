"use client";

import { ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <GlassPanel className="flex flex-col items-center justify-center p-12 text-center">
      <div className="w-12 h-12 rounded-xl bg-panel-soft flex items-center justify-center mb-4 text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-4">{description}</p>
      {action}
    </GlassPanel>
  );
}
