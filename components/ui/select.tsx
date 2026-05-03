"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type SelectSize = "sm" | "md";

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: SelectSize;
  wrapperClassName?: string;
}

const sizeClasses: Record<SelectSize, { select: string; chevron: string; chevronOffset: string }> = {
  md: {
    select: "pl-3 pr-9 py-2 text-sm",
    chevron: "w-4 h-4",
    chevronOffset: "right-3",
  },
  sm: {
    select: "pl-2.5 pr-7 py-1.5 text-xs",
    chevron: "w-3 h-3",
    chevronOffset: "right-2",
  },
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, size = "md", children, ...props }, ref) => {
    const sz = sizeClasses[size];
    return (
      <div className={cn("relative inline-flex", wrapperClassName)}>
        <select
          ref={ref}
          className={cn(
            "appearance-none w-full bg-panel-soft border border-white/10 rounded-lg text-foreground focus:outline-none focus:border-primary/50 cursor-pointer transition-colors",
            sz.select,
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            sz.chevron,
            sz.chevronOffset
          )}
        />
      </div>
    );
  }
);
Select.displayName = "Select";
