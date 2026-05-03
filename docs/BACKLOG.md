# Backlog

Things we've decided to build (or strongly want to build) but haven't started yet. Lighter-weight than the [README roadmap](../README.md#roadmap-selected) — that's the "headline" public-facing list of strategic features. This is the working tracker between an idea getting a casual mention and a concrete PR.

If you're a contributor looking for somewhere to start, **the items in [Approved](#approved) are the safest bets** — they're scoped and have clear acceptance criteria. Items in [Brainstorming](#brainstorming) are still being shaped; coordinate in an issue before opening a PR.

For long-term/strategic direction, see the [README roadmap](../README.md#roadmap-selected).

---

## Approved

These have a defined scope. Pick one up by opening an issue + PR.

### Run history (per-project tab)

Runs are persisted under `.studio-data/projects/<id>/runs/<runId>/run.json` but invisible in the UI. Surface them as a tab on the project page:

- List with timestamp, workflow name, status, output thumbnail
- Click → expand to show event timeline (replayed from `events.ndjson`)
- "Re-run with same inputs" action

Estimated effort: ~1 day.

### Security hardening — API keys at rest

Currently plaintext in `workflow.json`. Move to OS keychain via `keytar` or AES-GCM with a passphrase prompted on first use.

**Why deferred** — `.studio-data/` is gitignored and lives only on the user's local filesystem (created by `npm run dev`/`start`, never synced to the repo). The plaintext-key blast radius is "anyone with local read access," which matches the user's existing trust boundary. Picks up urgency the moment we add (a) any sync/cloud feature, (b) a Warply-style external token store, or (c) a hosted multi-user mode. Estimated effort: ~½ day.

The other two items from the original architect-review hardening list — SSRF allowlist on ComfyUI `baseUrl` and upload size + MIME validation — were promoted out of the backlog and shipped as part of the post-G15 active sprint.

---

## Brainstorming

Items being shaped. Open an issue to discuss before starting.

### Connection-side reliability — *shipped*

WS one-shot reconnect with prompt-id correlation, HTTP exponential backoff (1s/2s on network + 5xx), and 15s SSE comment-heartbeat all landed in the connection-reliability PR alongside `lib/server/providers/util/withRetry.ts`. Polling fallback continues to be the safety net even if reconnect fails.

### Performance

- **Canvas render granularity** — `useWorkflowStore` subscriptions aren't selector-fine-grained. A `node.progress` event for one node currently re-renders every node + the inspector. `useShallow` + per-node selectors would help.
- **`recountProject` is O(N)** — reads every sidecar individually. Caching with mutation invalidation, or doing it once per session, would help projects with thousands of assets.
- **Video poster pipeline (server-side ffmpeg)** — today video thumbnails use browser-native `<video preload="metadata">` to show the first frame. Costs ~1-2 MB metadata fetch per visible card. For projects with 30+ videos, pre-generate poster JPEGs server-side (ffmpeg → first frame at 256px → store as separate blob, reference via `sidecar.thumbnailHash`). Adds an ffmpeg binary dependency at install/runtime — mitigate by making it optional (gracefully fall back to browser-native if ffmpeg isn't installed).

### UX

- **Keyboard shortcuts** — `design.md` lists `Cmd+S`, `Cmd+Enter`, `Delete`, `Space+drag`. None implemented.
- **Drag-to-reorder asset chips in composer** — order matters for some prompts; right now you can only `X` and re-mention.
- **`@`-mention regex edge cases** — code fences, emails, `@scope/package` references in prompts get incorrectly mention-parsed. Should suspend mention mode in multi-line `\`\`\`` blocks.

### Multi-stage chain — v2 follow-ups

The first cut of multi-stage ComfyUI chaining auto-saves every stage's output as a project asset (and writes test-mode previews to the run's outputs dir), surfaces stage-by-stage previews live, races WS+polling+timeout for completion detection, emits a `run.log` activity feed, and lets the user Stop mid-flight. These extensions build on that:

- ~~**Resume from failed step**~~ — *shipped*. `WorkflowRun` now persists `nodeOutputs` + a `workflowHash`; `POST /api/workflow-runs/[id]/resume` validates state, hash, asset existence, and starts a fresh run with seeded upstream outputs. Run-history tab gets a "Resume" button on failed/cancelled rows.
- **Multi-file ComfyUI output** — `pickOutputFiles` returns the first image only. Some workflows produce N (animation frames, batched generations). Today only the first lands in the gallery. Should auto-save each as a separate asset, all tagged with the same `producedByNodeId` + `workflowRunId` so they stay grouped.
- **Cross-run output cache (deterministic stages)** — if stage 1's prompt + seed + endpoint are unchanged from a prior run, skip re-executing and reuse the existing asset. The blob pool already dedupes content; this would dedupe *work*. Needs a content-hash-of-inputs + a registry mapping hash → existing assetId.
- **Parallel branches** — the topo-sort runtime is sequential; two independent branches off a single source run one-after-the-other instead of in parallel. For an LLM-prompt-rewrite branch + a depth-map branch off the same image, parallelizing would roughly halve wall time. Needs a worker pool keyed off `executor.kind` so e.g. only one ComfyUI call runs at a time but it doesn't block an LLM call.
- **Project-mode stage previews** — the test panel now shows live previews of every stage. The composer (project mode) shows a "Stage N of M" pill but no thumbnails — adding the same multi-card preview list above the composer would parity the two modes. The `node.completed` event already carries `preview`, so the wiring is mostly UI.
- **Run-log filters + level filter UI** — Activity Log shows everything. Add a level toggle (Debug / Info / Warn / Error) and a node-id filter chip strip for chains with many nodes. Cap is already at 500 lines in memory; consider a "load more from disk" if the persisted ndjson exceeds the cap.
- **Per-environment WS keepalive tuning** — heartbeat is 15s/30s pong-or-die today (fixed in `client.ts`). For very flaky networks (corp VPN, mobile tether) shorter intervals would close zombie sockets faster. Make these configurable per-environment alongside `runTimeoutSec`.

### Audit-uncovered remaining items (post-G1–G15)

The G1–G15 production-hardening pass cleared most of the audit findings. What's left is real but lower-priority:

**Storage / blob pool** (from F2 audit, not yet fixed)
- **`recountProject` TOCTOU** — `getProject → readdir → updateProject` is non-atomic. Two concurrent uploads can each read assetCount=N and both write N+1. The cache is documented as advisory and self-heals on next listAssets, but worth a per-project mutex if anyone hits it.
- **`copyAsset` zombie sidecar on missing-binary fallback** — `lib/server/assetService.ts:295`. When a legacy source has `filename` set but the file is missing, the code falls through with `filename: null, contentHash: null` and no `mockUrl` — produces a sidecar that no read path can serve. Should fail the copy or use the contentHash path.
- **`renameAsset` TOCTOU** — `getAssetSidecar → writeJson` is read-modify-write; concurrent `deleteAsset` between the two ops resurrects a deleted asset (orphan sidecar pointing at a released blob). Per-asset mutex.
- **`copyAsset` doesn't validate target project exists** — `ensureDir` happily creates an orphan project dir for a non-existent project id. Should `getProject(targetProjectId)` first.

**Runtime / executors** (from F1 audit, not yet fixed)
- **Note nodes mid-chain silently drop downstream branches** — `runtime.ts:172` skips Notes with `outputsByNode.set(nodeId, {})`, downstream gets `undefined`, `everyInputNullish` skips it. Rare in practice (Notes are usually at edges) but the silence is what tripped the audit. Either reject Notes in the middle of a chain on save, or let them pass-through their input.
- **`everyInputNullish` cascades unhelpfully** — a buggy executor returning `{}` (no output) makes downstream nodes look like they were intentionally null-routed. Add a per-node debug emit when the orchestrator skips on null-route, including which upstream emitted null.

**Composer / UX** (from F4 audit, partial)
- ~~**Multi image-input slots**~~ — *shipped as part of the input-contract pass*. `lib/workflow/inputContract.ts` derives the slot list, `validateComposerInputs` runs pre-flight, the composer shows named slot indicators (Reference / Init / Mask / …) when ≥2 image inputs are present, and chips bind to slots in declaration order.

### Accessibility

- **`aria-label` audit** on icon-only buttons across the app
- **Canvas tab order** — keyboard users can't navigate the graph at all today. Should at least be navigable in topo order.
- **Color contrast** on `muted-foreground` over `panel-soft` — borderline on AA. Run an automated contrast checker.

---

## Strategic / out-of-scope (track in README roadmap)

These live in the [README roadmap](../README.md#roadmap-selected) — bigger commitments, longer horizon:

- 🌌 **Workflow sharing gallery** (community exchange, opt-in publish)
- 🧩 **Custom node plugin runtime API** (sandboxed third-party plugins)
- 🔄 **Workflow chaining macro node** (multiple ComfyUI endpoints in series)
- 📜 **Workflow versioning + diff** (history, rollback, compare)
- 🔌 **More LLM providers** (Google Vertex, Cohere, Mistral)

When something graduates from strategic to "approved + scoped", it moves here.

---

## How to use this doc

- Open an issue first when picking up an Approved item — confirms scope + avoids two contributors stepping on each other.
- Move items between sections as their state changes (draft → approved → in-progress → done → delete from this file).
- Don't track every micro-task here — that's what TaskCreate / GitHub issues / your local TODO list are for. This is for things big enough to merit a discussion thread, small enough to fit in a sprint.
- Things linked to maintainer-only docs in `docs/archive/` (gitignored): the link works locally but won't resolve for community contributors viewing the public repo. Note this as "maintainer notes" so it's clear.
