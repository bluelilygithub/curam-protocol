# Font Customizer — Phase 1 (fetch / license / inspect / freeze)

Standalone Python module, no server/UI wiring yet. See `vault/CLAUDE.md`'s
architecture principle: structural edits (this phase and later phase 3)
live here in fontTools; color/shadow/image-fill stay in the rendering layer
(CSS/SVG), added in later phases.

## Setup

```bash
cd server/services/fonts
python -m venv .venv
.venv/Scripts/activate   # Windows
pip install -r requirements.txt
```

## Modules

- `google_fonts_repo.py` — looks up a family in the `google/fonts` GitHub
  repo. Presence under `ofl/` **is** the OFL license proof (the repo's own
  directory structure enforces this split) — no metadata parsing needed to
  confirm license. If the family exists only under `apache/` or `ufl/`,
  raises `LicenseNotAllowedError` and halts; if not found anywhere, raises
  `FontNotFoundError`.
- `font_inspect.py` — ground-truth variable/static detection via fontTools
  (`fvar`/`gvar`/`CFF2` tables), never trusting filename conventions alone.
  Reports available axes (tag, name, min/default/max) when variable.
- `freeze.py` — `freeze_to_static()` uses
  `fontTools.varLib.instancer.instantiateVariableFont` to pin a variable
  font to one static instance. Asserts the output has no `fvar` table
  before returning — later phases must never receive a live variable font.
- `pipeline.py` — `run(family, axis_values=None)` chains all of the above
  and returns a `Phase1Result` with the static font bytes plus a
  JSON-serializable metadata report (`.metadata_report()`).

## Usage

```python
from pipeline import run

result = run("Roboto Flex", axis_values={"wght": 700})
print(result.metadata_report())
# static bytes ready for phase 3: result.static_font_bytes

result = run("Roboto Slab")  # static font — passes through unfrozen
```

## Tests

```bash
pytest                 # runs everything, including network tests
pytest -m "not network"  # offline-only (unit tests for slug/file-choice logic)
```

Network tests hit the real `google/fonts` repo with two known families:
**Roboto Flex** (variable — confirms axis detection + freeze) and
**Roboto Slab** (static — confirms pass-through, no freeze attempted).

## Non-negotiables enforced in this phase

- Never allow outline edits on a live variable font — `freeze.py` is the
  only path from variable to static, and it verifies its own output.
- License check halts hard on non-OFL, before any font bytes are even
  parsed by fontTools — no silent downgrade or "proceed anyway."

## Phase 3 — structural edits (`transforms/`, `kerning.py`, `structural.py`)

Applies the same transform-recipe shape used by the client's "Parametric
Stylesheet" presets, but with real fontTools outline editing — **not** a
port of the Phase 2 preview's shortcuts:

- **Stem thickness** — genuine per-point outline offset along each
  contour's local normal (`transforms/geometry.py::offset_contour`),
  works in both directions (thicken or thin). Phase 2's canvas
  fake-bold stroke was preview-only and positive-only; this isn't that.
- **Counter width** — contours classified `outer`/`counter` by signed-area
  **winding direction** (`transforms/glyph_edit.py::classify_outer_vs_counter`),
  not Phase 2's largest-area-wins heuristic. Correctly handles multi-outer
  glyphs (e.g. the dot + stem of 'i').
- **Proportional width** / **extend ascenders-descenders** — same
  semantic mapping as Phase 2 (scale-x around 0; warp above cap-height /
  below baseline only), now applied to real glyf point coordinates.
- Every edited glyph gets its **sidebearings recalculated**
  (`transforms/sidebearings.py`): left sidebearing from the new bounding
  box, advance width derived from the glyph's original right sidebearing
  so spacing stays consistent with untouched neighbours.
- **Contour validation** (`transforms/validate.py`) runs after every
  glyph: contour count preserved, no degenerate (zero-area / <3-point)
  contours, no winding-sign flip (a flip means the offset self-intersected
  and collapsed the outline — reported, not silently accepted).
- **Kerning** compiles to real GPOS via `fontTools.feaLib`
  (`kerning.py`): each Phase-2-style group (`diagonal-caps`,
  `cap-round-lower`, `round-pairs`, `punctuation`) becomes an actual
  OpenType glyph class (including diacritic variants present in the
  font), not the literal 2-letter pair strings used for the preview.
  Advanced-pair overrides compile as specific (`format1`) pair rules
  ahead of the class (`format2`) rules in the same feature block, so they
  correctly override rather than stack with the class adjustment.

**Composite glyphs (accented letters) are fully supported.** `Á`, `é`,
`ñ`, `ü`, `ç` etc. are typically TrueType *composite* glyphs (a base glyph
+ a mark component at a fixed offset). `transforms/glyph_edit.py` detects
them (`is_composite`), flattens them to absolute-coordinate contours via
fontTools' own recursive `Glyph.getCoordinates()`, and runs them through
the *exact same* transform pipeline as a simple glyph — the base and the
accent are literally the same list of contours by that point, so the
base's contours transform identically to the standalone base glyph, and
the accent mark inherits the same width scale / ascender-descender warp /
stem offset, keeping it correctly positioned relative to the transformed
base without any separate repositioning heuristic. The glyph is
reassembled as a plain simple glyph afterward (`set_glyph_contours` clears
`.components`, sets `numberOfContours`) since it can no longer be
described as untouched components at fixed offsets. `DEFAULT_GLYPH_CHARS`
in `structural.py` includes the common accented Latin-1 letters by
default. A composite whose component references a missing glyph name is
skipped with a `decompose_failed: ...` reason in
`StructuralEditReport.glyphs_skipped` — never silently dropped. See
`tests/test_composites.py` for acute/grave/umlaut/tilde/cedilla coverage.

**Known limitation — Advanced Pairs unit scaling.** Phase 2 stores an
advanced-pair kerning value as raw pixels at whatever preview font size
was on screen when the user set it (not saved alongside the preset). This
backend instead treats that number as design units on a nominal 1000-UPM
scale (scaled to the real font's `unitsPerEm`). For a preset saved and
reapplied purely within Phase 2 this is invisible; for a *numerically
exact* pixel-for-pixel match between the Phase 2 preview and this
backend's output, Phase 2's storage format would need to record font size
too — flagged here rather than silently assumed correct.

## Phase 4 — export (`export/`)

Takes a font already transformed by `structural.apply_transform_recipe`
and produces `.ttf` / `.woff2` / `.otf` bytes plus one `ExportReport`:

- **`export/rename.py`** — OFL Reserved Font Name compliance. Rewrites
  name IDs 0 (Copyright), 1 (Family), 4 (Full name), 6 (PostScript name),
  7 (Trademark), and 16/17 if the source font used them. **Raises
  `OFLComplianceError` and blocks export outright** if the new family
  name is empty or matches the original (case-insensitively) — this is a
  hard stop, not a warning, since redistributing under the font's
  Reserved Font Name is exactly what that OFL clause forbids.
- **`export/cleanup.py`** — strips `gasp`/`hdmx`, prunes the `name` table
  down to one real locale (Windows en-US + Mac default — the two
  `rename.py` actually writes).
- **`export/subsetting.py`** — a thin wrapper around `fontTools.subset`.
  Deliberately thin: glyph selection is entirely `Subsetter.populate()` +
  `.subset()`'s own cmap→glyph→component closure, not custom code. This
  is the audit point from the Phase 3.5 gap report — nothing here (or
  anywhere else in the export path) filters glyphs by `numberOfContours`,
  which is exactly the kind of assumption that broke sidebearing recalc
  for composites before. A composite's base + mark are always pulled in
  or dropped together correctly.
- **`export/otf_convert.py`** — genuine glyf (quadratic) → CFF (cubic)
  conversion via `Qu2CuPen` + `T2CharStringPen` + `FontBuilder.setupCFF`,
  not a renamed `.ttf`. GPOS/GDEF (Phase 3's compiled kerning) are copied
  over directly since glyph names/order match exactly between the two.
  Documented limitation: OS/2/hhea/post metadata is re-derived from the
  source's key fields rather than exhaustively mapped field-by-field —
  noted, not silently gapped.
- **`export/pipeline.py`** — `export_font(font, new_family_name, ...)`
  orchestrates the above and returns `(outputs, ExportReport)`.
  `ExportReport` **carries Phase 3.5's `StructuralEditReport` through
  unmodified** (`report.structural`) rather than building a parallel
  reporting mechanism — `report.summary()` flattens both into one dict:
  renamed fields, stripped tables, subset before/after glyph counts, file
  size before/after per format, and the full transforms/kerning/coverage
  breakdown (`glyphs_edited`, `composite_glyphs_reassembled`,
  `glyphs_skipped`, `validation_issues`). `report.incomplete` is `True`
  whenever `glyphs_skipped` is non-empty — surfaced explicitly rather than
  silently shipping a font missing glyphs the designer asked for.

**`GITHUB_TOKEN`** (optional env var): api.github.com's unauthenticated
rate limit (60/hr) is easy to burn through in a dev session running these
tests repeatedly — raw.githubusercontent.com (the actual font bytes) has
no such limit, only the license-check directory listing does. Set
`GITHUB_TOKEN` to any GitHub personal access token (no special scope
needed, it only reads a public repo) to raise that to 5000/hr.

## Tests

`tests/test_structural.py` fetches a real OFL font via `pipeline.run()`
and exercises: sidebearing recalculation, stem thickness in both
directions, winding-based counter classification, and GPOS class +
advanced-pair kerning compilation. `tests/test_pipeline.py` covers Phase
1. `tests/test_composites.py` covers composite-glyph decomposition
(acute/grave/umlaut/tilde/cedilla). `tests/test_export.py` runs the full
Phase 1 → 3 → 4 pipeline: OFL rename blocking, field rewrites, file-size
reduction after subsetting, composite glyphs surviving subsetting, and
kerning surviving into both `.ttf` and `.otf`. The composite/export tests
fetch fixture bytes directly via `raw.githubusercontent.com` with an
in-process cache to stay clear of the api.github.com rate limit
entirely. Run `pytest -m "not network"` for the offline-only subset.
