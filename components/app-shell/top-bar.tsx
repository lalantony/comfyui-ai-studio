"use client";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/useUIStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { Button } from "@/components/ui/button";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { AddAssetDialog } from "@/components/projects/add-asset-dialog";
import {
  Share2,
  Plus,
  Bell,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type PrimaryAction = "new-project" | "add-asset" | null;

export function TopBar() {
  const { sidebarCollapsed } = useUIStore();
  const pathname = usePathname();
  const [openDialog, setOpenDialog] = useState<PrimaryAction>(null);

  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);

  const getBreadcrumbs = () => {
    if (pathname === "/") return [{ label: "Home", href: "/" }];
    if (pathname?.startsWith("/projects/")) {
      const projectIdFromPath = pathname.split("/")[2];
      const label =
        activeProject && activeProject.id === projectIdFromPath
          ? activeProject.name
          : "Project";
      return [
        { label: "Projects", href: "/projects" },
        { label, href: pathname },
      ];
    }
    if (pathname?.startsWith("/workflows/")) {
      const workflowIdFromPath = pathname.split("/")[2];
      const label =
        activeWorkflow && activeWorkflow.id === workflowIdFromPath
          ? activeWorkflow.name
          : "Workflow";
      return [
        { label: "Workflows", href: "/workflows" },
        { label, href: pathname },
      ];
    }
    if (pathname === "/projects") return [{ label: "Projects", href: "/projects" }];
    if (pathname === "/workflows") return [{ label: "Workflows", href: "/workflows" }];
    if (pathname === "/assets") return [{ label: "Assets", href: "/assets" }];
    if (pathname?.startsWith("/settings/")) {
      const section = pathname.split("/")[2];
      const labels: Record<string, string> = {
        comfyui: "ComfyUI",
        models: "Models",
        tools: "Tools",
        integrations: "Integrations",
        preferences: "Preferences",
      };
      return [
        { label: "Settings", href: "/settings" },
        { label: labels[section] ?? section, href: pathname },
      ];
    }
    if (pathname === "/settings") return [{ label: "Settings", href: "/settings" }];
    return [{ label: "Home", href: "/" }];
  };

  const breadcrumbs = getBreadcrumbs();

  // Primary "+" action depends on the current route
  const primaryAction: { label: string; action: PrimaryAction } | null = (() => {
    if (pathname?.startsWith("/projects/") && pathname !== "/projects") {
      return { label: "Add asset", action: "add-asset" };
    }
    if (pathname === "/" || pathname === "/projects") {
      return { label: "New project", action: "new-project" };
    }
    return null;
  })();

  return (
    <>
      <header
        className={cn(
          "fixed top-0 right-0 h-14 bg-panel/90 backdrop-blur-xl border-b border-white/8 z-30 flex items-center justify-between px-4 transition-all duration-300",
          sidebarCollapsed ? "left-16" : "left-60"
        )}
      >
        {/* Left: Breadcrumbs */}
        <div className="flex items-center gap-2">
          {breadcrumbs.map((crumb, i) => (
            <div key={crumb.href} className="flex items-center gap-2">
              {i > 0 && <span className="text-muted-foreground text-xs">/</span>}
              <Link
                href={crumb.href}
                className={cn(
                  "text-[13px] transition-colors",
                  i === breadcrumbs.length - 1
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {crumb.label}
              </Link>
            </div>
          ))}
          {pathname?.includes("/workflows/") && (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs text-accent-green">Saved</span>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-2">
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
          {primaryAction && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpenDialog(primaryAction.action)}
              className="text-muted-foreground hover:text-foreground gap-2"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{primaryAction.label}</span>
            </Button>
          )}
          <div className="w-px h-6 bg-white/10 mx-1" />
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Bell className="w-4 h-4" />
          </Button>
          <div className="w-8 h-8 rounded-full brand-gradient flex items-center justify-center text-white text-xs font-medium cursor-pointer shadow-[0_2px_10px_rgba(255,122,69,0.35)]">
            JD
          </div>
        </div>
      </header>

      <NewProjectDialog
        open={openDialog === "new-project"}
        onOpenChange={(open) => setOpenDialog(open ? "new-project" : null)}
      />
      <AddAssetDialog
        open={openDialog === "add-asset"}
        onOpenChange={(open) => setOpenDialog(open ? "add-asset" : null)}
      />
    </>
  );
}
