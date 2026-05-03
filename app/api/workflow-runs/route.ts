import { NextRequest, NextResponse } from "next/server";
import { startRun } from "@/lib/server/workflow/runtime";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";
import { assertSafeId } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  workflowId?: string;
  projectId?: string | null;
  mode?: "test" | "project";
  inputs?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<Body>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.workflowId) return jsonError("workflowId is required", 400);
    assertSafeId(body.workflowId);
    if (body.mode !== "test" && body.mode !== "project") {
      return jsonError('mode must be "test" or "project"', 400);
    }
    if (body.mode === "project" && !body.projectId) {
      return jsonError("projectId is required for project mode", 400);
    }
    if (body.projectId) assertSafeId(body.projectId);
    const { runId } = await startRun({
      workflowId: body.workflowId,
      projectId: body.mode === "test" ? null : (body.projectId ?? null),
      mode: body.mode,
      inputs: body.inputs ?? {},
    });
    return NextResponse.json({ runId }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
