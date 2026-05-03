"use client";

import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/useProjectStore";
import { useUIStore } from "@/stores/useUIStore";
import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { Asset, RunEvent, Workflow } from "@/types";
import { introspectWorkflowInputs } from "@/lib/workflowIntrospection";
import {
  buildRuntimeInputs,
  deriveInputSlots,
  validateComposerInputs,
  type InputSlot,
} from "@/lib/workflow/inputContract";
import * as Popover from "@radix-ui/react-popover";
import {
  PlusCircle,
  Sparkles,
  Loader2,
  Maximize2,
  SlidersHorizontal,
  ChevronDown,
  ImageIcon,
  Wand2,
  Music,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssetMentionList, filterAssetsByQuery } from "./asset-mention-list";

const CONTROLS = [
  { id: "aspectRatio", label: "1:1", options: ["1:1", "16:9", "9:16", "4:5"] },
  { id: "style", label: "Style: Cinematic", options: ["Cinematic", "Realistic", "Anime", "Product"] },
  { id: "quality", label: "Quality: High", options: ["Draft", "High", "Ultra"] },
  { id: "seed", label: "Seed: Random", options: ["Random", "Fixed"] },
] as const;

const WORKFLOW_ICON: Record<Workflow["type"], typeof ImageIcon> = {
  image: ImageIcon,
  video: Wand2,
  music: Music,
  mixed: Settings2,
};

interface ActiveMention {
  start: number;
  query: string;
}

function getActiveMention(value: string, caret: number): ActiveMention | null {
  // Fence-awareness: when the caret is inside a triple-backtick code
  // block, @-mentions should not trigger — users frequently paste shell
  // examples or markdown, and `@scope/package` shouldn't open the asset
  // popover. Count unmatched ``` pairs in the prefix; an odd count means
  // we're inside a fence.
  if (isInsideCodeFence(value, caret)) return null;

  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (/\s/.test(ch)) return null;
    if (ch === "@") {
      if (i === 0 || /\s/.test(value[i - 1])) {
        return { start: i, query: value.slice(i + 1, caret) };
      }
      return null;
    }
  }
  return null;
}

function isInsideCodeFence(value: string, caret: number): boolean {
  // Count occurrences of ``` strictly before the caret. Odd → we're
  // inside an open fence. Triple-backtick is the markdown convention;
  // we don't try to handle four+ backticks (fenced fences) — exotic
  // enough to leave for a follow-up.
  const before = value.slice(0, caret);
  let count = 0;
  let pos = 0;
  while (true) {
    const next = before.indexOf("```", pos);
    if (next === -1) break;
    count++;
    pos = next + 3;
  }
  return count % 2 === 1;
}

export function PromptComposer() {
  const { sidebarCollapsed } = useUIStore();
  const {
    activeProject,
    activeWorkflow: activeWorkflowId,
    composerInput,
    composerReferencedAssets,
    isGenerating,
    assets,
    setComposerInput,
    setActiveWorkflow,
    setIsGenerating,
    addReferencedAsset,
    removeReferencedAsset,
    clearReferencedAssets,
    reloadAssets,
  } = useProjectStore();

  const workflows = useWorkflowStore((s) => s.workflows);
  const loadWorkflows = useWorkflowStore((s) => s.loadWorkflows);

  const [isFocused, setIsFocused] = useState(false);
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [stageProgress, setStageProgress] = useState<{
    completed: number;
    total: number;
    label: string | null;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror of `currentRunId` readable synchronously from inside async
  // callbacks (setTimeout, fetch resolutions). Local-state closures
  // capture stale values; the ref is always fresh, which the cancel-poll
  // fallback uses to avoid clobbering a fresh run's UI state.
  const currentRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentRunIdRef.current = currentRunId;
  }, [currentRunId]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  // Pick a workflow on first load: prefer one matching activeWorkflowId; else the first available.
  const activeWorkflow =
    workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0] ?? null;
  const inputProfile = introspectWorkflowInputs(activeWorkflow);
  const inputSlots: InputSlot[] = activeWorkflow ? deriveInputSlots(activeWorkflow) : [];
  const imageSlots = inputSlots.filter((s) => s.kind === "image");
  const requiredImageSlots = imageSlots.filter((s) => s.required);
  const WorkflowIcon = activeWorkflow ? WORKFLOW_ICON[activeWorkflow.type] : Settings2;

  useEffect(() => {
    // Sync project store's activeWorkflow to whichever real workflow we're displaying
    if (activeWorkflow && activeWorkflowId !== activeWorkflow.id) {
      setActiveWorkflow(activeWorkflow.id);
    }
  }, [activeWorkflow, activeWorkflowId, setActiveWorkflow]);

  // SSE subscription for the active run.
  //
  // Multi-stage chain awareness: count executable nodes once when the run
  // starts (we know the workflow + executable kinds locally), then increment
  // a `completed` counter on `node.completed` for executable kinds. This
  // gives the user a "Stage 2 of 4 — running ComfyUI" pulse without any
  // server-side schema change.
  useEffect(() => {
    if (!currentRunId) return;

    // Total = executable nodes in this workflow. Inert kinds (notes,
    // pure-config) are excluded so the counter mirrors what the user sees
    // light up on the canvas.
    const INERT_KINDS = new Set(["note"]);
    const executableNodes = (activeWorkflow?.nodes ?? []).filter(
      (n) => !INERT_KINDS.has((n.data as { kind?: string })?.kind ?? "")
    );
    let completed = 0;
    queueMicrotask(() =>
      setStageProgress({
        completed: 0,
        total: executableNodes.length,
        label: "preparing run...",
      })
    );

    const findKindFor = (nodeId: string): string | undefined => {
      const node = activeWorkflow?.nodes.find((n) => n.id === nodeId);
      return (node?.data as { kind?: string } | undefined)?.kind;
    };

    const labelForKind = (kind: string | undefined): string => {
      switch (kind) {
        case "comfyui":
          return "running ComfyUI";
        case "llm":
          return "calling LLM";
        case "saveOutput":
          return "saving output";
        case "imageInput":
        case "videoInput":
        case "textInput":
          return "loading inputs";
        default:
          return kind ? `running ${kind}` : "running";
      }
    };

    const es = new EventSource(`/api/workflow-runs/${encodeURIComponent(currentRunId)}/events`);
    // Tracks whether we've observed a terminal event. Distinguishes normal
    // server-closes-stream-after-terminal from a transient mid-run drop.
    // Without this flag, EventSource fires onerror on EVERY EOF (including
    // the expected one after run.completed), causing duplicate cleanup +
    // misleading "connection lost" toasts. With it, onerror only acts on
    // genuine drops.
    let terminalSeen = false;
    const cleanup = () => {
      es.close();
      setCurrentRunId(null);
      setIsGenerating(false);
      setStageProgress(null);
      setCancelling(false);
    };
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as RunEvent;
        if (event.type === "node.started") {
          const kind = findKindFor(event.nodeId);
          setStageProgress((prev) =>
            prev ? { ...prev, label: labelForKind(kind) } : prev
          );
        } else if (event.type === "node.completed") {
          const kind = findKindFor(event.nodeId);
          if (kind && !INERT_KINDS.has(kind)) {
            completed += 1;
            setStageProgress((prev) =>
              prev ? { ...prev, completed, label: prev.label } : prev
            );
            // ComfyUI auto-saved an asset → make it visible immediately.
            if (kind === "comfyui") void reloadAssets();
          }
        } else if (event.type === "node.skipped" || event.type === "node.failed") {
          // Skipped/failed nodes still consume a "stage slot" so the
          // counter doesn't stall on a dead branch.
          completed += 1;
          setStageProgress((prev) => (prev ? { ...prev, completed } : prev));
        } else if (event.type === "run.completed") {
          terminalSeen = true;
          toast.success("Generation complete");
          void reloadAssets();
          cleanup();
        } else if (event.type === "run.failed") {
          terminalSeen = true;
          toast.error(event.error || "Run failed");
          // Reload — partial successes from earlier stages are now in the gallery.
          void reloadAssets();
          cleanup();
        } else if (event.type === "run.cancelled") {
          terminalSeen = true;
          toast("Run cancelled");
          // Stages that completed before the cancel landed are real assets.
          void reloadAssets();
          cleanup();
        }
      } catch {
        /* ignore parse errors */
      }
    };
    es.onerror = () => {
      // EventSource fires onerror on any disconnect, including the normal
      // EOF after the server closes the stream post-terminal-event. Only
      // act on it as a "connection lost" signal if we haven't seen a
      // terminal event yet — otherwise it's the expected close.
      if (terminalSeen) {
        es.close();
        return;
      }
      toast.error("Connection lost — server may still be running. Refresh the project to see final state.");
      cleanup();
    };
    return () => {
      es.close();
    };
  }, [currentRunId, activeWorkflow, reloadAssets, setIsGenerating]);

  const recomputeMention = (value: string, caret: number) => {
    const m = getActiveMention(value, caret);
    setMention(m);
    if (m) setHighlighted(0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposerInput(e.target.value);
    recomputeMention(e.target.value, e.target.selectionStart ?? 0);
  };

  const handleSelectionChange = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    recomputeMention(ta.value, ta.selectionStart);
  };

  const handleSelect = (asset: Asset) => {
    if (!mention) return;
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? mention.start + 1 + mention.query.length;
    const before = composerInput.slice(0, mention.start);
    const after = composerInput.slice(caret);
    const tokenName = asset.name.replace(/\s+/g, "_");
    const inserted = `@${tokenName} `;
    const newValue = `${before}${inserted}${after}`;
    setComposerInput(newValue);
    addReferencedAsset({ id: asset.id, name: asset.name });
    setMention(null);
    setTimeout(() => {
      const ta2 = textareaRef.current;
      if (!ta2) return;
      const newCaret = before.length + inserted.length;
      ta2.focus();
      ta2.setSelectionRange(newCaret, newCaret);
    }, 0);
  };

  // Restrict the @-mention popover to asset types the workflow can
  // actually accept. Workflows that take an image only show images;
  // workflows that take both show both. Prevents the user from picking
  // a video for an image-only workflow and getting a confusing
  // server-side failure.
  const mentionAcceptTypes = (() => {
    const types: Array<"image" | "video"> = [];
    if (inputProfile.hasImageInput) types.push("image");
    if (inputProfile.hasVideoInput) types.push("video");
    return types.length > 0 ? types : undefined;
  })();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mention) return;
    const filtered = filterAssetsByQuery(assets, mention.query, mentionAcceptTypes);
    if (filtered.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      // Clamp before deref: typing fast can shrink `filtered` between
      // renders, leaving `highlighted` past the end. Without this guard,
      // `filtered[highlighted]` is undefined and `handleSelect` crashes
      // when it reads `.id`/`.name` off it.
      const idx = Math.min(highlighted, filtered.length - 1);
      handleSelect(filtered[idx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    }
  };

  const insertMention = () => {
    // Insert @ at the caret to open the asset-mention popover
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? composerInput.length;
    const before = composerInput.slice(0, caret);
    const after = composerInput.slice(caret);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const insertion = `${needsLeadingSpace ? " " : ""}@`;
    const newValue = `${before}${insertion}${after}`;
    setComposerInput(newValue);
    setTimeout(() => {
      ta.focus();
      const newCaret = before.length + insertion.length;
      ta.setSelectionRange(newCaret, newCaret);
      recomputeMention(newValue, newCaret);
    }, 0);
  };

  const handleGenerate = async () => {
    if (isGenerating || currentRunId) return;
    if (!activeProject) {
      toast.error("Open a project first");
      return;
    }
    if (!activeWorkflow) {
      toast.error("Select a workflow first");
      return;
    }

    // Pre-flight against the workflow's input contract. The contract
    // module covers single-image and multi-image workflows uniformly,
    // and surfaces specific error reasons (e.g. "Workflow needs 2 image
    // inputs (1 still missing)") instead of the previous flat
    // "needs a reference image" message.
    const composerState = {
      text: composerInput,
      referencedAssets: composerReferencedAssets.map((ref) => {
        const asset = assets.find((a) => a.id === ref.id);
        return {
          id: ref.id,
          name: ref.name,
          type: asset?.type ?? "file",
        } as const;
      }),
    };
    const validation = validateComposerInputs(inputSlots, composerState);
    if (!validation.ok) {
      // Emit one toast per error so the user sees every missing thing —
      // some workflows have several gaps at once and a single combined
      // toast gets truncated.
      for (const err of validation.errors) {
        toast.error(err.reason);
      }
      return;
    }

    const inputs = buildRuntimeInputs(
      inputSlots,
      composerState,
      activeProject.id
    );

    setIsGenerating(true);
    try {
      const res = await fetch("/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: activeWorkflow.id,
          projectId: activeProject.id,
          mode: "project",
          inputs,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { runId } = (await res.json()) as { runId: string };
      setCurrentRunId(runId);
      // Clear the composer state once the run is accepted by the server.
      // Otherwise the chips + prompt linger and a fast double-click would
      // re-submit them, including stale assetIds for assets the user
      // deleted mid-run. The chips don't survive a successful submit by
      // design — they're per-run.
      setComposerInput("");
      clearReferencedAssets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start run");
      setIsGenerating(false);
    }
  };

  const handleCancel = async () => {
    if (!currentRunId || cancelling) return;
    setCancelling(true);
    const runIdAtClick = currentRunId;
    try {
      const res = await fetch(
        `/api/workflow-runs/${encodeURIComponent(runIdAtClick)}/cancel`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      // SSE will deliver `run.cancelled` and clean up state. But if the
      // server already wrote `run.cancelled` and closed the stream cleanly
      // before the client noticed, no `error` event fires on the
      // EventSource — the button would stay stuck in "Cancelling...". After
      // 5s, poll the run record once and clear local state if the run is in
      // a terminal status.
      setTimeout(() => {
        void (async () => {
          try {
            const probe = await fetch(
              `/api/workflow-runs/${encodeURIComponent(runIdAtClick)}`
            );
            if (!probe.ok) return;
            const { run } = (await probe.json()) as { run?: { status?: string } };
            const terminal = ["succeeded", "failed", "cancelled"].includes(
              run?.status ?? ""
            );
            if (!terminal) return;
            // Race guard: if the user clicked Cancel, then quickly clicked
            // Generate again, `currentRunId` now points at the *new* run.
            // Don't wipe its surrounding state. The setCurrentRunId update
            // is functional + scoped to runIdAtClick already; we extend
            // the same scoping to the other UI-state setters via the ref.
            if (currentRunIdRef.current !== runIdAtClick) {
              return;
            }
            setCurrentRunId(null);
            setIsGenerating(false);
            setStageProgress(null);
            setCancelling(false);
          } catch {
            /* network error — leave SSE handling to take over */
          }
        })();
      }, 5000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel");
      setCancelling(false);
    }
  };

  const addImageDisabled = !activeWorkflow || !inputProfile.hasImageInput;
  const addImageHint = !activeWorkflow
    ? "Select a workflow first"
    : !inputProfile.hasImageInput
      ? "This workflow doesn't take an image input"
      : "Use @ to attach a project asset";

  const addVideoDisabled = !activeWorkflow || !inputProfile.hasVideoInput;
  const addVideoHint = !activeWorkflow
    ? "Select a workflow first"
    : !inputProfile.hasVideoInput
      ? "This workflow doesn't take a video input"
      : "Use @ to attach a project video";

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-30 px-4 pb-4 transition-[left] duration-300",
        sidebarCollapsed ? "left-16" : "left-60"
      )}
    >
      <div
        className={cn(
          "bg-panel-elevated/95 backdrop-blur-xl border rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.4)] flex items-stretch gap-3 p-3",
          isFocused ? "border-primary/40 shadow-[0_0_40px_rgba(124,92,255,0.15)]" : "border-white/10"
        )}
      >
        {/* Left column: workflow selector + quick attach actions */}
        <div className="flex flex-col gap-1.5 shrink-0 w-[148px]">
          <label className="relative block">
            <select
              value={activeWorkflow?.id ?? ""}
              onChange={(e) => setActiveWorkflow(e.target.value)}
              // Disable while a run is active. Otherwise switching the
              // workflow mid-run re-runs the SSE effect with a different
              // node set: the stage counter resets, kind labels become
              // wrong, and progress numbers go nonsensical.
              disabled={workflows.length === 0 || !!currentRunId}
              title={currentRunId ? "Can't change workflow while a run is in progress" : undefined}
              className="appearance-none w-full bg-panel-soft border border-white/10 rounded-xl pl-9 pr-7 py-2 text-xs font-medium text-foreground hover:border-white/20 focus:outline-none focus:border-primary/50 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {workflows.length === 0 ? (
                <option value="">No workflows</option>
              ) : (
                workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))
              )}
            </select>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md brand-gradient flex items-center justify-center pointer-events-none">
              <WorkflowIcon className="w-3 h-3 text-white" />
            </span>
            <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </label>

          <button
            type="button"
            onClick={insertMention}
            disabled={addImageDisabled}
            title={addImageHint}
            className={cn(
              "flex items-center gap-2 bg-panel-soft border border-white/10 rounded-xl px-3 py-2 text-xs transition-colors",
              addImageDisabled
                ? "opacity-50 cursor-not-allowed text-muted-foreground"
                : "text-muted-foreground hover:text-foreground hover:border-white/20"
            )}
          >
            <PlusCircle className="w-3.5 h-3.5 shrink-0" />
            Add image
          </button>
          <button
            type="button"
            onClick={insertMention}
            disabled={addVideoDisabled}
            title={addVideoHint}
            className={cn(
              "flex items-center gap-2 bg-panel-soft border border-white/10 rounded-xl px-3 py-2 text-xs transition-colors",
              addVideoDisabled
                ? "opacity-50 cursor-not-allowed text-muted-foreground"
                : "text-muted-foreground hover:text-foreground hover:border-white/20"
            )}
          >
            <PlusCircle className="w-3.5 h-3.5 shrink-0" />
            Add video
          </button>
        </div>

        {/* Vertical divider */}
        <div className="w-px bg-white/8 shrink-0" />

        {/* Center: prompt + dropdown chip row */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Multi-slot summary — only shown when the workflow has 2+
              image slots, since the single-slot case is self-evident
              from the chip below. Each slot row shows whether it's
              filled (the i-th image chip binds to the i-th slot). */}
          {imageSlots.length >= 2 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              <span className="text-[10px] text-muted-foreground self-center">
                Needs:
              </span>
              {imageSlots.map((slot, i) => {
                const imageChips = composerReferencedAssets.filter((ref) => {
                  const asset = assets.find((a) => a.id === ref.id);
                  return asset?.type === "image";
                });
                const filled = !!imageChips[i];
                const slotLabel =
                  slot.role === "init"
                    ? "Init"
                    : slot.role === "mask"
                      ? "Mask"
                      : slot.role === "reference"
                        ? "Reference"
                        : slot.label;
                return (
                  <span
                    key={slot.nodeId}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border",
                      filled
                        ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
                        : slot.required
                          ? "bg-warning/10 border-warning/30 text-warning"
                          : "bg-panel-soft border-white/10 text-muted-foreground"
                    )}
                    title={
                      filled
                        ? `${slotLabel} — ${imageChips[i].name}`
                        : slot.required
                          ? `${slotLabel} (required) — attach an image`
                          : `${slotLabel} (optional)`
                    }
                  >
                    {slotLabel}
                    {slot.required && !filled ? "*" : ""}
                  </span>
                );
              })}
              {requiredImageSlots.length > 0 && (
                <span className="text-[10px] text-muted-foreground self-center">
                  · attach in order with @
                </span>
              )}
            </div>
          )}

          {/* Referenced assets chip strip */}
          {composerReferencedAssets.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {composerReferencedAssets.map((ref) => (
                <span
                  key={ref.id}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-foreground"
                >
                  <span className="text-primary">@</span>
                  <span className="truncate max-w-[160px]">{ref.name}</span>
                  <button
                    type="button"
                    onClick={() => removeReferencedAsset(ref.id)}
                    aria-label={`Remove reference to ${ref.name}`}
                    className="p-0.5 rounded hover:bg-primary/20 hover:text-foreground text-muted-foreground transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Popover.Root
            open={!!mention}
            onOpenChange={(open) => {
              if (!open) setMention(null);
            }}
          >
            <div className="relative flex-1">
              <Popover.Anchor asChild>
                <textarea
                  ref={textareaRef}
                  value={composerInput}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleSelectionChange}
                  onClick={handleSelectionChange}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="Describe what you want to create... use @ to reference assets"
                  className="w-full h-full min-h-[60px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none leading-relaxed pr-7"
                />
              </Popover.Anchor>
              <button
                type="button"
                aria-label="Expand prompt"
                className="absolute top-0 right-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <Popover.Portal>
              <Popover.Content
                side="top"
                align="start"
                sideOffset={12}
                onOpenAutoFocus={(e) => e.preventDefault()}
                className="w-80 bg-panel-elevated border border-white/10 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50"
              >
                <div className="px-3 py-2 border-b border-white/8 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Reference asset {mention?.query ? `· ${mention.query}` : ""}
                </div>
                <AssetMentionList
                  assets={assets}
                  query={mention?.query ?? ""}
                  highlightedIndex={highlighted}
                  onHighlightChange={setHighlighted}
                  onSelect={handleSelect}
                  acceptTypes={mentionAcceptTypes}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* Dropdown chip row */}
          <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-white/8">
            {CONTROLS.map((control) => (
              <label key={control.id} className="relative">
                <select className="appearance-none bg-panel-soft border border-white/10 hover:border-white/20 rounded-lg pl-2.5 pr-6 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-primary/50 cursor-pointer transition-colors">
                  {control.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {control.id === "aspectRatio" ? opt : `${control.label.split(":")[0]}: ${opt}`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </label>
            ))}
            <button
              type="button"
              aria-label="Advanced settings"
              className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-soft transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Vertical divider */}
        <div className="w-px bg-white/8 shrink-0" />

        {/* Right: generate / stop button */}
        {currentRunId ? (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            aria-label="Stop run"
            title={
              cancelling
                ? "Cancelling..."
                : "Stop this run. Stages already completed remain in the gallery."
            }
            className={cn(
              "shrink-0 bg-danger/15 border border-danger/40 text-danger font-semibold rounded-xl px-6 min-w-[148px] flex flex-col items-center justify-center gap-0.5 transition-all duration-200",
              "hover:bg-danger/25 hover:scale-[1.02] active:scale-[0.98]",
              "disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            )}
          >
            {cancelling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Cancelling...</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-sm">
                  Stop
                  <Square className="w-3 h-3 fill-current" />
                </span>
                {stageProgress && stageProgress.total > 0 ? (
                  <span className="text-[10px] font-normal opacity-80">
                    Stage {Math.min(stageProgress.completed + 1, stageProgress.total)} of{" "}
                    {stageProgress.total}
                    {stageProgress.label ? ` — ${stageProgress.label}` : ""}
                  </span>
                ) : (
                  <span className="text-[10px] font-normal opacity-80">running...</span>
                )}
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !activeWorkflow}
            className={cn(
              "shrink-0 brand-gradient text-white font-semibold rounded-xl px-6 min-w-[148px] flex flex-col items-center justify-center gap-0.5 transition-all duration-200",
              "hover:shadow-[0_0_30px_rgba(255,122,69,0.45)] hover:scale-[1.02] active:scale-[0.98]",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Starting...</span>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-sm">
                Generate
                <Sparkles className="w-3.5 h-3.5" />
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
