/**
 * Project store — owns the active project, its asset gallery, and the
 * floating composer's draft state.
 *
 * Async actions (`loadProject`, `uploadAsset`, `removeAsset`) hit the API
 * routes directly. The store is the single boundary; the project page
 * component just reads selectors and dispatches.
 *
 * `composerReferencedAssets` is the structured list of `@`-mention chips
 * above the textarea. The chip array — not the inline `@asset_name`
 * substring — is what actually gets sent as workflow input. The text in
 * the textarea is decorative, the chip ids are load-bearing.
 *
 * `isGenerating` is a boolean lock. The composer disables Generate while
 * a project run is in flight; the SSE stream's `run.completed` /
 * `run.failed` events flip it back to false.
 */
"use client";

import { create } from "zustand";
import { Project, Asset, AssetRef, ComposerControl } from "@/types";

interface ProjectState {
  activeProject: Project | null;
  assets: Asset[];
  selectedAssets: string[];
  activeWorkflow: string | null;
  composerControls: ComposerControl[];
  composerInput: string;
  composerReferencedAssets: AssetRef[];
  isGenerating: boolean;
  isLoadingProject: boolean;
  projectError: string | null;
  /** Discriminator so the project page can pick a sensible UX per error kind. */
  projectErrorKind: "not_found" | "load_failed" | null;
  /** Soft error that didn't block the page — e.g. assets fetch failed but project did load. */
  assetsLoadWarning: string | null;
  galleryFilter: "all" | "images" | "videos" | "music" | "favorites";
  gallerySort: string;
  viewMode: "grid" | "list";

  setActiveProject: (project: Project | null) => void;
  setAssets: (assets: Asset[]) => void;
  addAsset: (asset: Asset) => void;
  toggleAssetSelection: (id: string) => void;
  setActiveWorkflow: (id: string | null) => void;
  setComposerInput: (input: string) => void;
  addReferencedAsset: (asset: AssetRef) => void;
  removeReferencedAsset: (id: string) => void;
  clearReferencedAssets: () => void;
  setComposerControls: (controls: ComposerControl[]) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setGalleryFilter: (filter: "all" | "images" | "videos" | "music" | "favorites") => void;
  setGallerySort: (sort: string) => void;
  setViewMode: (mode: "grid" | "list") => void;

  loadProject: (id: string) => Promise<void>;
  reloadAssets: () => Promise<void>;
  uploadAsset: (file: File) => Promise<Asset>;
  removeAsset: (assetId: string) => Promise<void>;
}

// Module-scoped sequence so concurrent `loadProject` calls can detect
// when their result is stale and bail out before clobbering newer state.
let loadProjectToken = 0;

/**
 * Discriminated fetch error so callers can distinguish 404 from other
 * failures and pick the right UX (Go-to-list vs Retry vs generic).
 */
class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new HttpError(res.status, message);
  }
  return (await res.json()) as T;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,
  assets: [],
  selectedAssets: [],
  activeWorkflow: null,
  composerControls: [],
  composerInput: "",
  composerReferencedAssets: [],
  isGenerating: false,
  isLoadingProject: false,
  projectError: null,
  projectErrorKind: null,
  assetsLoadWarning: null,
  galleryFilter: "all",
  gallerySort: "newest",
  viewMode: "grid",

  setActiveProject: (project) =>
    set({
      activeProject: project,
      assets: [],
      selectedAssets: [],
      composerReferencedAssets: [],
      composerInput: "",
    }),
  setAssets: (assets) => set({ assets }),
  addAsset: (asset) => set((state) => ({ assets: [asset, ...state.assets] })),
  toggleAssetSelection: (id) =>
    set((state) => ({
      selectedAssets: state.selectedAssets.includes(id)
        ? state.selectedAssets.filter((a) => a !== id)
        : [...state.selectedAssets, id],
    })),
  setActiveWorkflow: (id) => set({ activeWorkflow: id }),
  setComposerInput: (input) => set({ composerInput: input }),
  addReferencedAsset: (asset) =>
    set((state) =>
      state.composerReferencedAssets.some((a) => a.id === asset.id)
        ? state
        : { composerReferencedAssets: [...state.composerReferencedAssets, asset] }
    ),
  removeReferencedAsset: (id) =>
    set((state) => ({
      composerReferencedAssets: state.composerReferencedAssets.filter((a) => a.id !== id),
    })),
  clearReferencedAssets: () => set({ composerReferencedAssets: [] }),
  setComposerControls: (controls) => set({ composerControls: controls }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setGalleryFilter: (filter) => set({ galleryFilter: filter }),
  setGallerySort: (sort) => set({ gallerySort: sort }),
  setViewMode: (mode) => set({ viewMode: mode }),

  loadProject: async (id) => {
    // Generation token: each loadProject increments and captures a token.
    // When the awaited fetches resolve, we ignore the result if the
    // token is no longer current. Prevents Project A's slow load from
    // overwriting Project B's state when the user navigates A → B
    // quickly.
    loadProjectToken += 1;
    const myToken = loadProjectToken;
    set({
      isLoadingProject: true,
      projectError: null,
      projectErrorKind: null,
      assetsLoadWarning: null,
      // Clear stale state up-front so the UI doesn't show Project A's
      // content while B is loading.
      activeProject: null,
      assets: [],
      selectedAssets: [],
      composerReferencedAssets: [],
      composerInput: "",
    });

    // Fetch sequentially-ish (separate awaits) so we can distinguish
    // "project not found" (terminal) from "assets fetch failed" (soft —
    // we can still show project metadata + a retry button).
    let project: Project;
    try {
      const res = await fetchJson<{ project: Project }>(
        `/api/projects/${encodeURIComponent(id)}`
      );
      project = res.project;
    } catch (err) {
      if (myToken !== loadProjectToken) return;
      const status = err instanceof HttpError ? err.status : null;
      const kind: "not_found" | "load_failed" =
        status === 404 ? "not_found" : "load_failed";
      const message =
        kind === "not_found"
          ? "This project doesn't exist or has been deleted."
          : err instanceof Error
            ? err.message
            : "Failed to load project";
      set({
        isLoadingProject: false,
        projectError: message,
        projectErrorKind: kind,
      });
      return;
    }

    // Project metadata loaded — commit it so the user at least sees the
    // header/title. Assets may still fail to load; that's a soft error.
    if (myToken !== loadProjectToken) return;
    set({ activeProject: project });

    try {
      const { assets } = await fetchJson<{ assets: Asset[] }>(
        `/api/projects/${encodeURIComponent(id)}/assets`
      );
      if (myToken !== loadProjectToken) return;
      set({ assets, isLoadingProject: false });
    } catch (err) {
      if (myToken !== loadProjectToken) return;
      const message = err instanceof Error ? err.message : "Failed to load assets";
      set({
        assets: [],
        isLoadingProject: false,
        assetsLoadWarning: message,
      });
    }
  },

  reloadAssets: async () => {
    const project = get().activeProject;
    if (!project) return;
    const { assets } = await fetchJson<{ assets: Asset[] }>(
      `/api/projects/${encodeURIComponent(project.id)}/assets`
    );
    set({ assets });
  },

  uploadAsset: async (file) => {
    const project = get().activeProject;
    if (!project) throw new Error("No active project");
    const form = new FormData();
    form.append("file", file);
    const { asset } = await fetchJson<{ asset: Asset }>(
      `/api/projects/${encodeURIComponent(project.id)}/assets`,
      { method: "POST", body: form }
    );
    set((state) => ({ assets: [asset, ...state.assets] }));
    return asset;
  },

  removeAsset: async (assetId) => {
    const project = get().activeProject;
    if (!project) throw new Error("No active project");
    await fetchJson<{ ok: true }>(
      `/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(assetId)}`,
      { method: "DELETE" }
    );
    set((state) => ({
      assets: state.assets.filter((a) => a.id !== assetId),
      selectedAssets: state.selectedAssets.filter((id) => id !== assetId),
    }));
  },
}));
