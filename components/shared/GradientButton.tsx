"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GradientButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  type?: "button" | "submit" | "reset";
}

export function GradientButton({ children, className, onClick, disabled, size = "md", icon, type = "button" }: GradientButtonProps) {
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs rounded-lg",
    md: "px-4 py-2 text-[13px] rounded-xl",
    lg: "px-6 py-3 text-sm rounded-2xl",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "brand-gradient text-white font-medium inline-flex items-center gap-2 transition-all duration-200",
        "hover:shadow-[0_0_30px_rgba(255,122,69,0.45)] hover:scale-[1.02] active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
        sizeClasses[size],
        className
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
