/**
 * Manifest validation — runs at registration time. Catches malformed
 * plugins on app boot, not at run time.
 *
 * What gets validated:
 *   - kind matches the conventions (camelCase, sane length)
 *   - displayName + description are non-empty
 *   - category + accent are recognised values
 *   - icon name is a non-empty string (lookup happens later in `getIcon`)
 *   - inputs + outputs have unique handle ids within a node
 *   - inputs marked required don't claim `optional: true` (contradiction)
 *   - executable: true REQUIRES the executor to be registered separately
 *     (this part is checked at executor-registry time, not here)
 */

import type { BaseNodeData, NodeManifest, HandleDef, NodeCategory, NodeAccent } from "./types";

const KIND_PATTERN = /^[a-z][a-zA-Z0-9]{2,31}$/;
const VALID_CATEGORIES: NodeCategory[] = ["source", "ai", "processing", "comfyui", "utility"];
const VALID_ACCENTS: NodeAccent[] = [
  "purple",
  "cyan",
  "orange",
  "green",
  "yellow",
  "pink",
  "blue",
];

/**
 * Validate a manifest. Returns a list of errors (empty array when valid).
 *
 * Designed to be aggressive — better to fail loud at registration than
 * to silently accept a half-formed plugin and discover the problem
 * mid-execution.
 */
export function validateManifest<D extends BaseNodeData>(manifest: NodeManifest<D>): string[] {
  const errors: string[] = [];

  if (!manifest.kind || typeof manifest.kind !== "string") {
    errors.push("kind is required and must be a string");
  } else if (!KIND_PATTERN.test(manifest.kind)) {
    errors.push(
      `kind "${manifest.kind}" does not match pattern ${KIND_PATTERN} (camelCase, 3-32 chars)`
    );
  }

  if (!manifest.displayName?.trim()) {
    errors.push("displayName is required");
  }

  if (!manifest.description?.trim()) {
    errors.push("description is required");
  }

  if (!VALID_CATEGORIES.includes(manifest.category)) {
    errors.push(
      `category "${manifest.category}" is not one of ${VALID_CATEGORIES.join(" | ")}`
    );
  }

  if (!VALID_ACCENTS.includes(manifest.accent)) {
    errors.push(
      `accent "${manifest.accent}" is not one of ${VALID_ACCENTS.join(" | ")}`
    );
  }

  if (!manifest.icon?.trim()) {
    errors.push("icon (string name) is required");
  }

  if (typeof manifest.executable !== "boolean") {
    errors.push("executable must be a boolean");
  }

  if (typeof manifest.defaultData !== "function") {
    errors.push("defaultData must be a factory function");
  }

  errors.push(...validateHandles("inputs", manifest.inputs));
  errors.push(...validateHandles("outputs", manifest.outputs));

  // Cross-checks
  const inputIds = new Set(manifest.inputs?.map((h) => h.id) ?? []);
  const outputIds = new Set(manifest.outputs?.map((h) => h.id) ?? []);
  for (const id of inputIds) {
    if (outputIds.has(id)) {
      errors.push(
        `handle id "${id}" appears as both an input and an output — pick a different name on one side`
      );
    }
  }

  return errors;
}

function validateHandles(side: "inputs" | "outputs", handles: HandleDef[] | undefined): string[] {
  const errors: string[] = [];
  if (!Array.isArray(handles)) {
    errors.push(`${side} must be an array (use [] for none)`);
    return errors;
  }
  const seen = new Set<string>();
  for (const handle of handles) {
    if (!handle.id?.trim()) {
      errors.push(`${side}: handle is missing an id`);
      continue;
    }
    if (seen.has(handle.id)) {
      errors.push(`${side}: duplicate handle id "${handle.id}"`);
    }
    seen.add(handle.id);
    if (!handle.label?.trim()) {
      errors.push(`${side}.${handle.id}: label is required`);
    }
    if (!handle.type) {
      errors.push(`${side}.${handle.id}: type is required`);
    }
    if (handle.required && handle.optional) {
      errors.push(`${side}.${handle.id}: cannot be both required and optional`);
    }
  }
  return errors;
}
