/**
 * Asset service — CRUD for `Asset` records under a project.
 *
 * Storage model (current):
 *   - Sidecar (always present): `<projectDir>/assets/<assetId>.json`
 *     The sidecar is the source of truth for everything *about* an asset:
 *     type, name, favourite flag, provenance (source/workflowRunId/prompt/
 *     copiedFrom), mock fallback URLs, and — for content-bearing assets —
 *     a SHA-256 `contentHash` pointing into the blob pool.
 *   - Binary (optional, content-addressable):
 *     `<dataDir>/blobs/<sha256>.<ext>` — see `blobStore.ts`. One copy per
 *     unique content; multiple sidecars (across one or many projects) can
 *     reference the same blob via its hash.
 *
 * Backwards compatibility:
 *   - Older sidecars predate `contentHash` and instead store `filename:
 *     "<assetId>.<ext>"` referring to a per-project binary at
 *     `<projectDir>/assets/<filename>`. These continue to work — reads
 *     fall through to the legacy path; writes always go through the blob
 *     pool. There is no eager migration.
 *   - Mock-seeded assets have `filename: null`, `contentHash: null`, and
 *     `mockUrl: "https://..."`. The `/file` endpoint 307-redirects.
 *
 * Provenance fields tell the UI where this asset came from:
 *   - `source: "upload"`   — user upload
 *   - `source: "workflow"` — promoted by SaveOutput from a project run
 *   - `source: "copy"`     — cross-project copy via `copyAsset`
 *   - `source: "mock"`     — seeded demo content
 */
import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Asset } from "@/types";
import {
  assertSafeId,
  ensureDir,
  getAssetsDir,
  getAssetSidecarPath,
  pathExists,
  readJson,
  writeJson,
} from "./storage";
import { acquireBlob, getBlobBuffer, putBlob, releaseBlob } from "./blobStore";

export interface AssetSidecar {
  id: string;
  projectId: string;
  type: Asset["type"];
  name: string;
  /**
   * Legacy: per-project binary at `<projectDir>/assets/<filename>`.
   * New assets leave this null and use `contentHash` instead. Kept for
   * backwards compat with sidecars that predate the blob pool.
   */
  filename: string | null;
  /**
   * SHA-256 hex digest pointing into the blob pool at
   * `<dataDir>/blobs/<contentHash>.<extension>`. Set by `createAsset` for
   * every new asset. Null for legacy and mock-seeded entries.
   */
  contentHash?: string | null;
  /**
   * Original file extension (lowercase, no leading dot, alphanumeric).
   * Used to locate the blob and infer MIME without re-reading the binary.
   * Optional for back-compat with legacy sidecars (extension is on `filename`).
   */
  extension?: string | null;
  dimensions: string | null;
  duration: string | null;
  createdAt: string;
  isFavorite: boolean;
  source: "upload" | "workflow" | "mock" | "copy";
  workflowRunId: string | null;
  /**
   * Workflow node id that produced this asset. Set for assets auto-saved by
   * intermediate stages of a multi-stage chain (`source: "workflow"` only).
   * Lets the UI group "stage 1 / stage 2 / final" outputs from the same run.
   */
  producedByNodeId?: string | null;
  prompt: string | null;
  /** Fallback URL used when no binary is on disk (seeded from mock data). */
  mockUrl: string | null;
  mockThumbnailUrl: string | null;
  /** When this asset was copied from another project, points to the origin. */
  copiedFrom?: { projectId: string; assetId: string } | null;
}

/** True if the asset has on-disk content (either via blob pool or legacy filename). */
function hasLocalBinary(sidecar: AssetSidecar): boolean {
  return !!sidecar.contentHash || !!sidecar.filename;
}

export class AssetNotFoundError extends Error {
  constructor(projectId: string, assetId: string) {
    super(`Asset not found: ${projectId}/${assetId}`);
    this.name = "AssetNotFoundError";
  }
}

function sidecarToAsset(sidecar: AssetSidecar): Asset {
  const fileEndpoint = `/api/projects/${sidecar.projectId}/assets/${sidecar.id}/file`;
  const hasBinary = hasLocalBinary(sidecar);
  const url = hasBinary ? fileEndpoint : sidecar.mockUrl ?? fileEndpoint;
  // Thumbnails point at the same endpoint as `url`. Resizing happens through
  // next/image at the call site (which adds its own `?w=…&q=…` params).
  // Next.js 16 rejects local image URLs that already carry a query string
  // unless `images.localPatterns` is configured — keeping the source URL
  // clean avoids that footgun entirely.
  const thumbnail = hasBinary
    ? fileEndpoint
    : sidecar.mockThumbnailUrl ?? sidecar.mockUrl ?? undefined;
  return {
    id: sidecar.id,
    projectId: sidecar.projectId,
    type: sidecar.type,
    name: sidecar.name,
    url,
    thumbnail: thumbnail ?? undefined,
    dimensions: sidecar.dimensions ?? undefined,
    duration: sidecar.duration ?? undefined,
    createdAt: sidecar.createdAt,
    workflowId: sidecar.workflowRunId ?? undefined,
    isFavorite: sidecar.isFavorite,
  };
}

export async function listAssets(projectId: string): Promise<Asset[]> {
  assertSafeId(projectId);
  const dir = getAssetsDir(projectId);
  await ensureDir(dir);
  const entries = await fs.readdir(dir);
  const sidecars = await Promise.all(
    entries
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          return await readJson<AssetSidecar>(path.join(dir, f));
        } catch {
          return null;
        }
      })
  );
  return sidecars
    .filter((s): s is AssetSidecar => s !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(sidecarToAsset);
}

export async function getAssetSidecar(
  projectId: string,
  assetId: string
): Promise<AssetSidecar | null> {
  assertSafeId(projectId);
  assertSafeId(assetId);
  const sidecarPath = getAssetSidecarPath(projectId, assetId);
  if (!(await pathExists(sidecarPath))) return null;
  return readJson<AssetSidecar>(sidecarPath);
}

export async function getAsset(projectId: string, assetId: string): Promise<Asset | null> {
  const sidecar = await getAssetSidecar(projectId, assetId);
  return sidecar ? sidecarToAsset(sidecar) : null;
}

export async function getAssetBinary(
  projectId: string,
  assetId: string
): Promise<{ buffer: Buffer; mime: string; filename: string } | null> {
  const sidecar = await getAssetSidecar(projectId, assetId);
  if (!sidecar) return null;

  // New path: content-addressable blob pool.
  if (sidecar.contentHash) {
    const blob = await getBlobBuffer(sidecar.contentHash);
    if (!blob) return null;
    return {
      buffer: blob.buffer,
      mime: mimeFromExt(sidecar.extension ?? blob.ext),
      filename: sidecar.name,
    };
  }

  // Legacy path: per-project binary. Validate `sidecar.filename` is a
  // leaf basename — defence-in-depth against a crafted sidecar
  // ("filename": "../../etc/passwd") even though sidecars are server-
  // written today. If a future code path ever lets user input land here,
  // this guard stops the traversal cold.
  if (sidecar.filename) {
    if (!isSafeLeafName(sidecar.filename)) return null;
    const filePath = path.join(getAssetsDir(projectId), sidecar.filename);
    if (!(await pathExists(filePath))) return null;
    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      mime: mimeFromFilename(sidecar.filename),
      filename: sidecar.name,
    };
  }

  return null;
}

/**
 * Whether `name` is a safe leaf basename: alphanumeric/underscore/dash/dot
 * only, no path separators, no `..`. Used to validate sidecar filenames
 * before joining into a filesystem path.
 */
function isSafeLeafName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("..")) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

export interface CreateAssetInput {
  type: Asset["type"];
  name: string;
  content: Buffer;
  extension: string;
  source: AssetSidecar["source"];
  dimensions?: string;
  duration?: string;
  workflowRunId?: string;
  producedByNodeId?: string;
  prompt?: string;
}

export async function createAsset(
  projectId: string,
  input: CreateAssetInput
): Promise<Asset> {
  assertSafeId(projectId);
  const id = `asset-${randomUUID()}`;
  const ext = input.extension.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) {
    throw new Error(`Invalid extension: ${input.extension}`);
  }

  // Hash the content + write to the blob pool. If an identical blob already
  // exists (re-uploaded same file, deterministic workflow output, etc.),
  // putBlob just bumps the refcount and skips the write.
  const { hash, ext: storedExt } = await putBlob(input.content, ext);
  // putBlob has bumped the refcount; from here on, ANY failure must
  // releaseBlob to undo the increment, otherwise we leak a refcount with
  // no sidecar referencing the blob (the blob can never be GC'd).
  try {
    await ensureDir(getAssetsDir(projectId));

    const sidecar: AssetSidecar = {
      id,
      projectId,
      type: input.type,
      name: input.name,
      filename: null,             // binary lives in the blob pool now
      contentHash: hash,
      extension: storedExt,
      dimensions: input.dimensions ?? null,
      duration: input.duration ?? null,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      source: input.source,
      workflowRunId: input.workflowRunId ?? null,
      producedByNodeId: input.producedByNodeId ?? null,
      prompt: input.prompt ?? null,
      mockUrl: null,
      mockThumbnailUrl: null,
    };
    await writeJson(getAssetSidecarPath(projectId, id), sidecar);
    return sidecarToAsset(sidecar);
  } catch (err) {
    // Compensate: undo the putBlob refcount increment so the blob doesn't
    // get pinned in the pool with no sidecar referencing it.
    await releaseBlob(hash).catch(() => {
      /* swallow — the original error is the one the caller cares about */
    });
    throw err;
  }
}

/**
 * Rename an existing asset in place. Touches only the sidecar's `name` —
 * the blob, hash, refcount, provenance, and createdAt are unchanged.
 *
 * Multi-stage chain use-case: a downstream SaveOutput receives an AssetRef
 * from an upstream ComfyUI node (which already auto-saved). Rather than
 * duplicating the asset, SaveOutput just renames it via this helper.
 */
export async function renameAsset(
  projectId: string,
  assetId: string,
  newName: string
): Promise<Asset> {
  const sidecar = await getAssetSidecar(projectId, assetId);
  if (!sidecar) throw new AssetNotFoundError(projectId, assetId);
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("Asset name cannot be empty");
  if (trimmed === sidecar.name) return sidecarToAsset(sidecar);
  const updated: AssetSidecar = { ...sidecar, name: trimmed };
  await writeJson(getAssetSidecarPath(projectId, assetId), updated);
  return sidecarToAsset(updated);
}

export async function copyAsset(
  targetProjectId: string,
  source: { projectId: string; assetId: string }
): Promise<Asset> {
  assertSafeId(targetProjectId);
  const sourceSidecar = await getAssetSidecar(source.projectId, source.assetId);
  if (!sourceSidecar) throw new AssetNotFoundError(source.projectId, source.assetId);

  const newId = `asset-${randomUUID()}`;
  await ensureDir(getAssetsDir(targetProjectId));

  const newContentHash: string | null = sourceSidecar.contentHash ?? null;
  const newExtension: string | null = sourceSidecar.extension ?? null;
  let newFilename: string | null = null;

  if (newContentHash) {
    // Content-addressable copy: zero bytes copied — just bump the refcount
    // so the blob isn't garbage-collected when one of the references is deleted.
    await acquireBlob(newContentHash);
  } else if (sourceSidecar.filename) {
    // Legacy source: copy the per-project binary. Keep the legacy layout
    // for the new asset rather than uplifting on copy — uplift on touch.
    const ext = sourceSidecar.filename.split(".").pop()!;
    newFilename = `${newId}.${ext}`;
    const sourcePath = path.join(getAssetsDir(source.projectId), sourceSidecar.filename);
    const destPath = path.join(getAssetsDir(targetProjectId), newFilename);
    if (await pathExists(sourcePath)) {
      await fs.copyFile(sourcePath, destPath);
    } else {
      // Source binary missing — fall back to sidecar-only copy
      newFilename = null;
    }
  }

  const newSidecar: AssetSidecar = {
    ...sourceSidecar,
    id: newId,
    projectId: targetProjectId,
    filename: newFilename,
    contentHash: newContentHash,
    extension: newExtension,
    createdAt: new Date().toISOString(),
    isFavorite: false,
    copiedFrom: { projectId: source.projectId, assetId: source.assetId },
    // For mock-seeded sources, preserve the mockUrl so the copy still renders
    source: sourceSidecar.source === "mock" ? "mock" : "copy",
  };
  await writeJson(getAssetSidecarPath(targetProjectId, newId), newSidecar);
  return sidecarToAsset(newSidecar);
}

export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  const sidecar = await getAssetSidecar(projectId, assetId);
  if (!sidecar) throw new AssetNotFoundError(projectId, assetId);

  // Release the blob's refcount. If this was the last reference, the blob
  // pool deletes the binary. If it was a legacy asset with no contentHash,
  // remove the per-project binary directly.
  if (sidecar.contentHash) {
    await releaseBlob(sidecar.contentHash);
  } else if (sidecar.filename) {
    const filePath = path.join(getAssetsDir(projectId), sidecar.filename);
    await fs.rm(filePath, { force: true });
  }

  await fs.rm(getAssetSidecarPath(projectId, assetId), { force: true });
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  json: "application/json",
};

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function mimeFromExt(ext: string | null | undefined): string {
  if (!ext) return "application/octet-stream";
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}
