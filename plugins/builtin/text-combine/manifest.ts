/**
 * Text Combine — mustache-lite template that interpolates upstream values.
 *
 * The template string contains `{name}` tokens; each becomes an input handle
 * the user can wire upstream values into. Output is the rendered string.
 *
 * Manifest declares zero static inputs because handles are derived from
 * the template at render time. The Component renders Handles dynamically.
 */
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

export interface TextCombineData extends BaseNodeData {
  kind: "textCombine";
  /** Mustache-lite: `{handleName}` is replaced by upstream value of that handle. */
  template: string;
}

export const manifest: NodeManifest<TextCombineData> = {
  kind: "textCombine",
  displayName: "Text Combine",
  description: "Combine multiple text inputs via a {token} template.",
  category: "processing",
  accent: "purple",
  icon: "Combine",
  inputs: [],
  outputs: [{ id: "output", label: "result", type: "text" }],
  defaultData: () => ({
    kind: "textCombine",
    label: "Text Combine",
    template: "{prompt}, {style}",
  }),
  executable: true,
};
