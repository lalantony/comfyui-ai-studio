<!--
Thanks for the pull request! A few quick notes before you submit:
  - For non-trivial changes, an issue should already exist. Link it below.
  - PR title should be short and imperative, e.g. "fix(workflow-runtime): cancel WS on AbortSignal"
  - Squash-merge is the default merge strategy.
-->

## Summary

<!-- 2-3 sentences describing what this PR changes and why. -->

Fixes #

## Changes

<!-- Bullet list of the meaningful changes. Skip noise like "ran prettier". -->

-
-
-

## Testing

<!-- What did you run locally? For workflow-runtime / ComfyUI changes, list the workflow + ComfyUI version + auth mode you tested against. -->

- [ ] `npm run build` passes (type check)
- [ ] `npm run lint` passes
- [ ] Manual testing notes:

## Screenshots / video

<!-- For any UI change. Drag-drop the image directly into the editor. -->

## Checklist

- [ ] I have read [`CONTRIBUTING.md`](../blob/main/CONTRIBUTING.md)
- [ ] My change follows the conventions in [`design.md`](../blob/main/design.md) (uses tokens, not raw hex; reuses primitives where they exist)
- [ ] I have added or updated documentation if behavior changed
- [ ] I have not introduced new mock-seeding fallbacks (the FS under `.studio-data/` is the source of truth)
