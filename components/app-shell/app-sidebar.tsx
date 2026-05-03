"use client";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/useUIStore";
import { AppLogo } from "@/components/shared/AppLogo";
import {
  Home,
  Folder,
  Workflow,
  Boxes,
  Image,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const studioItems = [
  { id: "home", label: "Home", icon: Home, href: "/" },
  { id: "projects", label: "Projects", icon: Folder, href: "/projects" },
  { id: "assets", label: "Assets", icon: Image, href: "/assets" },
];

const manageItems = [
  { id: "workflows", label: "Workflows", icon: Workflow, href: "/workflows" },
];

const settingsItems = [
  { id: "comfyui", label: "ComfyUI", icon: Boxes, href: "/settings/comfyui" },
];

export function AppSidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-panel border-r border-white/8 flex flex-col z-40 transition-all duration-300",
        sidebarCollapsed ? "w-16" : "w-60"
      )}
    >
      {/* Brand */}
      <div className="h-14 px-4 border-b border-white/8 flex items-center shrink-0">
        <Link href="/" className="flex items-center gap-2.5 group">
          <AppLogo size={28} />
          {!sidebarCollapsed && (
            <div className="overflow-hidden leading-tight">
              <h1 className="text-[13px] font-semibold text-foreground whitespace-nowrap group-hover:text-foreground transition-colors">
                ComfyUI AI Studio
              </h1>
              <p className="text-[9px] text-muted-foreground whitespace-nowrap">workflow-driven creation</p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-3">
        {/* Studio Section */}
        <div className="px-3 mb-1">
          {!sidebarCollapsed && (
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">
              Studio
            </span>
          )}
        </div>
        <nav className="px-2 space-y-0.5 mb-4">
          {studioItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-2 py-2 rounded-lg text-[13px] transition-all duration-200",
                isActive(item.href)
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-panel-soft"
              )}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          ))}
        </nav>

        {/* Manage Section */}
        <div className="px-3 mb-1">
          {!sidebarCollapsed && (
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">
              Manage
            </span>
          )}
        </div>
        <nav className="px-2 space-y-0.5 mb-4">
          {manageItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-2 py-2 rounded-lg text-[13px] transition-all duration-200",
                isActive(item.href)
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-panel-soft"
              )}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          ))}
        </nav>

        {/* Settings Section */}
        <div className="px-3 mb-1">
          {!sidebarCollapsed && (
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">
              Settings
            </span>
          )}
        </div>
        <nav className="px-2 space-y-0.5">
          {settingsItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-2 py-2 rounded-lg text-[13px] transition-all duration-200",
                isActive(item.href)
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-panel-soft"
              )}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          ))}
        </nav>
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-panel-elevated border border-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-50"
      >
        {sidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </aside>
  );
}
