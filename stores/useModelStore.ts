/**
 * Model store — legacy LLM provider configurations.
 *
 * @deprecated The new design puts API keys per-LLM-node in `workflow.json`,
 * which is more flexible (different nodes can use different providers in
 * the same workflow). The standalone `/settings/models` page is now a
 * Coming Soon stub. This store is kept so tests/migration paths still
 * compile; it has no production callers.
 */
"use client";

import { create } from "zustand";
import { LLMProvider } from "@/types";

interface ModelState {
  providers: LLMProvider[];
  selectedProvider: LLMProvider | null;
  selectedModel: string;

  setProviders: (providers: LLMProvider[]) => void;
  setSelectedProvider: (provider: LLMProvider | null) => void;
  setSelectedModel: (model: string) => void;
  addProvider: (provider: LLMProvider) => void;
  updateProvider: (id: string, data: Partial<LLMProvider>) => void;
  removeProvider: (id: string) => void;
  testLLMConnection: (id: string) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  providers: [],
  selectedProvider: null,
  selectedModel: "",

  setProviders: (providers) => set({ providers }),
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  addProvider: (provider) => set((state) => ({ providers: [...state.providers, provider] })),
  updateProvider: (id, data) =>
    set((state) => ({
      providers: state.providers.map((p) => (p.id === id ? { ...p, ...data } : p)),
    })),
  removeProvider: (id) =>
    set((state) => ({ providers: state.providers.filter((p) => p.id !== id) })),
  testLLMConnection: () => {
    // TODO: implement against the LLM provider's /models endpoint when settings/models page comes back online.
  },
}));
