"use client";

import * as React from "react";
import { Info, AlertTriangle, XCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutTier = "info" | "warning" | "error" | "success";

export interface CalloutProps {
  /** Visual + semantic tier. Drives icon and color theme. */
  tier?: CalloutTier;
  /** Bold title rendered on the first line. Optional — body alone works. */
  title?: React.ReactNode;
  /** Body content. Use children for richer markup (links, lists). */
  children?: React.ReactNode;
  /** Override the default icon (info → Info, warning → AlertTriangle, etc.) */
  icon?: React.ReactNode;
  /** Show a dismiss X. Caller controls whether it's actually rendered/handled. */
  onDismiss?: () => void;
  /** Inline action (e.g. an "Add endpoint" button) rendered to the right. */
  action?: React.ReactNode;
  /** Force single-line layout (truncates body). Default: auto-detects when no title + no children newlines. */
  singleLine?: boolean;
  className?: string;
}

const tierStyles: Record<
  CalloutTier,
  {
    container: string;
    icon: string;
    title: string;
    DefaultIcon: React.ComponentType<{ className?: string }>;
  }
> = {
  info: {
    container: "bg-accent-blue/8 border-accent-blue/25 text-foreground",
    icon: "text-accent-blue",
    title: "text-foreground",
    DefaultIcon: Info,
  },
  warning: {
    container: "bg-warning/8 border-warning/30 text-foreground",
    icon: "text-warning",
    title: "text-foreground",
    DefaultIcon: AlertTriangle,
  },
  error: {
    container: "bg-danger/10 border-danger/30 text-foreground",
    icon: "text-danger",
    title: "text-foreground",
    DefaultIcon: XCircle,
  },
  success: {
    container: "bg-accent-green/8 border-accent-green/25 text-foreground",
    icon: "text-accent-green",
    title: "text-foreground",
    DefaultIcon: CheckCircle2,
  },
};

/**
 * Callout — info / warning / error / success bubble for empty states, inline
 * messages, and contextual hints.
 *
 * Use cases:
 *   - Empty-state hints (no endpoints registered → "you can't generate yet")
 *   - Form errors that don't belong on a single field
 *   - Settings warnings (unsaved changes, environment misconfigured)
 *   - Success confirmations after a completed action
 *
 * Designed to be the single answer to "I want to surface a piece of contextual
 * information". Always reach for this rather than rolling a one-off colored
 * div — the four tiers + consistent layout keep the app's voice coherent.
 */
export function Callout({
  tier = "info",
  title,
  children,
  icon,
  onDismiss,
  action,
  singleLine,
  className,
}: CalloutProps) {
  const style = tierStyles[tier];
  const IconComp = style.DefaultIcon;

  // Auto-detect single-line: no title, simple string children with no newlines.
  const isSingleLine =
    singleLine ??
    (!title && typeof children === "string" && !children.includes("\n"));

  return (
    <div
      role="status"
      className={cn(
        "border rounded-lg flex items-start gap-3",
        isSingleLine ? "px-3 py-2" : "p-3",
        style.container,
        className
      )}
    >
      <span className={cn("shrink-0 mt-0.5", style.icon, isSingleLine && "mt-0")}>
        {icon ?? <IconComp className="w-4 h-4" />}
      </span>

      <div className={cn("flex-1 min-w-0", isSingleLine && "flex items-center")}>
        {title && (
          <p className={cn("text-sm font-medium leading-tight", style.title)}>
            {title}
          </p>
        )}
        {children && (
          <div
            className={cn(
              "text-xs text-muted-foreground leading-relaxed",
              title && "mt-0.5",
              isSingleLine && "truncate"
            )}
          >
            {children}
          </div>
        )}
      </div>

      {action && <div className="shrink-0 ml-2">{action}</div>}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 -mr-1 -mt-1 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
