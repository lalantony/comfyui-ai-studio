/**
 * Static catalog of composer-side image controls.
 *
 * These are project-composer concerns (aspect ratio dropdown, style preset,
 * etc.) — not node-level. Lives outside the plugin system because they're
 * coupled to the composer UI, not to the workflow runtime.
 */
import type { ComposerControl } from "@/types";

export const imageComposerControls: ComposerControl[] = [
  { id: "aspectRatio", label: "Aspect Ratio", type: "select", options: ["1:1", "16:9", "9:16", "4:5", "3:2", "2:3"], value: "1:1" },
  { id: "style", label: "Style", type: "select", options: ["Cinematic", "Realistic", "Anime", "Product", "Abstract", "Portrait"], value: "Cinematic" },
  { id: "quality", label: "Quality", type: "select", options: ["Draft", "High", "Ultra"], value: "High" },
  { id: "seed", label: "Seed", type: "select", options: ["Random", "Fixed"], value: "Random" },
];
