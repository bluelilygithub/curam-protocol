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

**Known limitation — composite glyphs.** Most accented Latin letters
(e.g. `Á`, `é`) are TrueType *composite* glyphs (a base glyph + a mark
component) and are skipped by the outline transforms (reported in
`StructuralEditReport.glyphs_skipped`) rather than risking incorrect
decomposition. Base A-Z/a-z/0-9 are simple glyphs in virtually every
Google Fonts TTF and are fully supported.

**Known limitation — Advanced Pairs unit scaling.** Phase 2 stores an
advanced-pair kerning value as raw pixels at whatever preview font size
was on screen when the user set it (not saved alongside the preset). This
backend instead treats that number as design units on a nominal 1000-UPM
scale (scaled to the real font's `unitsPerEm`). For a preset saved and
reapplied purely within Phase 2 this is invisible; for a *numerically
exact* pixel-for-pixel match between the Phase 2 preview and this
backend's output, Phase 2's storage format would need to record font size
too — flagged here rather than silently assumed correct.

## Tests

`tests/test_structural.py` fetches a real OFL font via `pipeline.run()`
and exercises: sidebearing recalculation, stem thickness in both
directions, winding-based counter classification, and GPOS class +
advanced-pair kerning compilation. `tests/test_pipeline.py` covers Phase 1.
Run `pytest -m "not network"` for the offline-only subset.
