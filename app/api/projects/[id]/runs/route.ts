import { NextRequest, NextResponse } from "next/server";
import { listProjectRuns } from "@/lib/server/runHistoryService";
import { getProject, ProjectNotFoundError } from "@/lib/server/projectService";
import { errorToResponse } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * List the project's runs (newest first). 404s if the project doesn't
 * exist, so the client can render a clean "project deleted" UI rather
 * than an empty list.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: projectId } = await ctx.params;
    const project = await getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const runs = await listProjectRuns(projectId);
    return NextResponse.json({ runs });
  } catch (err) {
    return errorToResponse(err);
  }
}
