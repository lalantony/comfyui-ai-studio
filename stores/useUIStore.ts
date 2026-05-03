/**
 * UI shell state — what's collapsed, what's selected, which settings tab is open.
 *
 * Owns no domain data. The other stores (project, workflow, environment)
 * each handle their own slice; this one is just for shell-level chrome that
 * has to be observed by both `app/(studio)/layout.tsx` and the headers.
 */
"use client";

import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  bottomPanelOpen: boolean;
  activeView: "home" | "projects" | "workflows" | "models" | "assets" | "tools" | "integrations" | "settings";
  activeSettingsTab: string;

  toggleSidebar: () => void;
  toggleBottomPanel: () => void;
  setActiveView: (view: UIState["activeView"]) => void;
  setActiveSettingsTab: (tab: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  bottomPanelOpen: true,
  activeView: "home",
  activeSettingsTab: "comfyui",

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleBottomPanel: () => set((state) => ({ bottomPanelOpen: !state.bottomPanelOpen })),
  setActiveView: (view) => set({ activeView: view }),
  setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),
}));
