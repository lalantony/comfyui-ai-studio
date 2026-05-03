/**
 * Filesystem layout + path resolution for the studio's local data store.
 *
 * Every server-side module that reads or writes user data goes through the
 * helpers here. The directory under `STUDIO_DATA_DIR` (defaults to
 * `<repo>/.studio-data/`) is the single source of truth; there is no
 * database server. See docs/ARCHITECTURE.md for the full layout.
 *
 * Path-traversal safety lives in `assertSafeId()` — every id parsed from a
 * URL or request body must pass through it before it's joined into a
 * filesystem path. This is the trust boundary between user input and disk.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

// Allows ids like "asset-abc123", "wf-image-gen-v1.2", "ep-cafe1234".
// Must start with an alnum so a leading "." (hidden file) is rejected.
// `..` is rejected explicitly to block path traversal.
// Lowercase-only — case-insensitive filesystems (Windows NTFS, default
// macOS APFS) treat `asset-ABC` and `asset-abc` as the same path, which
// would let a malicious import overwrite an existing asset's sidecar.
// All server-generated ids are already lowercase (randomUUID + b36).
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/**
 * DOS device names reserved across the entire NTFS filesystem regardless
 * of extension. `mkdir con` fails with EINVAL on Windows; `con.txt` is
 * also rejected. Block these IDs at the trust boundary so a Windows user
 * importing a workflow built on macOS/Linux never lands a project that
 * can't be created. Kept lowercase because `ID_PATTERN` already enforces
 * lowercase. (Tilde-superscript variants like `com¹` aren't possible here
 * — the pattern won't admit non-ASCII characters.)
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com0",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt0",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export class InvalidIdError extends Error {
  constructor(id: string) {
    super(`Invalid id: ${JSON.stringify(id)}. Must match ${ID_PATTERN}.`);
    this.name = "InvalidIdError";
  }
}

/**
 * Throw `InvalidIdError` if `id` doesn't match the safe pattern. Call this
 * before joining any user-supplied id into a filesystem path — it's the
 * defence against `../../etc/passwd`-style traversal.
 */
export function assertSafeId(id: string): void {
  if (!ID_PATTERN.test(id) || id.includes("..")) throw new InvalidIdError(id);
  // Reject Windows DOS-device basenames (con / nul / prn / com1 / lpt1 …).
  // These break `mkdir` on NTFS *with or without an extension*, so we
  // check the part of the id before the first dot — `con.json` and `con`
  // both fail in `fs.mkdir("con")`.
  const base = id.split(".", 1)[0];
  if (WINDOWS_RESERVED_NAMES.has(base)) throw new InvalidIdError(id);
}

/**
 * Resolve the studio's data root. Honours `STUDIO_DATA_DIR` (absolute path
 * recommended) or falls back to `<cwd>/.studio-data/` (the default for
 * local dev — gitignored, never committed).
 */
export function getDataDir(): string {
  return process.env.STUDIO_DATA_DIR
    ? path.resolve(process.env.STUDIO_DATA_DIR)
    : path.join(process.cwd(), ".studio-data");
}

export function getProjectsDir(): string {
  return path.join(getDataDir(), "projects");
}

export function getProjectDir(projectId: string): string {
  assertSafeId(projectId);
  return path.join(getProjectsDir(), projectId);
}

export function getProjectFile(projectId: string): string {
  return path.join(getProjectDir(projectId), "project.json");
}

export function getAssetsDir(projectId: string): string {
  return path.join(getProjectDir(projectId), "assets");
}

export function getAssetSidecarPath(projectId: string, assetId: string): string {
  assertSafeId(assetId);
  return path.join(getAssetsDir(projectId), `${assetId}.json`);
}

/**
 * Run storage:
 *   - project runs (mode="project") live under projects/<projectId>/runs/<runId>/...
 *   - test runs    (mode="test")    live under runs/<runId>/...                  (project-independent)
 *
 * Pass `projectId: null` to address a test run.
 */
export function getRunsDir(projectId: string | null): string {
  return projectId === null
    ? path.join(getDataDir(), "runs")
    : path.join(getProjectDir(projectId), "runs");
}

export function getRunDir(projectId: string | null, runId: string): string {
  assertSafeId(runId);
  return path.join(getRunsDir(projectId), runId);
}

export function getRunFile(projectId: string | null, runId: string): string {
  return path.join(getRunDir(projectId, runId), "run.json");
}

export function getRunEventsFile(projectId: string | null, runId: string): string {
  return path.join(getRunDir(projectId, runId), "events.ndjson");
}

export function getRunOutputsDir(projectId: string | null, runId: string): string {
  return path.join(getRunDir(projectId, runId), "outputs");
}

export function getTestRunsDir(): string {
  return path.join(getDataDir(), "runs");
}

// ---- Workflows (Studio canvas DAGs) ----

export function getWorkflowsDir(): string {
  return path.join(getDataDir(), "workflows");
}

export function getWorkflowDir(workflowId: string): string {
  assertSafeId(workflowId);
  return path.join(getWorkflowsDir(), workflowId);
}

export function getWorkflowFile(workflowId: string): string {
  return path.join(getWorkflowDir(workflowId), "workflow.json");
}

// ---- ComfyUI environments and registered endpoints ----

export function getComfyEnvironmentsDir(): string {
  return path.join(getDataDir(), "comfy-environments");
}

export function getComfyEnvironmentDir(envId: string): string {
  assertSafeId(envId);
  return path.join(getComfyEnvironmentsDir(), envId);
}

export function getComfyEnvironmentFile(envId: string): string {
  return path.join(getComfyEnvironmentDir(envId), "env.json");
}

export function getComfyEndpointsDir(envId: string): string {
  return path.join(getComfyEnvironmentDir(envId), "endpoints");
}

export function getComfyEndpointDir(envId: string, endpointId: string): string {
  assertSafeId(endpointId);
  return path.join(getComfyEndpointsDir(envId), endpointId);
}

export function getComfyEndpointFile(envId: string, endpointId: string): string {
  return path.join(getComfyEndpointDir(envId, endpointId), "endpoint.json");
}

export function getComfyEndpointWorkflowApiFile(envId: string, endpointId: string): string {
  return path.join(getComfyEndpointDir(envId, endpointId), "workflow_api.json");
}

// ---- Content-addressable blob pool (asset dedup) ----
//
// Asset binaries are stored once per unique content under `blobs/<sha256>.<ext>`,
// with a sibling `<sha256>.json` carrying the refcount + metadata. Asset
// sidecars in projects reference blobs by their hash. This means identical
// bytes — whether re-uploaded, re-generated by a deterministic workflow, or
// copied across projects — occupy disk space exactly once.

export function getBlobsDir(): string {
  return path.join(getDataDir(), "blobs");
}

/** Validate that a string looks like a SHA-256 hex digest. Mirrors `assertSafeId`'s role for blob hashes. */
export function assertSafeHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new InvalidIdError(hash);
  }
}

export function getBlobPath(hash: string, ext: string): string {
  assertSafeHash(hash);
  // ext is controlled by the asset service (sanitised before reaching here)
  // but we still belt-and-braces strip path separators.
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 16) || "bin";
  return path.join(getBlobsDir(), `${hash}.${safeExt}`);
}

export function getBlobMetaPath(hash: string): string {
  assertSafeHash(hash);
  return path.join(getBlobsDir(), `${hash}.json`);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Write JSON atomically: serialise to a sibling tmp file, then `rename`
 * over the target. `rename` is atomic on POSIX and modern Windows (NTFS),
 * so a crash mid-write leaves either the original intact or the new file
 * cleanly in place — concurrent readers never see torn JSON.
 *
 * Why this is the default (and `writeJsonAtomic` is now an alias): every
 * sidecar / project.json / env.json gets rewritten on every mutation and
 * is concurrently read by listX operations during directory scans. A
 * non-atomic `writeFile` would let a reader catch the file mid-write,
 * see empty/partial JSON, and silently drop the entity from the listing
 * (the catch-and-skip in listAssets does this). Always use atomic writes
 * for JSON metadata.
 */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  // PID + UUID4 in the tmp filename so two simultaneous writes (e.g.,
  // two concurrent createAsset calls bumping the same project's recount)
  // can't collide on the tmp path.
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

/** Alias retained for explicitness at call sites that historically used it. */
export const writeJsonAtomic = writeJson;
