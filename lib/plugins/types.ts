/**
 * Node plugin types — the contract every node in the studio implements.
 *
 * A "plugin" is the unit of node extension: it bundles the metadata
 * (`NodeManifest`), the optional server executor, and the optional client
 * React component. Built-in plugins live under `plugins/builtin/<name>/`.
 *
 * The three pieces are deliberately separated so we can keep server-only
 * and client-only concerns from cross-contaminating Next.js bundles:
 *
 *   - `manifest.ts`  — pure data, no React, no `server-only`. Importable from
 *                      both client and server. Source of truth for identity,
 *                      handles, defaults, validators, and sanitization.
 *   - `executor.ts`  — `import "server-only";` at top. Runs in Node at
 *                      execution time. Optional (omitted for inert nodes
 *                      like Note).
 *   - `Component.tsx`— `"use client";` at top. Renders on the canvas.
 *
 * Three registries consume these:
 *   - `lib/plugins/manifestRegistry.ts`         — shared
 *   - `lib/server/plugins/executorRegistry.ts`  — server-only
 *   - `components/workflows/nodeComponents.ts`  — client-only
 *
 * Bootstraps populate the registries at module-load time.
 */

import type { ComponentType } from "react";
import type { NodeProps as ReactFlowNodeProps } from "@xyflow/react";

// ----- Shared primitive types -----

/**
 * Discriminator for a node type. Used everywhere as the lookup key.
 * Structurally a string — the registry IS the source of truth for which
 * kinds exist; we don't maintain a separate closed union.
 */
export type NodeKind = string;

export type NodeCategory = "source" | "ai" | "processing" | "comfyui" | "utility";

/**
 * Brand accent — drives header, border, and handle colors on the canvas.
 * Maps to the design tokens declared in `app/globals.css` under `@theme`.
 */
export type NodeAccent =
  | "purple"
  | "cyan"
  | "orange"
  | "green"
  | "yellow"
  | "pink"
  | "blue";

/**
 * Type of value flowing through a handle. `any` is the wildcard for cases
 * where the value can be one of several shapes (e.g. condition routing).
 * The runtime uses these to validate connections in the inspector — invalid
 * connections are rejected at edge-creation time, not at run time.
 */
export type HandleType =
  | "text"
  | "number"
  | "boolean"
  | "image"
  | "audio"
  | "video"
  | "json"
  | "any";

export interface HandleDef {
  /** Identifier — used as the React Flow handle id and to route edges. */
  id: string;
  /** Display label shown on hover and in the inspector. */
  label: string;
  /** Type for validation + connection rules. `any` accepts everything. */
  type: HandleType;
  /** Inputs only: fail the run if no value flows in. Outputs always emit. */
  required?: boolean;
  /** UI hint: mark this as a less-common handle (advanced). */
  optional?: boolean;
}

// ----- Node data base shape -----

/**
 * Every node's data extends this. The discriminator field is `kind`.
 * Plugin authors define their own interfaces extending BaseNodeData.
 */
export interface BaseNodeData {
  kind: NodeKind;
  label: string;
}

// ----- The Manifest -----

export interface NodeManifest<D extends BaseNodeData = BaseNodeData> {
  /**
   * Unique discriminator. MUST equal `D["kind"]`. Used as the registry key
   * by all three registries (manifest, executor, component).
   *
   * Conventions:
   *   - camelCase
   *   - matches `^[a-z][a-zA-Z0-9]{2,31}$`
   *   - stable across versions (changing it breaks every saved workflow
   *     using this node)
   */
  kind: D["kind"];

  /** Display name in palette + on the canvas node header. */
  displayName: string;

  /** One-line description for the palette + tooltip. Be concrete. */
  description: string;

  /** Palette section the node appears under. */
  category: NodeCategory;

  /**
   * Brand accent. Apply `border-accent-<color>/40` and similar token classes
   * in your Component to honor it.
   */
  accent: NodeAccent;

  /**
   * Lucide icon name (string, not the imported component). Resolved at
   * render time via `lib/plugins/icons.ts`. Keeping this as a string makes
   * manifests serializable, which matters for the workflow import/export
   * format and future runtime-loaded plugins.
   */
  icon: string;

  /**
   * Static handle definitions. Most nodes have a fixed set. Dynamic-handle
   * nodes (e.g. ComfyUI which derives its inputs from the chosen endpoint
   * at runtime) declare their *base* handles here and the Component renders
   * the dynamic ones at render time. The runtime is permissive — any
   * upstream value addressed by a handle id is accepted.
   */
  inputs: HandleDef[];
  outputs: HandleDef[];

  /**
   * Factory for new instances dropped onto the canvas. Pure — must not
   * read globals or call hooks. The shape returned must satisfy `D`.
   */
  defaultData: () => D;

  /**
   * Optional shape validator. Returns `null` if `data` is valid, otherwise
   * an array of human-readable errors. The runtime calls this before
   * executing; the inspector can surface errors inline.
   *
   * Default behavior (no validator): trust the discriminated union typing.
   */
  validateData?: (data: unknown) => string[] | null;

  /**
   * Sanitize the node's data for export. Strip API keys, local references,
   * anything else that shouldn't travel in a shared workflow bundle.
   * Returns the data with sensitive fields removed/nulled.
   *
   * Default behavior (no hook): return the data unchanged. Plugins with
   * sensitive fields MUST implement this.
   *
   * @example
   *   sanitizeForExport: (data) => ({ ...data, apiKey: undefined })
   */
  sanitizeForExport?: (data: D) => D;

  /**
   * Whether the node has a server-side executor. Inert nodes (Note) are
   * `false` and the runtime skips them. When `true`, the executor MUST be
   * registered alongside the manifest.
   */
  executable: boolean;

  /** Mark a plugin as not yet stable. Surfaces a badge in the palette. */
  experimental?: boolean;

  /**
   * Mark a plugin as deprecated. Hidden from the palette by default, but
   * existing workflows using it still load + run. Provide migration guidance.
   */
  deprecated?: { reason: string; replacedBy?: NodeKind };

  /** Optional link to extended documentation (cookbook recipe, etc.). */
  documentationUrl?: string;
}

// ----- Server-side plugin shape -----

/**
 * Forward declaration of the executor type — defined in
 * `lib/server/plugins/executorRegistry.ts` to keep server-only types out
 * of this shared module. Plugin executors implement `NodeExecutor<D>`.
 */
export interface NodeExecutorContract<D extends BaseNodeData> {
  execute(
    ctx: {
      runId: string;
      projectId: string | null;
      workflowId: string;
      mode: "test" | "project";
      abortSignal: AbortSignal;
      outputsDir: string;
      emit: (event: import("@/types").RunEvent) => Promise<void>;
    },
    inputs: Record<string, unknown>,
    data: D
  ): Promise<Record<string, unknown>>;
}

// ----- Client-side props shape -----

/**
 * Props every node Component receives from the canvas.
 *
 * Mirrors React Flow's `NodeProps` but typed against our `BaseNodeData`
 * subtype. Plugin authors get full type safety inside their Component
 * by parameterising over their own data interface:
 *
 * @example
 *   export function TextInputNode({ id, data, selected }: NodeProps<TextInputData>) {
 *     // `data` is typed as TextInputData here
 *   }
 */
export type NodeProps<D extends BaseNodeData> = ReactFlowNodeProps & {
  data: D;
};

/**
 * Component shape — what each plugin's `Component.tsx` default-exports
 * after being wrapped with `memo()`.
 */
export type NodeComponent<D extends BaseNodeData = BaseNodeData> = ComponentType<
  NodeProps<D>
>;
