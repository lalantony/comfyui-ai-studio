/**
 * Note — inert documentation block on the canvas.
 *
 * No handles, no executor. The orchestrator skips notes entirely.
 * Useful for annotating workflows: parameter notes, attribution,
 * "remember to set the model" reminders, etc.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface NoteData extends BaseNodeData {
  kind: "note";
  content: string;
}

export const manifest: NodeManifest<NoteData> = {
  kind: "note",
  displayName: "Note",
  description: "Documentation note. Inert — never executed.",
  category: "utility",
  accent: "yellow",
  icon: "StickyNote",
  inputs: [],
  outputs: [],
  defaultData: () => ({
    kind: "note",
    label: "Note",
    content: "",
  }),
  executable: false,
};
