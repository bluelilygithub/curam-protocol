"""
Ground-truth font inspection via fontTools — never trust filename/metadata
conventions alone for the variable-vs-static determination. We open the
actual binary and check for fvar/gvar/CFF2 tables.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO

from fontTools.ttLib import TTFont


@dataclass
class AxisInfo:
    tag: str
    name: str
    min_value: float
    default_value: float
    max_value: float


@dataclass
class InspectionReport:
    is_variable: bool
    has_gvar: bool
    has_cff2: bool
    family_name: str
    axes: list[AxisInfo] = field(default_factory=list)


def _name_table_string(font: TTFont, name_id: int) -> str:
    name_rec = font["name"].getDebugName(name_id)
    return name_rec or ""


def inspect_font_bytes(data: bytes) -> InspectionReport:
    font = TTFont(BytesIO(data))
    has_fvar = "fvar" in font
    has_gvar = "gvar" in font
    has_cff2 = "CFF2" in font

    family_name = _name_table_string(font, 1) or _name_table_string(font, 16) or "Unknown"

    axes: list[AxisInfo] = []
    if has_fvar:
        fvar = font["fvar"]
        for axis in fvar.axes:
            axis_name = font["name"].getDebugName(axis.axisNameID) or axis.axisTag
            axes.append(
                AxisInfo(
                    tag=axis.axisTag,
                    name=axis_name,
                    min_value=axis.minValue,
                    default_value=axis.defaultValue,
                    max_value=axis.maxValue,
                )
            )

    return InspectionReport(
        is_variable=has_fvar,
        has_gvar=has_gvar,
        has_cff2=has_cff2,
        family_name=family_name,
        axes=axes,
    )
