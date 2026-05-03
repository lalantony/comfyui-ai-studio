/**
 * Upload allowlist + size cap for project asset uploads.
 *
 * The registry below is the single contract for which file types the
 * studio accepts. It's used in three places:
 *   1. Server: `POST /api/projects/[id]/assets` validates before writing.
 *   2. Client: `AddAssetDialog` pre-validates so the user gets instant
 *      feedback (no need to wait for the round-trip).
 *   3. Client: the file-picker `accept` attribute is derived from this
 *      registry so the OS dialog hides files that wouldn't be accepted.
 *
 * **Adding a new type / format (for contributors)**:
 *   - To allow a new MIME for an existing type (e.g. add `image/heic`),
 *     append it to that type's `mimes` array.
 *   - To allow a new extension, append to `extensions` (extensions are
 *     a fallback when the browser reports an empty/wrong `file.type`).
 *   - To add an entirely new type, you also need to widen `Asset["type"]`
 *     in `types/index.ts` and update any UI that switches on the union.
 *
 * **Per-install size overrides**:
 *   Set `STUDIO_UPLOAD_MAX_IMAGE_MB` / `STUDIO_UPLOAD_MAX_VIDEO_MB` /
 *   `STUDIO_UPLOAD_MAX_MUSIC_MB` to override the defaults per
 *   environment without forking the registry. Read at request time so
 *   tests can stub via `vi.stubEnv`.
 *
 * **What's intentionally NOT supported**:
 *   - Generic file uploads. Anything that doesn't match a registered type
 *     is rejected with a clear reason. The previous behaviour silently
 *     promoted unknown MIMEs to `Asset["type"] = "file"`, which made the
 *     gallery messy and left the door open to executable uploads.
 *
 * No `server-only` import — this module is loaded by both the API route
 * (server-side validation) and the AddAssetDialog (client-side
 * pre-validation + accept-string).
 */
import type { Asset } from "@/types";

const MB = 1024 * 1024;

export interface AssetTypePolicy {
  /** The studio-side asset bucket this policy maps to. */
  type: Extract<Asset["type"], "image" | "video" | "music">;
  /** Browser-reported MIME types accepted for this bucket. */
  mimes: readonly string[];
  /** File extensions (no dot, lowercase) accepted as a fallback. */
  extensions: readonly string[];
  /** Default size cap; per-install override via env (see module header). */
  defaultMaxBytes: number;
}

export const ASSET_TYPE_REGISTRY: readonly AssetTypePolicy[] = [
  {
    type: "image",
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"],
    extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
    defaultMaxBytes: 25 * MB,
  },
  {
    type: "video",
    mimes: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"],
    extensions: ["mp4", "webm", "mov", "mkv"],
    defaultMaxBytes: 500 * MB,
  },
  {
    type: "music",
    mimes: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/aac"],
    extensions: ["wav", "mp3", "ogg", "flac", "aac", "m4a"],
    defaultMaxBytes: 100 * MB,
  },
];

const ENV_VAR_BY_TYPE: Record<AssetTypePolicy["type"], string> = {
  image: "STUDIO_UPLOAD_MAX_IMAGE_MB",
  video: "STUDIO_UPLOAD_MAX_VIDEO_MB",
  music: "STUDIO_UPLOAD_MAX_MUSIC_MB",
};

/**
 * Resolve the effective per-type byte cap, honouring env overrides.
 * Returns the policy's default if the env var is unset or invalid.
 */
export function getMaxBytes(type: AssetTypePolicy["type"]): number {
  const policy = ASSET_TYPE_REGISTRY.find((p) => p.type === type);
  if (!policy) return 0;
  const envName = ENV_VAR_BY_TYPE[type];
  const raw = typeof process !== "undefined" ? process.env[envName] : undefined;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * MB);
  }
  return policy.defaultMaxBytes;
}

/**
 * The minimal File-shape the validator needs. `File` from the DOM lib and
 * the `File` polyfill that Next.js exposes from `formData` both satisfy
 * this — accepting the structural shape lets us call this from tests
 * without instantiating a real `File`.
 */
export interface UploadCandidate {
  name: string;
  size: number;
  type: string;
}

export type UploadValidation =
  | { ok: true; type: AssetTypePolicy["type"] }
  | { ok: false; reason: string };

/**
 * Validate an upload against the registry. Tries MIME first; falls back to
 * extension when the browser doesn't report a usable MIME (some platforms
 * upload PNGs as `application/octet-stream`).
 */
export function validateUpload(file: UploadCandidate): UploadValidation {
  if (file.size === 0) {
    return { ok: false, reason: "File is empty." };
  }

  let policy = ASSET_TYPE_REGISTRY.find((p) => p.mimes.includes(file.type));
  if (!policy) {
    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : "";
    if (ext) {
      policy = ASSET_TYPE_REGISTRY.find((p) => p.extensions.includes(ext));
    }
  }

  if (!policy) {
    const allowed = ASSET_TYPE_REGISTRY.map((p) => p.type).join(", ");
    return {
      ok: false,
      reason: `File type not allowed${file.type ? ` (${file.type})` : ""}. Allowed: ${allowed}.`,
    };
  }

  const maxBytes = getMaxBytes(policy.type);
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `File too large (${formatBytes(file.size)}). Max for ${policy.type} is ${formatBytes(maxBytes)}.`,
    };
  }

  return { ok: true, type: policy.type };
}

/**
 * Build a comma-separated string for the HTML `accept` attribute. We
 * include both MIME types (modern browsers) and dotted extensions
 * (older browsers + some weird platforms) so the OS file dialog filters
 * down to types we'll actually accept.
 */
export function getAcceptString(): string {
  const parts: string[] = [];
  for (const p of ASSET_TYPE_REGISTRY) {
    parts.push(...p.mimes);
    for (const ext of p.extensions) parts.push(`.${ext}`);
  }
  return parts.join(",");
}

/** Friendly byte-size formatter used in error messages. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / 1024 / MB).toFixed(2)} GB`;
}
