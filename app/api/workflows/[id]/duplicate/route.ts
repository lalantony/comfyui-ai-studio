import { NextRequest, NextResponse } from "next/server";
import { duplicateWorkflow } from "@/lib/server/workflowService";
import { errorToResponse } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Duplicate a workflow as a fresh draft (new id, "(copy)" appended to name,
 * version reset to 1.0, changelog cleared). Returns the new workflow so the
 * client can navigate to it.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const workflow = await duplicateWorkflow(id);
    return NextResponse.json({ workflow });
  } catch (err) {
    return errorToResponse(err);
  }
}
