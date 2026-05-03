import { NextRequest, NextResponse } from "next/server";
import {
  ProjectNotFoundError,
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/server/projectService";
import { errorToResponse, readJsonBody } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const project = await getProject(id);
    if (!project) throw new ProjectNotFoundError(id);
    return NextResponse.json({ project });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const project = await updateProject(id, parsed.body as Parameters<typeof updateProject>[1]);
    return NextResponse.json({ project });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
