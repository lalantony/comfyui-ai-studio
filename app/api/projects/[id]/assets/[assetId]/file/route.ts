import { NextRequest, NextResponse } from "next/server";
import { getAssetBinary, getAssetSidecar } from "@/lib/server/assetService";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; assetId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id, assetId } = await ctx.params;
    const binary = await getAssetBinary(id, assetId);
    if (binary) {
      return new NextResponse(new Uint8Array(binary.buffer), {
        status: 200,
        headers: {
          "Content-Type": binary.mime,
          "Content-Length": String(binary.buffer.byteLength),
          // No-cache so a renameAsset (sidecar updated, same id) is
          // immediately reflected. The blob bytes themselves are content-
          // addressed and effectively immutable, but consumers fetch
          // through the asset id which is mutable metadata.
          "Cache-Control": "private, no-cache",
          "Content-Disposition": `inline; filename="${encodeURIComponent(binary.filename)}"`,
        },
      });
    }
    const sidecar = await getAssetSidecar(id, assetId);
    if (sidecar?.mockUrl) {
      // Validate the mockUrl scheme before redirecting — sidecars are
      // server-written today, but a future code path that lets user
      // input flow into mockUrl could turn this into an open redirect to
      // arbitrary attacker-controlled URLs.
      if (!isSafeMockUrl(sidecar.mockUrl)) {
        return jsonError("Asset has an invalid mock URL", 400);
      }
      return NextResponse.redirect(new URL(sidecar.mockUrl, _req.url), 307);
    }
    return jsonError("Asset binary not found", 404);
  } catch (err) {
    return errorToResponse(err);
  }
}

/**
 * Whether a `mockUrl` is safe to 307-redirect to. Allows http(s) only —
 * blocks `javascript:`, `data:`, `file:`, and any other schemes that
 * could be weaponised in an open-redirect or XSS attack.
 */
function isSafeMockUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
