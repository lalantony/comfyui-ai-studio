# Design System

> The contract for keeping the UI consistent. Tokens, primitives, and conventions live here. If you're touching any UI surface, skim this first — it's short by design.

The studio is **dark-only**. The root `<html>` is hard-coded to `className="dark"`. Don't introduce a light-mode branch.

## Where tokens live

Tailwind v4 with **CSS-first config**. There is no `tailwind.config.ts`. Everything is declared in [`app/globals.css`](./app/globals.css):

- `@theme { --color-*, --radius-*, --font-*, --animate-* }` → tokens become Tailwind utilities (`bg-panel`, `text-foreground`, `border-white/8`, `bg-primary/60`, …)
- `@utility <name> { … }` → custom utilities like `brand-gradient`, `glass-panel`, `scrollbar-thin`
- `@layer base { … }` → global resets and the scrollbar styling

**Always use tokens — not raw hex.** It's how the brand stays coherent and themeable later.

## Color palette

### Surfaces + text

| Token | Value | Usage |
|---|---|---|
| `background` | `hsl(222 18% 6%)` | App canvas |
| `foreground` | `hsl(220 20% 96%)` | Primary text |
| `panel` | `hsl(222 16% 9%)` | Card / panel |
| `panel-soft` | `hsl(222 14% 12%)` | Inputs, subtle elevation |
| `panel-elevated` | `hsl(222 14% 15%)` | Highest elevation (dialogs, popovers) |
| `border` | `hsl(222 12% 20%)` | Default borders |
| `border-soft` | `hsl(222 10% 16%)` | Subtle borders |
| `muted` | `hsl(220 10% 60%)` | Muted text base |
| `muted-foreground` | `hsl(220 8% 70%)` | Secondary text |

> **Note**: most thin separators use `border-white/8` (an alpha on white) rather than the `border` token, because alpha reads better on dark surfaces. The `--color-border` rule is auto-applied to all elements via the `@layer base` reset.

### Accent + semantic

| Token | Value | Used for |
|---|---|---|
| `primary` | `hsl(255 88% 66%)` | Active nav state, focus rings, primary brand purple |
| `accent-blue` | `hsl(205 90% 62%)` | Image nodes, info |
| `accent-green` | `hsl(145 65% 55%)` | Save Output node, success state |
| `accent-orange` | `hsl(28 95% 62%)` | ComfyUI node, warnings |
| `accent-pink` | `hsl(330 80% 68%)` | Video, favorites heart |
| `accent-yellow` | `hsl(68 100% 62%)` | Music, highlights |
| `danger` | `hsl(0 72% 58%)` | Destructive, errors |
| `success` | `hsl(145 65% 48%)` | Health check connected |
| `warning` | `hsl(38 92% 56%)` | Health check checking |

### Brand gradient

The single most important visual element. Use it for **primary CTAs** (Generate, Test Run, Add Environment, brand mark) and the brand logo's sphere.

```css
/* @utility brand-gradient */
background: linear-gradient(135deg, #ff4d8d 0%, #ff7a45 45%, #ffc83d 100%);
```

Hex tokens: `--color-brand-pink: #ff4d8d`, `--color-brand-orange: #ff7a45`, `--color-brand-yellow: #ffc83d`.

Pair the gradient with a warm hover glow: `shadow-[0_0_30px_rgba(255,122,69,0.45)]`.

> ⚠️ Don't introduce a parallel gradient (the old purple `#6d5dfc → #a855f7` is gone). One brand surface, applied consistently.

## Typography

| Use | Size + weight |
|---|---|
| App title (sidebar logo) | 13px / semibold |
| Page title | 20–24px / semibold |
| Section header | 14–15px / semibold |
| Card title | 13–14px / medium |
| Body | 13px |
| Metadata | 10–12px / muted |
| Button | 13px / medium |
| Node title | 13px / semibold |
| Node body | 11–12px |

Font family: `Inter` via `next/font/google` (with `Geist Sans` and system fallbacks). Wired through `--font-inter` → the `font-sans` Tailwind utility.

## Spacing + sizing

- App shell padding: 16–20px
- Card padding: 12–16px
- Inspector sections: 16px
- Sidebar nav item height: 36–40px
- Composer footer height: ~170px (the `(studio)/layout.tsx` adds `pb-80` so content doesn't sit under it)

## Border radius

- Small controls (inputs, badges): `rounded-md` (6px) or `rounded-lg` (8px)
- Buttons + cards: `rounded-xl` (12px)
- Large panels (composer, dialogs): `rounded-2xl` (16px)
- Avatars + status dots: `rounded-full`

## Borders + shadows

- Panel border: `border border-white/8`
- Hover border: `border-white/15`
- Active border: `border-primary/60`
- Active glow: `shadow-[0_0_0_1px_rgba(124,92,255,0.5)]`
- Brand CTA glow: `shadow-[0_0_30px_rgba(255,122,69,0.45)]`

## Glass panels

```css
@utility glass-panel {
  @apply bg-panel/80 backdrop-blur-xl border border-white/8;
}
@utility glass-panel-elevated {
  @apply bg-panel-elevated/90 backdrop-blur-xl border border-white/10;
}
```

Use the elevated variant for dialogs and the floating composer.

## Scrollbar

The default scrollbar is styled globally in `@layer base` so **every** scrollable surface in the app picks up the dark theme without per-callsite classes. Modern browsers get the standard `scrollbar-width` + `scrollbar-color` properties; older WebKit gets `::-webkit-scrollbar` rules with a 2px transparent border + `background-clip: content-box` for visual padding.

If you need a slimmer 6px variant for compact contexts (popovers, sidebar nav), apply the `scrollbar-thin` utility.

## Images

**Always use `next/image`** (`import Image from "next/image"`) for asset thumbnails and any other image rendered repeatedly. Next.js routes every image through its on-the-fly optimizer at `/_next/image`, which:

- Generates **WebP** (or AVIF when negotiated) — order-of-magnitude smaller than the original PNG/JPEG
- Resizes to the requested `sizes` so phones don't download desktop-sized bytes
- Caches optimized variants in `.next/cache` so the second hit is free

**Pattern**: parent has `relative` + dimensions (or an `aspect-*` class), `<Image>` uses `fill` + a `sizes` prop matching the layout:

```tsx
<div className="relative aspect-square">
  <Image
    src={asset.thumbnail}
    alt={asset.name}
    fill
    sizes="(max-width: 640px) 50vw, 256px"
    className="object-cover"
  />
</div>
```

The **only exception** is the asset viewer dialog (`asset-viewer-dialog.tsx`) — it intentionally serves the full-resolution original since the user opted into a full-size view. That callsite documents why it keeps `<img>`.

**Don't add new bare `<img>` tags** for asset content. ESLint enforces this via `@next/next/no-img-element`; suppressing it requires a comment explaining why (like the viewer does).

## Node colors

Convention for the canvas — each node type gets a color so the graph reads at a glance.

| Node | Border / header | Handle |
|---|---|---|
| Text Input | Purple (`#a855f7`) | Purple |
| Image Input | Cyan (`#06b6d4`) | Cyan |
| Workflow Variable | Orange (`#f97316`) | Orange |
| LLM | Purple (`#a855f7`) | Purple |
| Text Combine | Purple (`#a855f7`) | Purple |
| Condition | Orange (`#f97316`) | Green / Red |
| ComfyUI | Orange (`#f97316`) | Mixed |
| Save Output | Green (`#22c55e`) | Cyan |

## Connection lines

Color follows the data being passed:

- Text / data: green or blue
- LLM / prompt: purple
- Image / media: cyan
- Parameter / settings: orange
- Error / safety: red

## Component organization

```
components/
├─ ui/         ← ShadCN-style primitives. Generic, theme-aware, no app logic.
├─ shared/     ← App-specific composed UI. Knows about our domain (e.g. ResourceMeter, GlassPanel).
├─ app-shell/  ← Sidebar, topbar, status widget.
├─ projects/   ← Project gallery + composer surfaces.
├─ workflows/  ← Canvas, node library, inspector.
├─ nodes/      ← React Flow nodes (default-exported, memoized).
└─ settings/   ← Settings dialogs + endpoint editor.
```

**Decision rule**: when creating a new reusable component, ask: *"Could a different app reuse this?"*
- **Yes** → `components/ui/` (e.g. `Button`, `Dialog`, `Switch`, `Select`, `Tabs`, `Callout`)
- **No, but it's reused inside our app** → `components/shared/` (e.g. `GlassPanel`, `GradientButton`, `ResourceMeter`, `SectionHeader`, `AppLogo`, `EmptyState`, `ConfirmDialog`)
- **One-off for a specific surface** → put it next to the surface it serves

### Current primitives (`components/ui/`)

| Primitive | Notes |
|---|---|
| `Button` | CVA variants: default, destructive, outline, secondary, ghost, link |
| `Dialog` | Radix-backed modal with header/footer/title/description slots |
| `Switch` | Radix toggle, used for boolean settings |
| `Tabs` | Radix tabs |
| `Select` | Native `<select>` with `appearance-none` + custom `ChevronDown`. Sizes: `sm`, `md`. Always use this — never bare `<select>`. |
| `Input` | Styled text input with the studio's dark form treatment. Sizes: `sm`, `md`. Pass `mono` for URLs/IDs/hex. Always use this — never bare `<input>` for form fields. |
| `Callout` | Info / warning / error / success bubble. Auto-detects single-line vs multi-line. Optional title, icon, dismiss, inline action. **Use this for every contextual hint** — empty states like "no endpoints registered", form-level errors, settings warnings, success confirmations. |
| `Textarea` *(planned)* | Same convention as `Input` for multi-line. Several dialogs + node bodies still inline this — migration is queued. |

### Current shared surfaces (`components/shared/`)

| Component | Purpose |
|---|---|
| `GlassPanel` | Card wrapper with `glass-panel` utility |
| `GradientButton` | Brand-gradient primary CTA |
| `SectionHeader` | Title + optional action row |
| `ResourceMeter` | Labeled bar (CPU/RAM/VRAM/Disk) — color shifts at 50% / 80% |
| `AppLogo` | Brand mark, PNG-backed for crisp rendering at any DPR |
| `EmptyState` | Coming Soon / nothing-here placeholder |
| `ConfirmDialog` | Generic destructive-confirmation modal — reuse this rather than inlining new "Are you sure?" modals |

## Patterns that have already been standardized

### Single primary action per route

The `+` button in the `TopBar` is **route-aware**: home/projects → "New project"; inside a project → "Add asset". Hidden where there's nothing to add. Don't proliferate primary CTAs at the top.

### Scrollable region

Use the global default. Apply `scrollbar-thin` only for tight contexts.

### Dialog primitive

Always go through `components/ui/dialog.tsx`. Concrete dialogs live next to their feature: `components/projects/new-project-dialog.tsx`, `components/settings/environment-dialog.tsx`, etc.

### Inspector tabs

`Workflow / Versions` — narrow union (no `Properties` tab — that was removed when node editing moved inline).

## Responsive

- Sidebar collapses under `lg` (1024px) — `useUIStore.sidebarCollapsed` controls width
- Composer + canvas optimized for ≥ 1280px desktop. Workflow canvas shows a "use a larger screen" hint on mobile.
- Right-side inspector becomes a drawer under `xl` (1280px) — *(planned, not yet implemented)*

## Accessibility

- All buttons have visible focus rings (`focus-visible:ring-2`)
- Icon-only buttons have `title="..."` and/or `aria-label`
- Color contrast meets WCAG AA on the dark surfaces (verified on `--color-foreground` over `--color-background` and panel surfaces)
- Keyboard shortcuts (planned):
  - `Cmd/Ctrl + S` — Save workflow
  - `Cmd/Ctrl + Enter` — Run workflow
  - `Delete` — Delete selected node
  - `Space + drag` — Pan canvas

## How to add a new color, token, or utility

1. **Add the token** to `@theme { … }` in `app/globals.css`.
2. **Use the new utility** as a Tailwind class anywhere (`bg-mynew`, etc.).
3. **Document it here** in the appropriate table.
4. If it's a custom composition (not a pure color or radius), use `@utility name { … }` instead of `@theme`.

> Don't reach for inline styles or one-off CSS files. Token + utility is the path.
