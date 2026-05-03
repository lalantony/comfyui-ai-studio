import { NextRequest, NextResponse } from "next/server";
import { createAsset, listAssets } from "@/lib/server/assetService";
import { recountProject } from "@/lib/server/projectService";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";
import { validateUpload } from "@/lib/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const assets = await listAssets(id);
    return NextResponse.json({ assets });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: projectId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError("file is required (multipart/form-data field 'file')", 400);
    }

    // Validate against the upload policy *before* reading the bytes —
    // saves bandwidth + memory when the user drops a 4 GB ISO into the
    // dialog. The MIME + size are on the FormData entry already.
    const filename = file.name || "upload";
    const validation = validateUpload({
      name: filename,
      size: file.size,
      type: file.type,
    });
    if (!validation.ok) {
      return jsonError(validation.reason, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = filename.includes(".") ? filename.split(".").pop()! : "bin";

    const asset = await createAsset(projectId, {
      type: validation.type,
      name: filename,
      content: buffer,
      extension: ext,
      source: "upload",
    });
    await recountProject(projectId);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
