"use client";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { StatusCards } from "@/components/app-shell/status-card";
import { useUIStore } from "@/stores/useUIStore";
import { cn } from "@/lib/utils";

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sidebarCollapsed } = useUIStore();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <TopBar />

      {/* Main Content */}
      <main 
        className={cn(
          "pt-14 min-h-screen transition-all duration-300",
          sidebarCollapsed ? "pl-16" : "pl-60"
        )}
      >
        <div className="flex h-[calc(100vh-3.5rem)]">
          {/* Content Area */}
          <div className="flex-1 overflow-auto p-4 pb-80">
            {children}
          </div>
        </div>
      </main>

      {/* Status Cards - Fixed at bottom of sidebar.
          z-50 sits above the sidebar (z-40) since both are opaque bg-panel and overlap
          in the bottom-left column. The sidebar's nav takes flex-1 above this, so any
          nav item that runs long will scroll inside its own overflow-y-auto. */}
      <div
        className={cn(
          "fixed bottom-0 left-0 border-r border-white/8 bg-panel z-50 transition-all duration-300",
          sidebarCollapsed ? "w-16 hidden" : "w-60 block"
        )}
      >
        <StatusCards />
      </div>
    </div>
  );
}
