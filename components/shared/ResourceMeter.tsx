"use client";

import { cn } from "@/lib/utils";

interface ResourceMeterProps {
  label: string;
  value: number;
  className?: string;
}

export function ResourceMeter({ label, value, className }: ResourceMeterProps) {
  const getColor = (v: number) => {
    if (v < 50) return "bg-accent-green";
    if (v < 80) return "bg-warning";
    return "bg-danger";
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[11px] text-muted-foreground w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-panel-soft rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", getColor(value))}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground w-8 text-right">{value}%</span>
    </div>
  );
}
