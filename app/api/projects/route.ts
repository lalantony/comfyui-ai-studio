import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/server/projectService";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";
import { assertSafeId } from "@/lib/server/storage";
import { Project } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (err) {
    return errorToResponse(err);
  }
}

interface CreateProjectBody {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<CreateProjectBody>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.name || typeof body.name !== "string") {
      return jsonError("name is required", 400);
    }
    const id = body.id ?? `project-${slugify(body.name)}-${Date.now().toString(36)}`;
    // Validate at the boundary — defence in depth before the storage
    // helpers see the id. Catches user-supplied ids with case mismatch
    // or path-traversal characters before they hit the FS layer.
    assertSafeId(id);
    const project = await createProject({
      id,
      name: body.name,
      description: body.description ?? "",
      tags: body.tags ?? [],
      thumbnail: body.thumbnail,
    } as Omit<Project, "createdAt" | "updatedAt" | "assetCount" | "workflowCount">);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
