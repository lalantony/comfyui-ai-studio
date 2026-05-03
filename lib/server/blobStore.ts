/**
 * Content-addressable blob pool — `STUDIO_DATA_DIR/blobs/<sha256>.<ext>`.
 *
 * Asset binaries are stored exactly once per unique content. Each blob has
 * a sibling JSON `<sha256>.json` carrying refcount + metadata. Sidecars in
 * projects reference blobs by their hash; multiple sidecars (across one or
 * many projects) can reference the same blob.
 *
 * Garbage collection is reference-counted:
 *   - `putBlob(buffer, ext)`     → write blob if absent + refCount++
 *   - `acquireBlob(hash)`        → refCount++ (used by cross-project copy)
 *   - `releaseBlob(hash)`        → refCount--; if 0, delete blob + meta
 *
 * Why content-addressable, not just size+name dedup:
 *   - Robust to renames and metadata changes
 *   - Free cross-project copy (just bump refcount, no I/O)
 *   - Trivial integrity check (can re-hash to verify)
 *   - Simple GC: refCount === 0 → delete
 *
 * Caveats:
 *   - Single-process design. Two studio instances pointed at the same
 *     STUDIO_DATA_DIR will race on the refcount file. Atomic writes protect
 *     against torn reads, but interleaved increments can still under-count.
 *     Documented limitation — multi-instance is out of scope for v1.
 *   - SHA-256 collision is the integrity boundary. The realistic collision
 *     rate is so far below disk-bit-flip that this is effectively never.
 */
import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import {
  assertSafeHash,
  ensureDir,
  getBlobMetaPath,
  getBlobPath,
  getBlobsDir,
  pathExists,
  readJson,
  writeJsonAtomic,
} from "./storage";

interface BlobMeta {
  hash: string;
  ext: string;
  size: number;
  createdAt: string;
  refCount: number;
}

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Sanitize an extension to lowercase alphanumeric, max 16 chars. Falls back to "bin". */
function normalizeExt(ext: string): string {
  return ext.replace(/^\./, "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16) || "bin";
}

async function readMeta(hash: string): Promise<BlobMeta | null> {
  try {
    return await readJson<BlobMeta>(getBlobMetaPath(hash));
  } catch {
    return null;
  }
}

async function writeMeta(meta: BlobMeta): Promise<void> {
  await writeJsonAtomic(getBlobMetaPath(meta.hash), meta);
}

/**
 * Per-hash async mutex.
 *
 * Without this, two concurrent `createAsset` calls for the same content
 * both run `readMeta` (sees refCount=N), both `writeMeta(N+1)` — net
 * increment is 1 instead of 2, breaking the refcount invariant. Same race
 * applies between `acquireBlob` and `releaseBlob` racing to zero, where
 * the loser can delete a blob that's still referenced.
 *
 * Single-process design (out-of-scope for v1: multi-instance Studio
 * pointing at the same STUDIO_DATA_DIR — that needs OS-level file
 * locking). Within one Node process, chaining tail-promises per hash
 * serializes readMeta → writeMeta windows.
 */
const hashLocks = new Map<string, Promise<unknown>>();

function withHashLock<T>(hash: string, fn: () => Promise<T>): Promise<T> {
  const prev = hashLocks.get(hash) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Cleanup chain: drop the entry once the chain settles so the map
  // doesn't grow unbounded under high churn. We keep the cleanup-promise
  // (not `next` itself) in the map so the *next* caller chains off the
  // settled state. Crucially, we suppress the chain's rejection with
  // `.catch(() => {})` so a fn that throws doesn't leave an unhandled
  // rejection on this side-promise — the original `next` still rejects
  // for the caller, that's the contract.
  const cleanup = next
    .finally(() => {
      if (hashLocks.get(hash) === cleanup) hashLocks.delete(hash);
    })
    .catch(() => {
      /* the original next rejection is observable to the caller */
    });
  hashLocks.set(hash, cleanup);
  return next;
}

/**
 * Store `buffer` in the blob pool and bump its refcount by one.
 *
 * - If a blob with the same hash already exists, the on-disk binary is
 *   left untouched (we trust the existing copy) and only the refcount is
 *   incremented.
 * - If the blob is new, the binary is written first, then the meta file.
 *   A crash between these two steps leaves an orphan binary the next
 *   `putBlob` call will overwrite — acceptable, never lost data.
 *
 * Returns the hash + sanitised extension; the caller stores these on the
 * asset sidecar for later retrieval.
 */
export async function putBlob(
  buffer: Buffer,
  ext: string
): Promise<{ hash: string; ext: string }> {
  await ensureDir(getBlobsDir());
  const hash = sha256Hex(buffer);
  const safeExt = normalizeExt(ext);
  return withHashLock(hash, async () => {
    const blobPath = getBlobPath(hash, safeExt);
    const existing = await readMeta(hash);
    if (existing) {
      // Already in the pool — guard the binary (defensive: someone deleted
      // it manually) and bump the refcount.
      if (!(await pathExists(blobPath))) {
        await fs.writeFile(blobPath, buffer);
      }
      await writeMeta({ ...existing, refCount: existing.refCount + 1 });
      return { hash, ext: existing.ext };
    }

    // New blob — write binary first, then meta.
    await fs.writeFile(blobPath, buffer);
    await writeMeta({
      hash,
      ext: safeExt,
      size: buffer.length,
      createdAt: new Date().toISOString(),
      refCount: 1,
    });
    return { hash, ext: safeExt };
  });
}

/**
 * Bump the refcount on an existing blob without re-reading bytes.
 * Used by cross-project asset copy — caller already has the hash and
 * just needs to record a new reference.
 */
export async function acquireBlob(hash: string): Promise<void> {
  assertSafeHash(hash);
  return withHashLock(hash, async () => {
    const meta = await readMeta(hash);
    if (!meta) {
      throw new Error(`acquireBlob: no blob with hash ${hash}`);
    }
    await writeMeta({ ...meta, refCount: meta.refCount + 1 });
  });
}

/**
 * Decrement a blob's refcount. When it hits zero, delete both the binary
 * and the meta file.
 *
 * Idempotent in the "blob is already gone" case — releasing an unknown
 * hash is a no-op (logged) rather than a throw, so callers can release
 * unconditionally during cleanup paths.
 */
export async function releaseBlob(hash: string): Promise<void> {
  assertSafeHash(hash);
  return withHashLock(hash, async () => {
    const meta = await readMeta(hash);
    if (!meta) {
      // Already released or never existed — log and continue.
      console.warn(`[blobStore] releaseBlob: no meta for ${hash}, skipping`);
      return;
    }
    const next = meta.refCount - 1;
    if (next > 0) {
      await writeMeta({ ...meta, refCount: next });
      return;
    }
    // refCount hit zero → garbage collect.
    await Promise.all([
      fs.rm(getBlobPath(hash, meta.ext), { force: true }),
      fs.rm(getBlobMetaPath(hash), { force: true }),
    ]);
  });
}

/** Read a blob's bytes by hash. Returns null if the blob isn't in the pool. */
export async function getBlobBuffer(hash: string): Promise<{ buffer: Buffer; ext: string } | null> {
  assertSafeHash(hash);
  const meta = await readMeta(hash);
  if (!meta) return null;
  try {
    const buffer = await fs.readFile(getBlobPath(hash, meta.ext));
    return { buffer, ext: meta.ext };
  } catch {
    return null;
  }
}

/** Whether a blob exists in the pool. Cheaper than reading the bytes. */
export async function blobExists(hash: string): Promise<boolean> {
  assertSafeHash(hash);
  return (await readMeta(hash)) !== null;
}
