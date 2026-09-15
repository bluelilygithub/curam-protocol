"""
Freeze a variable font to a single static instance via fontTools.varLib.instancer.

This MUST run before any outline/kerning edits in later phases — downstream
code should only ever receive a font that has already passed through here
(or was static to begin with). We enforce that by asserting the output has
no fvar table before returning it.
"""

from __future__ import annotations

from io import BytesIO

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


class FreezeError(Exception):
    pass


def freeze_to_static(data: bytes, axis_values: dict[str, float] | None = None) -> bytes:
    """
    Instantiate a variable font at `axis_values` (tag -> value). Any axis not
    given a value is pinned at its own default. Returns the frozen font's
    bytes, guaranteed fvar-free.

    `axis_values=None` freezes every axis at its default (i.e. the font's
    out-of-the-box static appearance).
    """
    font = TTFont(BytesIO(data))
    if "fvar" not in font:
        raise FreezeError("Font has no fvar table — it is already static, nothing to freeze.")

    fvar = font["fvar"]
    resolved = {axis.axisTag: axis.defaultValue for axis in fvar.axes}
    if axis_values:
        unknown = set(axis_values) - set(resolved)
        if unknown:
            raise FreezeError(f"Unknown axis tag(s) for this font: {sorted(unknown)}")
        resolved.update(axis_values)

    # instantiateVariableFont mutates in place and, with all axes pinned to a
    # single point, drops fvar/gvar and produces a static font.
    instantiateVariableFont(font, resolved, inplace=True)

    if "fvar" in font:
        raise FreezeError(
            "Instancing did not fully freeze the font (fvar table still present) — "
            "refusing to hand a live variable font downstream."
        )

    out = BytesIO()
    font.save(out)
    return out.getvalue()
