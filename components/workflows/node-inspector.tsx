"use client";

import { useWorkflowStore } from "@/stores/useWorkflowStore";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, GitBranch } from "lucide-react";

type InspectorTab = "settings" | "versions";

export function NodeInspector() {
  const inspectorTab = useWorkflowStore((s) => s.inspectorTab);
  const setInspectorTab = useWorkflowStore((s) => s.setInspectorTab);
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);

  return (
    <div className="w-80 shrink-0 flex flex-col gap-4">
      <Tabs
        value={inspectorTab}
        onValueChange={(v) => setInspectorTab(v as InspectorTab)}
        className="w-full"
      >
        <TabsList className="w-full bg-panel-soft border border-white/8 p-1 rounded-xl">
          <TabsTrigger
            value="settings"
            className="flex-1 text-xs rounded-lg data-[state=active]:bg-panel-elevated data-[state=active]:text-foreground"
          >
            <Info className="w-3.5 h-3.5 mr-1.5" />
            Workflow
          </TabsTrigger>
          <TabsTrigger
            value="versions"
            className="flex-1 text-xs rounded-lg data-[state=active]:bg-panel-elevated data-[state=active]:text-foreground"
          >
            <GitBranch className="w-3.5 h-3.5 mr-1.5" />
            Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4 space-y-4">
          {activeWorkflow ? (
            <>
              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Workflow</h3>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Name</label>
                    <p className="text-xs text-foreground">{activeWorkflow.name}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Description</label>
                    <p className="text-xs text-foreground">
                      {activeWorkflow.description || <span className="text-muted-foreground italic">No description</span>}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Tags</label>
                    <div className="flex flex-wrap gap-1">
                      {activeWorkflow.tags.length > 0 ? (
                        activeWorkflow.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-panel-soft text-muted-foreground border border-white/8"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">None</span>
                      )}
                    </div>
                  </div>
                </div>
              </GlassPanel>

              <GlassPanel className="p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Info</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">ID</span>
                    <span className="text-foreground font-mono text-[10px] truncate ml-2">{activeWorkflow.id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Version</span>
                    <span className="text-foreground">v{activeWorkflow.version}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="text-foreground capitalize">{activeWorkflow.status}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className="text-foreground capitalize">{activeWorkflow.type}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Nodes</span>
                    <span className="text-foreground">{activeWorkflow.nodeCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Updated</span>
                    <span className="text-foreground">{activeWorkflow.updatedAt}</span>
                  </div>
                </div>
              </GlassPanel>
            </>
          ) : (
            <GlassPanel className="p-4 text-center text-xs text-muted-foreground">
              No workflow loaded.
            </GlassPanel>
          )}
        </TabsContent>

        <TabsContent value="versions" className="mt-4 space-y-4">
          <GlassPanel className="p-4 text-center text-xs text-muted-foreground">
            Version history will appear here once we wire workflow snapshotting.
          </GlassPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
