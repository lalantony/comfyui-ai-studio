import { NextRequest, NextResponse } from "next/server";
import { AssetNotFoundError, deleteAsset, getAsset } from "@/lib/server/assetService";
import { recountProject } from "@/lib/server/projectService";
import { errorToResponse } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; assetId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id, assetId } = await ctx.params;
    const asset = await getAsset(id, assetId);
    if (!asset) throw new AssetNotFoundError(id, assetId);
    return NextResponse.json({ asset });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id, assetId } = await ctx.params;
    await deleteAsset(id, assetId);
    await recountProject(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
