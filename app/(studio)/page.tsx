"use client";

import { GlassPanel } from "@/components/shared/GlassPanel";
import { GradientButton } from "@/components/shared/GradientButton";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Project, Workflow } from "@/types";
import {
  Image as ImageIcon,
  Video,
  Music,
  Folder,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [pRes, wRes] = await Promise.all([
          fetch("/api/projects"),
          fetch("/api/workflows"),
        ]);
        if (pRes.ok) {
          const { projects } = (await pRes.json()) as { projects: Project[] };
          setProjects(projects);
        }
        if (wRes.ok) {
          const { workflows } = (await wRes.json()) as { workflows: Workflow[] };
          setWorkflows(workflows);
        }
      } catch {
        /* surface via empty states below */
      }
    })();
  }, []);

  const firstProjectHref = projects[0] ? `/projects/${projects[0].id}` : "/projects";

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl brand-gradient p-8">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-2">What do you want to create?</h1>
          <p className="text-white/70 text-sm mb-6">Choose a workflow to start generating AI assets</p>

          <div className="flex flex-wrap gap-3">
            <Link href={firstProjectHref}>
              <GradientButton size="lg" icon={<ImageIcon className="w-4 h-4" />} className="!bg-white/20 !backdrop-blur-sm border border-white/30 hover:!bg-white/30">
                Image
              </GradientButton>
            </Link>
            <Link href={firstProjectHref}>
              <GradientButton size="lg" icon={<Video className="w-4 h-4" />} className="!bg-white/20 !backdrop-blur-sm border border-white/30 hover:!bg-white/30">
                Video
              </GradientButton>
            </Link>
            <Link href={firstProjectHref}>
              <GradientButton size="lg" icon={<Music className="w-4 h-4" />} className="!bg-white/20 !backdrop-blur-sm border border-white/30 hover:!bg-white/30">
                Music
              </GradientButton>
            </Link>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent-orange/20 rounded-full blur-3xl" />
      </div>

      {/* Quick Start */}
      <div>
        <SectionHeader
          title="Quick Start Workflows"
          action={
            <Link href="/workflows" className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          }
        />
        {workflows.length === 0 ? (
          <GlassPanel className="p-6 text-center text-xs text-muted-foreground">
            No workflows yet —{" "}
            <Link href="/workflows" className="text-primary hover:underline">
              create one
            </Link>{" "}
            to get started.
          </GlassPanel>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {workflows.slice(0, 4).map((workflow) => (
              <Link key={workflow.id} href={`/workflows/${workflow.id}`}>
                <GlassPanel className="p-4 hover:border-white/15 transition-all cursor-pointer group h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-panel-elevated flex items-center justify-center">
                      {workflow.type === "image" && <ImageIcon className="w-5 h-5 text-accent-blue" />}
                      {workflow.type === "video" && <Video className="w-5 h-5 text-accent-pink" />}
                      {workflow.type === "music" && <Music className="w-5 h-5 text-accent-yellow" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground">v{workflow.version}</span>
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">{workflow.name}</h3>
                  <p className="text-[11px] text-muted-foreground mb-3">{workflow.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">{workflow.nodeCount} nodes</span>
                    <span className="text-[10px] text-muted-foreground">{workflow.averageTime}</span>
                  </div>
                </GlassPanel>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Projects */}
      <div>
        <SectionHeader
          title="Recent Projects"
          action={
            <Link href="/projects" className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          }
        />
        {projects.length === 0 ? (
          <GlassPanel className="p-6 text-center text-xs text-muted-foreground">
            No projects yet —{" "}
            <Link href="/projects" className="text-primary hover:underline">
              create one
            </Link>{" "}
            to start a creative session.
          </GlassPanel>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.slice(0, 6).map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <GlassPanel className="p-4 hover:border-white/15 transition-all cursor-pointer group">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-panel-elevated flex items-center justify-center shrink-0">
                      <Folder className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground truncate">{project.name}</h3>
                      <p className="text-[11px] text-muted-foreground mb-2 line-clamp-1">{project.description}</p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{project.assetCount} assets</span>
                        <span>{project.workflowCount} workflows</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/8 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Updated {project.updatedAt}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </GlassPanel>
              </Link>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
