"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type InputSize = "sm" | "md";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: InputSize;
  /** Show a monospace font (good for URLs, IDs, hex values). */
  mono?: boolean;
}

const sizeClasses: Record<InputSize, string> = {
  md: "px-3 py-2 text-sm",
  sm: "px-2.5 py-1.5 text-xs",
};

/**
 * Styled text input with the studio's dark form treatment.
 *
 * - Always use this rather than a bare `<input>` so the focus ring, border,
 *   and placeholder color stay consistent.
 * - Pass `mono` for monospace font (URLs, IDs, hex values).
 * - All native input attributes pass through, including `type` (text, email,
 *   number, password, search, url, etc.).
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "md", mono, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "w-full bg-panel-soft border border-white/10 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          sizeClasses[size],
          mono && "font-mono",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
