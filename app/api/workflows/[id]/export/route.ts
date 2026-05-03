import { NextRequest, NextResponse } from "next/server";
import { exportWorkflow } from "@/lib/server/workflowService";
import { errorToResponse } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Build a portable bundle for the workflow and return it as a download.
 * Sensitive fields (API keys, local references) are stripped — see
 * `exportWorkflow()` for the sanitization pipeline.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const bundle = await exportWorkflow(id);

    // Build a friendly filename: <slug>-v<version>.studio-workflow.json
    const slug = bundle.workflow.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    const filename = `${slug || "workflow"}-${bundle.workflow.version}.studio-workflow.json`;

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
