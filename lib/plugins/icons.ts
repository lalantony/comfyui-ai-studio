/**
 * Icon resolution for plugin manifests.
 *
 * Manifests declare icons by string name (e.g. `"Type"`, `"Sparkles"`)
 * rather than by imported component reference. This keeps manifests
 * serializable — important for the workflow bundle format and future
 * runtime-loaded plugins — and lets the icon set be controlled centrally.
 *
 * To add a new icon for plugin authors to use:
 *   1. Import it from `lucide-react` below.
 *   2. Add it to the `ICONS` map.
 *   3. Document it in `docs/PLUGIN-API.md`'s icon list.
 *
 * If you import a hot icon from outside the registry, the rest of the
 * codebase won't know about it (palette will fall back to the placeholder).
 */
"use client";

import {
  Type,
  Image as ImageIcon,
  FileUp,
  Variable,
  Sparkles,
  Combine,
  GitBranch,
  Save,
  Eye,
  StickyNote,
  Boxes,
  Layers,
  Workflow,
  Code,
  Filter,
  Globe,
  Server,
  Music,
  Video,
  FileText,
  Wand2,
  Zap,
  HelpCircle,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

/**
 * Standard Lucide icon component shape. All entries in `ICONS` conform.
 */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/**
 * Canonical map of icon name → component. Plugin authors reference these
 * names from their manifest's `icon` field.
 */
export const ICONS: Record<string, IconComponent> = {
  // Source nodes
  Type,
  Image: ImageIcon,
  FileUp,
  Variable,

  // AI / processing
  Sparkles,
  Combine,
  GitBranch,
  Wand2,
  Zap,

  // ComfyUI / generation
  Boxes,
  Layers,
  Workflow,

  // Utility
  Save,
  Eye,
  StickyNote,
  Code,
  Filter,
  FileText,

  // Connectivity / metadata
  Globe,
  Server,
  Music,
  Video,
};

/**
 * Resolve an icon name to a component. Falls back to a placeholder when
 * the name is unknown — surfaces visibly in the UI without crashing the
 * canvas, useful for older workflows referencing removed plugins.
 */
export function getIcon(name: string): IconComponent {
  return ICONS[name] ?? HelpCircle;
}
