import { NextRequest, NextResponse } from "next/server";
import { findRunLocation, readRunFromDisk } from "@/lib/server/workflow/runStore";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const loc = await findRunLocation(id);
    if (!loc) return jsonError("Run not found", 404);
    const run = await readRunFromDisk(loc.projectId, id);
    if (!run) return jsonError("Run not found", 404);
    return NextResponse.json({ run });
  } catch (err) {
    return errorToResponse(err);
  }
}
