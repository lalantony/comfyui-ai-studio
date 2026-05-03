import { NextRequest, NextResponse } from "next/server";
import {
  WorkflowNotFoundError,
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
} from "@/lib/server/workflowService";
import { errorToResponse, readJsonBody } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const workflow = await getWorkflow(id);
    if (!workflow) throw new WorkflowNotFoundError(id);
    return NextResponse.json({ workflow });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const workflow = await updateWorkflow(id, parsed.body as Parameters<typeof updateWorkflow>[1]);
    return NextResponse.json({ workflow });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteWorkflow(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
