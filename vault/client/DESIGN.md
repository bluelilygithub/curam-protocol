# Curam Vault — UI design reference

Read this before adding or editing anything under `client/`. Backend-only work can ignore it.

---

## Stack

React 18 · Vite · Tailwind CSS · Zustand · React Router v6

Tailwind handles **layout and typography scale**. **Colour always comes from CSS variables** — never Tailwind palette classes (`text-gray-500`, `bg-blue-600`, `dark:` variants).

---

## Theming

`ThemeProvider` writes six tokens to `:root` on every theme change, plus `--color-on-primary` and the chart tokens (below). Use inline `style={{ … }}` with these vars:

| Token | Use |
|-------|-----|
| `--color-bg` | Page / input backgrounds |
| `--color-surface` | Cards, toolbars, elevated panels |
| `--color-border` | Borders, dividers, scrollbar thumb |
| `--color-primary` | Primary buttons, active tabs, links |
| `--color-on-primary` | Text and icons on a primary-coloured background (white in some themes, dark in others) |
| `--color-text` | Headings, body |
| `--color-muted` | Secondary text, placeholders, icons |

Five themes live in `src/themes.js`: warm-sand (default), dark-slate, forest, midnight-blue, paper-white. Warm-sand's primary is `#9B5B46` (darkened from `#CC785C` so text on it, and it as text, reach 4.5:1). Each theme's `muted` stays 4.5:1 or better against its bg and surface. Font is user-selectable via `--font-sans` (default DM Sans).

**Status colours** (outside theme — use as-is):

- Warning / caution: `#b45309`, `#f59e0b`, `#fef3c7`
- Error / danger: `#ef4444`, `#991b1b`, `#fff1f2`, `#fca5a5`
- Success: `#166534`, `#16a34a`, `#dcfce7`

These stay for badges and alerts. Charts use the chart tokens instead.

### Chart tokens (2026-11-28)

Each theme in `themes.js` has a `chart` block that `ThemeProvider` writes as:

| Token | Use |
|-------|-----|
| `--chart-1` | Main series: your holdings, portfolio value, area fill (at low opacity). Close to the theme's primary |
| `--chart-2`, `--chart-3`, `--chart-4` | Other series (indexes, allocation slices) |
| `--chart-gain`, `--chart-loss` | Up/down bars and signed figures |
| `--chart-warn` | Near-threshold bars, the heatmap's "unexplained move" outline |
| `--chart-neutral` | Bars that are neither good nor bad |
| `--chart-grid` | Gridlines and the zero line |
| `--chart-ink` | Index ticks and reference markers |

Rules, checked by `node client/src/components/charts/chartTokens.test.mjs`: gain, loss and warn reach 4.5:1 on both `--color-surface` and `--color-bg` (they are also text); the four series reach 3:1 on surface and are at least 1.35:1 apart from each other in lightness, not just hue; dark themes have their own lighter values. A new theme needs a `chart` block or the test fails. Gain and loss are never shown by colour alone: always a sign (+, or the Unicode minus) and, on status badges, an icon.

---

## Layout

- Shell: `Layout.jsx` — sidebar + main (`flex-1`, `100dvh` with `100vh` fallback)
- Breakpoint: **`sm` (640px)** only — mobile vs desktop
- Sidebar: expanded (180–520px) · collapsed icon rail (48px) · hidden overlay on mobile
- Page content: usually `flex flex-col flex-1 min-h-0 overflow-hidden`
- **Wide screens:** do not park page content in a narrow strip (`max-w-3xl`) on a desktop monitor, which left half the screen empty on Guitar. Cap at about `max-w-[1700px]` and, from `xl` (1280px), lay groups of cards out in two columns (`flex flex-col xl:grid xl:grid-cols-2 xl:items-start`). One column below `xl`.

**Top bar:** Search, Tasks, Chat History, Suggestions, **Apps launcher** (`AppsLauncher.jsx`), Settings, Sign out. All other features live in the grouped Apps panel — see `config/appNavigation.js` and `docs/navigation-ia.md`.

**Sidebar sections:** Quick chat → Workspace (Tasks/Notes/Goals/Clients) → Projects (collections) → optional 7 Habits / Client context.

**Page toolbar:** Use `PageToolbar` when a page has view modes, overflow actions, or a primary CTA. Simple settings-style pages can use a custom header (see `MemoryPage.jsx`).

---

## Typography

| Element | Classes |
|---------|---------|
| Page title (toolbar) | `text-xl font-semibold` |
| Section title | `text-base font-semibold` |
| Body | `text-sm` |
| Meta / captions | `text-xs` |
| Help / prose lists | `text-sm leading-relaxed` + `var(--color-muted)` |

---

## Spacing & shape

- Section cards: `rounded-2xl border p-6 space-y-4` on `var(--color-surface)`
- Inner rows / list items: `rounded-xl border p-4` on `var(--color-bg)`
- Inputs: `px-3 py-2.5 rounded-xl border text-sm` + FIELD_STYLE pattern (`background: var(--color-bg)`, border and text from the vars). If you remove the browser outline (`outline-none`), give a visible replacement such as `focus:border-[var(--color-primary)]`, as `VoiceInput` does; never leave a field with no focus indicator. Text fields use `VoiceInput` (built-in mic) rather than a bare `<input>`.
- Buttons: `rounded-lg` · primary CTA `px-3.5 py-1.5 text-sm font-medium`
- Modals: `rounded-2xl` · `max-w-sm` for confirms

---

## Interaction

- **Hover:** `hover:opacity-60` or `hover:opacity-70` — never change background colour on hover
- **Transitions:** `transition-all` or `transition-opacity` at **200ms**
- **Primary button:** `background: var(--color-primary)`, `color: var(--color-on-primary)` (never a hardcoded `#fff`: it fails contrast on the light-blue themes)
- **Secondary button:** border + `var(--color-border)`, text `var(--color-muted)` or `var(--color-text)`
- **Active tab / toggle:** filled `var(--color-primary)` + `var(--color-on-primary)` text (see `PageToolbar`)
- **Help on every control:** a shared `Tooltip` on every button, toggle and field.

No shared `<Button>` component — compose inline like existing pages.

## Accessibility

- Keep the global `:focus-visible` ring (`client/src/index.css`, on buttons, links, tabbables, selects and checkboxes); no `outline-none` without a visible replacement. Text inputs are not covered by that ring, so their focus border is the only indicator.
- Row actions use `opacity-0 group-hover:opacity-*`; the global CSS shows them on touch and keyboard focus, so do not hide them another way.
- Honour `prefers-reduced-motion`: the global CSS cuts animations and transitions (spinners keep turning); JavaScript scrolling should use `behavior: 'auto'` when it is set.
- `Toast` is a permanent `aria-live` region: use `useToastStore` for quick feedback rather than a new live region.
- Icon-only buttons need an `aria-label`.

## Every new tool

Follows the Video Tools conventions (CLAUDE.md, UI system): a shared `Tooltip` on every control, an (i) "how it works" box (`ToolInfoModal`), a compass tour, a guide chat (`TutorChat`, see `docs/guide-chat.md`) and a mic on text fields (`VoiceInput`). Tool pages with many tools use `ToolSidebar`; pages organised around jobs use `JobStart`.

---

## Icons

Always `getIcon(name, { size: n })` from `IconProvider`. Register new names in the provider map first. Do not import Lucide/Heroicons directly in pages or components.

---

## Shared components (reuse before inventing)

| Component | When |
|-----------|------|
| `Dialog` (`components/Dialog.jsx`) | **The one modal shell.** Every modal uses it (focus trap, Escape, backdrop, return focus, close button); `raw` mode keeps an older modal's own look. Never hand-roll a `fixed inset-0` overlay. |
| `Tooltip` | The hover and focus tip on every control |
| `ToolInfoModal` + `useToolInfoModal` | The (i) "how it works" box, shown once and on demand |
| `Skeleton` | Loading states (never a bare "Loading...") |
| `EmptyState` | Empty lists and pages: what it is for and the one next step (never a bare "No items") |
| `VoiceInput` / `VoiceInputProvider` (`components/voiceInput/`) | Text fields with a built-in mic (short mode for single lines, continuous for textareas) |
| `PageToolbar` | Multi-view pages with actions |
| `ConfirmModal` | High-stakes delete (type-to-confirm) |
| Inline Yes/No | Routine deletes |
| `ProcessingModal` | Operations >2s (via `useProcessingStore`) |
| `Toast` | Instant CRUD feedback |
| `OverflowMenu` | Secondary page actions |
| `JobStart` (`components/JobStart.jsx`) | The "What do you want to do?" job screen shared by Graphics and Video Tools: a job is data (title, blurb, icon, ordered steps naming real tool ids) and picking one opens its first tool with a JobBar |
| Popup queue (`store/popupStore.js` + `hooks/usePopupSlot.js`) | Any popup that appears by itself (tips, prompts, nudges) takes a slot so popups take turns; never stack a second fixed popup |
| `TutorChat` (`components/tutor/TutorChat.jsx`) | A page guide: round bottom-right button that opens a chat. Pass wording in `config`, never copy the file. Both the button and the open chat are draggable (see below). Every guide gets the readable tooltip and "Email this conversation" from this one component; a new guide must be listed in `server/config/guides.js` and pass `npm run test:guides` (how: `docs/guide-chat.md`). |
| `ToolSidebar` (`components/ToolSidebar.jsx`) | The left-hand tool menu of a tool page (Graphics, Video Tools look): title with (i) and optional tour button, tool search with a mic (`/` focuses it), groups that open and close, a hover tip on every group and tool, the open tool highlighted, a `hint` line under a tool that is not usable yet. Pass `groups` (`{ label, tip, tools: [{ id, label, icon, tip, hint }] }`). Must sit inside a `VoiceInputProvider`. Used by Font Customizer, Measurements and CSS; keep the tool list in a `<page>Tools.mjs` shared with the page guide. |
| `useDraggable` (`hooks/useDraggable.js`) | Any floating element that can cover content (a fixed button, a chat, a tool palette) so the person can drag it out of the way. |

**Floating elements must be draggable.** A fixed button or panel that can sit on top of page content uses `useDraggable`: keep the normal CSS position (`fixed bottom-5 right-5`), put `ref` and `style` from the hook on the element and `handleProps` on the part to grab (the element itself, or a title bar; the hook ignores buttons, inputs and links inside it). Wrap the element's own click with `guardClick` so a drag does not also click. It works with mouse, touch and pen, keeps the element on screen (also after a resize), remembers the position in this browser only (`storageKey`), and a double-click on the handle puts it back (`resetOnDoubleClick`). Pure maths and its test: `utils/dragPosition.mjs` (`npm run test:drag`).

---

## Z-index

dropdowns `z-20` · mobile sidebar `z-40` · modals `z-50` · ProcessingModal `z-[9998]` · toasts `z-[9999]`

---

## Reference implementations

Copy patterns from these before improvising:

- **Settings-style page:** `pages/SettingsPage.jsx`
- **Simple content page:** `pages/MemoryPage.jsx`
- **Modal:** `components/Dialog.jsx` (new modals); `components/ConfirmModal.jsx` for confirms
- **Toolbar:** `components/PageToolbar.jsx`

---

## Don't

- Tailwind colour utilities for themed UI (`bg-gray-*`, `text-blue-*`, `dark:*`)
- Hardcoded theme colours for normal surfaces (use `var(--color-*)`), including `#fff` text on primary (use `var(--color-on-primary)`)
- `outline-none` with no visible focus replacement
- A hand-rolled `fixed inset-0` modal (use `Dialog`), or a second self-appearing popup outside the popup queue
- New button/input abstractions unless explicitly requested
- `fetch('/api/…')` — use `apiClient`
- Importing Lucide or other icon sets directly — use `getIcon`

When this file and `CLAUDE.md` or `docs/core-conventions.md` disagree, those two win; fix this file.

---

## Charts

Shared kit in `client/src/components/charts/`, kept generic so Finance, Usage & Cost and others can use it (first used by Shares → Charts, 2026-11-28). Charts are drawn with **Recharts** (already installed); add no chart package.

- `ChartCard`: the card every chart sits in (`rounded-2xl border p-6 space-y-4`). `title`, a one-line `subtitle`, `info` (long text behind an (i) with the shared `Tooltip`), `badge` (only for a card the page's range does not drive: "Current snapshot", "Next 90 days", "All time"…), `actions` (toggles on the right), `span` (both columns from `xl`). A page of cards is `flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start`, capped at `max-w-[1700px]`.
- `StatTile`: label, big value, signed sub-line; `primary` fills it with `--color-primary` and `--color-on-primary` text.
- `SegmentedToggle` and `RangeToggle`: active segment `--color-primary` with `--color-on-primary` text; a `Tooltip` on each segment.
- `ChartTooltip`: content for a Recharts `<Tooltip>`, on the surface, border and text vars.
- `chartTheme.mjs`: axis and grid props, `seriesColor(i)`, `animationProps()` (no animation under `prefers-reduced-motion`).
- `chartMath.mjs`: zero-centred bar geometry (`divergingBar`, `positionPct`, `maxAbsOf`), threshold bars and status (`thresholdBar`, `thresholdStatus`, with the near-margin as an argument), `changeOverRange`, `cardsForRange`, `heatCell` (heatmap tone and strength), `weekStart` (Monday of a date's week). Test `node client/src/components/charts/chartMath.test.mjs`.
- `DivergingBars` (bars centred on zero, gain right / loss left, optional `--chart-ink` reference tick, signed figures on the right), `ThresholdBars` (fall against a dashed trigger line, status badge with an icon and a word), `Sparkline` (Recharts line, no axes, gain or loss colour), `DonutChart` (centre label, legend with % and detail), `AreaTrend` (one soft-filled series), `ColumnChart` (vertical columns along months or weeks). Rows use fixed label and figure columns from `sm` so every track lines up; on a phone the label and figures share a line and the bar runs full width below.
- `chartFormat.mjs`: `fmtPct` (+1.6%, −0.8%), `fmtAud` (+A$578), `fmtPts` ("beat by 0.5 pts" / "lagged by 0.8 pts" / "level"); "—" for no value. Test `node client/src/components/charts/chartFormat.test.mjs`.

Every chart has `role="img"` and an `aria-label` saying what it shows. Loading uses `Skeleton` shaped like the cards; nothing to show uses `EmptyState` with one next step.

