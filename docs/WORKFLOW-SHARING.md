# Sharing Workflows

ComfyUI AI Studio workflows are portable. You can export any workflow as a small `.studio-workflow.json` file, share it with others (Discord, GitHub, blog post, the future community gallery), and they can import it into their own studio with one click.

This guide covers the export/import flow, what's stripped for security, and tips for sharing publicly.

---

## Export

In the workflow editor, click **Export** in the header. Your browser downloads a file like `my-workflow-v1.0.studio-workflow.json`.

The file is plain JSON — open it in any editor, diff it in git, paste it on a forum.

### What gets stripped

A bundle is **safe to share publicly**. Before bundling, every node's data is run through its plugin's `sanitizeForExport` hook + a regex safety net. The following fields are always removed:

| Field | Why |
|---|---|
| LLM `apiKey` | Critical — never leak API keys in shared bundles |
| ComfyUI `endpointId` | Endpoint IDs are local to your studio; the importer re-binds |
| Image Input `testAssetRef` | Asset IDs are local to your studio |
| Any field matching `apiKey`, `secret`, `accessToken`, `password` | Belt-and-braces safety net |
| Workflow `id`, `createdAt`, `updatedAt`, status, counts | Importer assigns fresh values |

If you wrote a custom node plugin and its data has sensitive fields, **make sure your manifest's `sanitizeForExport` hook strips them**. The regex safety net catches obvious cases but isn't a substitute. See [`docs/PLUGIN-API.md`](./PLUGIN-API.md#nodemanifest).

### What stays

- Workflow name, description, version, tags
- All canvas nodes + edges + node positions
- All non-sensitive node data (prompts, templates, predicates, settings)
- Required plugin list (so the importer can warn about missing plugins)
- Optional human-readable `notes` field — write this for the recipient

---

## Import

`Workflows → Import` (top right of the workflows list page). Pick the file. The dialog previews the workflow before commit:

- **Workflow info**: name, description, node count, version
- **Plugin status**:
  - ✓ "All required plugins are available locally" — clear path
  - ⚠ "Missing plugins: [list]" — workflow will load but those nodes won't function until you install the plugins
- **Re-bind reminder**: "N nodes need re-binding (ComfyUI endpoints / LLM API keys)" — expected for any workflow that uses generation

Confirm and you're redirected to the new workflow's editor. The workflow is saved as a new `draft` — your local copy never overwrites the source bundle.

### After import

- Open any **ComfyUI nodes** and pick an endpoint from your own ComfyUI environment.
- Open any **LLM nodes** and paste your own API key.
- Run **Test Run** to verify it works end-to-end.

---

## Bundle format

```json
{
  "$schema": "https://comfyui-ai-studio.dev/schema/workflow-bundle/v1.json",
  "bundleVersion": 1,
  "exportedAt": "2026-05-02T12:00:00Z",
  "exportedFromStudio": "1.0.0",
  "workflow": {
    "name": "Z-Image Edit Pipeline",
    "description": "...",
    "type": "image",
    "version": "v1.0",
    "tags": ["sdxl", "edit"],
    "nodes": [/* sanitized */],
    "edges": [/* unchanged */]
  },
  "requiredPlugins": ["textInput", "llm", "comfyui", "saveOutput"],
  "notes": "Requires a Z-Image Turbo endpoint. LLM nodes need an OpenAI key."
}
```

Bundle size is capped at 1 MB — workflows are JSON, anything larger is suspicious.

The importer rejects bundles with:
- `bundleVersion` other than `1`
- Missing `workflow.name`, `workflow.nodes`, `workflow.edges`, `requiredPlugins`
- Suspicious keys (`__proto__`, prototype-pollution attempts)
- Per-node validation errors (caught via plugin manifests)

---

## Tips for sharing publicly

### Write `notes`

The bundle has a `notes` field your recipient sees in the import dialog. Use it. Tell them:
- Which ComfyUI endpoint to use (model + version)
- What inputs the workflow expects (e.g. "needs a portrait reference image")
- Any quality tradeoffs ("draft mode is configured for speed; bump steps for production")

### Pin a version in the workflow

Use the `version` field on the workflow itself. When you ship v1.1 of a workflow, your community can keep both versions side-by-side after re-importing.

### Use semantic node names

The `label` on each node is preserved in the bundle. A workflow with nodes labelled "User Prompt", "Style Polish (LLM)", "Save Final" is much more shareable than one with "Text Input 1", "LLM 1", "Save Output 1".

### Test the import yourself

Before publishing a bundle:
1. Export your workflow.
2. **Delete it** from your studio (or test on a clean install).
3. Re-import.
4. Verify it loads and runs cleanly after re-binding endpoints + keys.

If anything broke (a ComfyUI node referenced a custom property you forgot to sanitize, etc.), better to find that yourself than after sharing.

### Check for accidentally-committed secrets

Even with the sanitization pipeline, do a manual sanity check on the JSON before posting publicly:

```bash
grep -i "key\|secret\|token\|password" my-workflow-v1.0.studio-workflow.json
```

If the only matches are field *names* with empty/null values, you're good. If anything has actual secret content in it, **don't share** — file an issue and we'll fix the sanitization.

---

## Troubleshooting

### "Bundle is over 1 MB"
The bundle is malformed or massively bloated. Check that no large strings (base64 binaries) snuck into a node's data. Workflows are JSON metadata only — no media should ever be in a bundle.

### "Unsupported bundleVersion"
Your studio is older than the studio that created the bundle. Update.

### "Plugin 'fooBar' isn't installed"
The bundle uses a plugin you don't have. The workflow will still import; those nodes just render with a fallback and fail at run time. Install the plugin or adapt the workflow.

### Imported workflow runs differently than the source
- Different ComfyUI version on either side
- Different model versions in the active environment
- Different LLM model picked in the rebound nodes

Workflows are reproducible *given identical infrastructure* — they don't bundle the model weights or ComfyUI version themselves.

---

## Future: workflow gallery

A community-curated workflow gallery is on the roadmap. The current export/import is the foundation: bundles will be the unit of submission, and the gallery will support browsing/filtering/forking workflows from other community members.

When you're ready to publish, the bundle format you produce today will work without modification.
