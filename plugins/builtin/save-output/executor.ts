/**
 * Save Output executor — promotes upstream value to a project asset
 * (project mode) or to a test-run outputs file (test mode).
 *
 * Accepts the following upstream shapes, in priority order:
 *   1. `{ assetId, projectId }` (AssetRef) — upstream already saved (e.g.
 *      a ComfyUI node in project mode). Rename the existing asset to the
 *      configured filename (if any) instead of duplicating it.
 *   2. plain `string` — saved as `text/plain` with `.txt` extension
 *   3. `{ bytes: Buffer, mime?, name?, type? }` — pre-fetched binary
 *   4. `{ url: string, type?, name? }` — fetched via http(s) or data: URL
 *   5. anything else — JSON-stringified and saved as `.json`
 *
 * Project mode side effects:
 *   - `createAsset()` (writes blob + sidecar; existing blob increments refcount)
 *   - `recountProject()` (refreshes the project's cached `assetCount`)
 *   - For AssetRef: `renameAsset()` (sidecar-only update, no duplicate)
 *
 * Test mode side effects:
 *   - Writes the binary to `ctx.outputsDir` with a sanitized filename.
 *   - Returns `{ savedFile: TestRunOutputFile }` for the runtime to attach
 *     to the `run.completed` event.
 */
import "server-only";

import path from "node:path";
import fs from "node:fs/promises";
import type { Asset, TestRunOutputFile } from "@/types";
import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import { createAsset, getAssetBinary, renameAsset } from "@/lib/server/assetService";
import { recountProject } from "@/lib/server/projectService";
import { ensureDir } from "@/lib/server/storage";
import type { SaveOutputData } from "./manifest";

interface AssetRefValue {
  assetId: string;
  projectId: string;
  name?: string;
  type?: Asset["type"];
}

function isAssetRef(value: unknown): value is AssetRefValue {
  return (
    !!value &&
    typeof value === "object" &&
    "assetId" in value &&
    "projectId" in value &&
    typeof (value as AssetRefValue).assetId === "string" &&
    typeof (value as AssetRefValue).projectId === "string"
  );
}

export const executor: NodeExecutor<SaveOutputData> = {
  async execute(ctx, inputs, data) {
    const incoming = inputs.image ?? inputs.input ?? Object.values(inputs)[0];
    if (incoming === null || incoming === undefined) return { savedAssetId: null };

    const baseFilename = data.filename || `output-${Date.now()}`;
    const isTest = ctx.projectId === null;
    const isAutoFilename = !data.filename || data.filename === "auto";

    // ---------- 1. AssetRef — upstream already saved, just rename in place
    // (avoids the duplicate gallery entry that re-saving would produce).
    if (isAssetRef(incoming)) {
      // Test mode: AssetRef means "an asset somewhere in some project" —
      // we still need to materialise it into the test outputs dir.
      if (isTest) {
        const bin = await getAssetBinary(incoming.projectId, incoming.assetId);
        if (!bin) return { savedAssetId: null };
        const finalName = isAutoFilename
          ? bin.filename
          : `${baseFilename}.${extensionFromMime(bin.mime)}`;
        return persist(ctx, isTest, bin.buffer, bin.mime, finalName, incoming.type ?? "file");
      }

      // Project mode, cross-project AssetRef: fall through to read+createAsset
      // so it lands in the *active* project, not the source project.
      if (incoming.projectId !== ctx.projectId) {
        const bin = await getAssetBinary(incoming.projectId, incoming.assetId);
        if (!bin) return { savedAssetId: null };
        const finalName = isAutoFilename
          ? bin.filename
          : `${baseFilename}.${extensionFromMime(bin.mime)}`;
        return persist(ctx, isTest, bin.buffer, bin.mime, finalName, incoming.type ?? "file");
      }

      // Same-project AssetRef (the common multi-stage chain case): rename
      // if the user supplied a custom filename, otherwise leave as-is.
      // Either way, surface the assetId so the run aggregator records it.
      //
      // Extension fallback: prefer ref.name's extension; if absent, fall
      // back to the AssetRef's mime hint (the upstream ComfyUI executor
      // attaches `mime` to its output). Without this fallback, an
      // upstream that omits `name` would leave the renamed asset with no
      // extension at all — breaking gallery type detection.
      let asset: Asset | null = null;
      if (!isAutoFilename) {
        const refName = (incoming as AssetRefValue & { mime?: string }).name;
        const refMime = (incoming as AssetRefValue & { mime?: string }).mime;
        const extFromName = (refName?.split(".").pop() ?? "").toLowerCase();
        const extFromMime = refMime ? extensionFromMime(refMime) : "";
        const ext =
          extFromName && /^[a-z0-9]{1,8}$/.test(extFromName)
            ? extFromName
            : extFromMime || "";
        const finalName = ext ? `${baseFilename}.${ext}` : baseFilename;
        try {
          asset = await renameAsset(ctx.projectId!, incoming.assetId, finalName);
        } catch {
          // If the asset vanished mid-run, nothing useful we can do.
          return { savedAssetId: null };
        }
      }
      return { savedAssetId: incoming.assetId, asset: asset ?? undefined };
    }

    // ---------- 2. plain string → text/plain
    if (typeof incoming === "string") {
      const buf = Buffer.from(incoming, "utf8");
      return persist(ctx, isTest, buf, "text/plain", `${baseFilename}.txt`, "file");
    }

    // ---------- 3. pre-fetched binary { bytes, mime, name?, type? }
    if (
      typeof incoming === "object" &&
      incoming !== null &&
      "bytes" in incoming &&
      Buffer.isBuffer((incoming as { bytes: unknown }).bytes)
    ) {
      const ref = incoming as { bytes: Buffer; mime?: string; name?: string; type?: Asset["type"] };
      const mime = ref.mime ?? "application/octet-stream";
      const ext = extensionFromMime(mime);
      const finalName = ref.name ?? `${baseFilename}.${ext}`;
      return persist(ctx, isTest, ref.bytes, mime, finalName, ref.type ?? "file");
    }

    // ---------- 4. fetchable url { url, type?, name? }
    if (typeof incoming === "object" && incoming !== null && "url" in incoming) {
      const ref = incoming as { url: string; type?: Asset["type"]; name?: string };
      const fetched = await fetchBytes(ref.url);
      if (!fetched) return { savedAssetId: null };
      const finalName = ref.name ?? `${baseFilename}.${fetched.extension}`;
      return persist(ctx, isTest, fetched.buffer, fetched.mime, finalName, ref.type ?? "file");
    }

    // ---------- 5. unknown → JSON
    const json = JSON.stringify(incoming, null, 2);
    return persist(ctx, isTest, Buffer.from(json, "utf8"), "application/json", `${baseFilename}.json`, "file");
  },
};

async function persist(
  ctx: { projectId: string | null; runId: string; nodeId: string; outputsDir: string },
  isTest: boolean,
  buffer: Buffer,
  mime: string,
  filename: string,
  type: Asset["type"]
): Promise<Record<string, unknown>> {
  if (isTest) {
    await ensureDir(ctx.outputsDir);
    const safeFilename = sanitizeFilename(filename);
    await fs.writeFile(path.join(ctx.outputsDir, safeFilename), buffer);
    const file: TestRunOutputFile = {
      filename: safeFilename,
      name: filename,
      type,
      mime,
    };
    return { savedFile: file, savedAssetId: null };
  }

  const projectId = ctx.projectId!;
  const ext = extensionFromMime(mime);
  const asset = await createAsset(projectId, {
    type,
    name: filename,
    content: buffer,
    extension: ext,
    source: "workflow",
    workflowRunId: ctx.runId,
    producedByNodeId: ctx.nodeId,
  });
  // recountProject is a cache refresh, not a correctness operation —
  // failure here (e.g. concurrent project edit) leaves assetCount stale
  // until the next listAssets, but the asset itself is on disk. Don't
  // fail the run on a stale cache.
  try {
    await recountProject(projectId);
  } catch {
    /* swallow; cache will self-heal */
  }
  return { savedAssetId: asset.id, asset };
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : `output-${Date.now()}`;
}

interface FetchedBytes {
  buffer: Buffer;
  extension: string;
  mime: string;
}

async function fetchBytes(url: string): Promise<FetchedBytes | null> {
  try {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) return null;
      const mime = match[1];
      const buffer = Buffer.from(match[2], "base64");
      return { buffer, extension: extensionFromMime(mime), mime };
    }
    if (!/^https?:\/\//i.test(url)) {
      return null;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    return { buffer, extension: extensionFromMime(mime), mime };
  } catch {
    return null;
  }
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "text/plain": "txt",
    "application/json": "json",
  };
  return map[m] ?? "bin";
}
