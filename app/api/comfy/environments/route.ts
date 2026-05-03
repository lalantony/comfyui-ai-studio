import { NextRequest, NextResponse } from "next/server";
import { createEnvironment, listEnvironments } from "@/lib/server/environmentService";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";
import { assertSafeId } from "@/lib/server/storage";
import { ComfyUIEnvironment } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const environments = await listEnvironments();
    return NextResponse.json({ environments });
  } catch (err) {
    return errorToResponse(err);
  }
}

interface CreateBody {
  id?: string;
  name?: string;
  type?: ComfyUIEnvironment["type"];
  baseUrl?: string;
  authMode?: ComfyUIEnvironment["authMode"];
  apiKey?: string;
  isActive?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<CreateBody>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.name) return jsonError("name is required", 400);
    if (!body.type) return jsonError("type is required (local|remote)", 400);
    if (!body.baseUrl) return jsonError("baseUrl is required", 400);
    try {
      new URL(body.baseUrl);
    } catch {
      return jsonError("baseUrl must be a valid URL", 400);
    }
    if (body.id !== undefined) assertSafeId(body.id);
    const env = await createEnvironment({
      id: body.id,
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl,
      authMode: body.authMode,
      apiKey: body.apiKey,
      isActive: body.isActive,
    });
    return NextResponse.json({ environment: env }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
