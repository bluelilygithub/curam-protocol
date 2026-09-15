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
