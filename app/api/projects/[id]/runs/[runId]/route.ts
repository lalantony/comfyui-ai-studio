import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRunDetail,
  RunNotFoundError,
} from "@/lib/server/runHistoryService";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; runId: string }>;
}

/**
 * Run detail for the project-runs UI. Returns the WorkflowRun snapshot
 * plus the full event log so the client can replay the timeline without
 * needing a second SSE roundtrip for terminal runs.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: projectId, runId } = await ctx.params;
    const detail = await getProjectRunDetail(projectId, runId);
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof RunNotFoundError) return jsonError(err.message, 404);
    return errorToResponse(err);
  }
}
