# Upload policy

The studio refuses asset uploads that don't match a registered type +
extension and exceed a per-type byte cap. The single source of truth is
[`lib/uploadPolicy.ts`](../lib/uploadPolicy.ts). This document is the
contributor-facing summary.

## Defaults

| Type    | MIME types                                                                  | Extensions                   | Default cap |
| ------- | --------------------------------------------------------------------------- | ---------------------------- | ----------- |
| `image` | `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`          | `png` `jpg` `jpeg` `webp` `gif` `avif` | **25 MB** |
| `video` | `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`            | `mp4` `webm` `mov` `mkv`     | **500 MB**  |
| `music` | `audio/wav`, `audio/x-wav`, `audio/mpeg`, `audio/ogg`, `audio/flac`, `audio/aac` | `wav` `mp3` `ogg` `flac` `aac` `m4a` | **100 MB** |

Anything outside this matrix is rejected with HTTP 413 and a clear error
in the upload dialog.

## Per-install size override

You can raise (or lower) the cap per environment without forking the
registry by setting one of:

```bash
STUDIO_UPLOAD_MAX_IMAGE_MB=50
STUDIO_UPLOAD_MAX_VIDEO_MB=2000
STUDIO_UPLOAD_MAX_MUSIC_MB=200
```

Values are read at request time, so a restart is enough to pick them up.

## Adding a new MIME or extension

For an existing type — just append to the relevant arrays in
`ASSET_TYPE_REGISTRY`:

```ts
{
  type: "image",
  mimes: [...existing, "image/heic"],
  extensions: [...existing, "heic"],
  defaultMaxBytes: 25 * MB,
}
```

The validator checks MIME first; extension is the fallback when the
browser doesn't supply a usable MIME. Add both unless you specifically
want to require one.

## Adding a whole new type

Three steps:

1. **Widen the union** in `types/index.ts`:
   ```ts
   export interface Asset {
     type: "image" | "video" | "music" | "file" | "model3d";  // ← here
     ...
   }
   ```

2. **Add a registry entry** in `lib/uploadPolicy.ts`:
   ```ts
   {
     type: "model3d",
     mimes: ["model/gltf-binary", "model/gltf+json"],
     extensions: ["glb", "gltf"],
     defaultMaxBytes: 200 * MB,
   }
   ```

3. **Update UI switches** that branch on `Asset["type"]`. The TypeScript
   compiler will flag every non-exhaustive `switch`; follow the errors.

If you also need a new size-override env var, add it to `ENV_VAR_BY_TYPE`
in the same file.

## What's intentionally NOT supported

- **Generic file uploads.** The previous behaviour silently promoted
  unknown MIMEs to `Asset["type"] = "file"`, which left the door open
  to executable / archive / documents / anything-else uploads. The
  current policy rejects unknown types — a contributor wanting to
  re-enable generic uploads should add an explicit `file` entry to the
  registry rather than fall through to a default.
- **Magic-byte verification.** We trust the browser-supplied MIME and
  extension. A determined uploader can rename `evil.exe` to
  `evil.png`. Out of scope for v1; the studio is a single-user tool
  with `.studio-data/` living on the user's own machine. Hosted /
  multi-user deployments should add a magic-byte check on top of this
  policy.

## Tests

`lib/uploadPolicy.test.ts` covers MIME + extension matching, env
overrides, oversized files, empty files, and registry shape. When
adding a type or MIME, add a happy-path row.
