"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  hover?: boolean;
}

export function GlassPanel({ children, className, elevated = false, hover = false }: GlassPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border backdrop-blur-xl",
        elevated
          ? "bg-panel-elevated/90 border-white/10"
          : "bg-panel/80 border-white/8",
        hover && "hover:border-white/15 transition-colors duration-200",
        className
      )}
    >
      {children}
    </div>
  );
}
