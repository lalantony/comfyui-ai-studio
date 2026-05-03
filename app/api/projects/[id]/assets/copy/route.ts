import { NextRequest, NextResponse } from "next/server";
import { copyAsset } from "@/lib/server/assetService";
import { recountProject } from "@/lib/server/projectService";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";
import { assertSafeId } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface CopyBody {
  sourceProjectId?: string;
  sourceAssetId?: string;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: targetProjectId } = await ctx.params;
    const parsed = await readJsonBody<CopyBody>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.sourceProjectId || !body.sourceAssetId) {
      return jsonError("sourceProjectId and sourceAssetId are required", 400);
    }
    // Boundary validation — body-supplied ids must pass the same safety
    // check as URL-derived ones before flowing into the storage layer.
    assertSafeId(body.sourceProjectId);
    assertSafeId(body.sourceAssetId);
    if (body.sourceProjectId === targetProjectId) {
      return jsonError("Source and target project must differ", 400);
    }
    const asset = await copyAsset(targetProjectId, {
      projectId: body.sourceProjectId,
      assetId: body.sourceAssetId,
    });
    await recountProject(targetProjectId);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
