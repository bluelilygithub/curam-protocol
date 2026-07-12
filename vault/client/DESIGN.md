# Curam Vault — UI design reference

Read this before adding or editing anything under `client/`. Backend-only work can ignore it.

---

## Stack

React 18 · Vite · Tailwind CSS · Zustand · React Router v6

Tailwind handles **layout and typography scale**. **Colour always comes from CSS variables** — never Tailwind palette classes (`text-gray-500`, `bg-blue-600`, `dark:` variants).

---

## Theming

`ThemeProvider` writes six tokens to `:root` on every theme change. Use inline `style={{ … }}` with these vars:

| Token | Use |
|-------|-----|
| `--color-bg` | Page / input backgrounds |
| `--color-surface` | Cards, toolbars, elevated panels |
| `--color-border` | Borders, dividers, scrollbar thumb |
| `--color-primary` | Primary buttons, active tabs, links |
| `--color-text` | Headings, body |
| `--color-muted` | Secondary text, placeholders, icons |

Five themes live in `src/themes.js` (default **warm-sand**: terracotta primary `#CC785C`). Font is user-selectable via `--font-sans` (default DM Sans).

**Status colours** (outside theme — use as-is):

- Warning / caution: `#b45309`, `#f59e0b`, `#fef3c7`
- Error / danger: `#ef4444`, `#991b1b`, `#fff1f2`, `#fca5a5`
- Success: `#166534`, `#16a34a`, `#dcfce7`

---

## Layout

- Shell: `Layout.jsx` — sidebar + main (`flex-1`, `100dvh` with `100vh` fallback)
- Breakpoint: **`sm` (640px)** only — mobile vs desktop
- Sidebar: expanded (180–520px) · collapsed icon rail (48px) · hidden overlay on mobile
- Page content: usually `flex flex-col flex-1 min-h-0 overflow-hidden`

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
- Inputs: `px-3 py-2.5 rounded-xl border text-sm outline-none` + FIELD_STYLE pattern
- Buttons: `rounded-lg` · primary CTA `px-3.5 py-1.5 text-sm font-medium`
- Modals: `rounded-2xl` · `max-w-sm` for confirms

---

## Interaction

- **Hover:** `hover:opacity-60` or `hover:opacity-70` — never change background colour on hover
- **Transitions:** `transition-all` or `transition-opacity` at **200ms**
- **Primary button:** `background: var(--color-primary)`, `color: #fff`
- **Secondary button:** border + `var(--color-border)`, text `var(--color-muted)` or `var(--color-text)`
- **Active tab / toggle:** filled `var(--color-primary)` + white text (see `PageToolbar`)

No shared `<Button>` component — compose inline like existing pages.

---

## Icons

Always `getIcon(name, { size: n })` from `IconProvider`. Register new names in the provider map first. Do not import Lucide/Heroicons directly in pages or components.

---

## Shared components (reuse before inventing)

| Component | When |
|-----------|------|
| `PageToolbar` | Multi-view pages with actions |
| `ConfirmModal` | High-stakes delete (type-to-confirm) |
| Inline Yes/No | Routine deletes |
| `ProcessingModal` | Operations >2s (via `useProcessingStore`) |
| `Toast` | Instant CRUD feedback |
| `OverflowMenu` | Secondary page actions |

---

## Z-index

dropdowns `z-20` · mobile sidebar `z-40` · modals `z-50` · ProcessingModal `z-[9998]` · toasts `z-[9999]`

---

## Reference implementations

Copy patterns from these before improvising:

- **Settings-style page:** `pages/SettingsPage.jsx`
- **Simple content page:** `pages/MemoryPage.jsx`
- **Modal:** `components/ConfirmModal.jsx`
- **Toolbar:** `components/PageToolbar.jsx`

---

## Don't

- Tailwind colour utilities for themed UI (`bg-gray-*`, `text-blue-*`, `dark:*`)
- Hardcoded theme colours for normal surfaces (use `var(--color-*)`)
- New button/input abstractions unless explicitly requested
- `fetch('/api/…')` — use `apiClient`
