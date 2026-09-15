"""
Phase 4 orchestrator: takes a font already transformed by Phase 3/3.5
(`structural.apply_transform_recipe`), enforces OFL renaming, cleans up
and subsets it, and emits .ttf/.woff2/.otf bytes plus one export report
that reuses Phase 3.5's `StructuralEditReport` rather than building a
second, parallel reporting mechanism (requirement 4).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO

from ..structural import StructuralEditReport
from .cleanup import prune_name_table_locales, strip_unused_tables
from .otf_convert import convert_ttf_to_otf
from .rename import OFLComplianceError, RenameReport, rename_for_ofl
from .subsetting import DEFAULT_RANGE_IDS, SubsetReport, subset_font


@dataclass
class ExportReport:
    rename: RenameReport
    subset: SubsetReport
    stripped_tables: list[str]
    name_records_before: int
    name_records_after: int
    size_before_bytes: int
    size_after_bytes: dict[str, int] = field(default_factory=dict)  # per output format
    structural: StructuralEditReport | None = None  # Phase 3.5's own report, carried through unmodified
    formats_produced: list[str] = field(default_factory=list)
    incomplete: bool = False  # True if any requested glyph was skipped/failed anywhere in the pipeline

    def summary(self) -> dict:
        """A flat, JSON-serializable version of everything requirement 4 asks the export summary to include."""
        return {
            'renamed': {
                'original_family': self.rename.original_family,
                'new_family': self.rename.new_family,
                'full_name': self.rename.full_name,
                'postscript_name': self.rename.postscript_name,
                'copyright': self.rename.copyright,
                'trademark': self.rename.trademark,
            },
            'stripped_tables': self.stripped_tables,
            'name_records': {'before': self.name_records_before, 'after': self.name_records_after},
            'subset': {
                'range_ids': self.subset.range_ids,
                'glyphs_before': self.subset.glyphs_before,
                'glyphs_after': self.subset.glyphs_after,
            },
            'file_size_bytes': {'before_subsetting': self.size_before_bytes, **self.size_after_bytes},
            'formats_produced': self.formats_produced,
            'structural_transforms_applied': {
                'glyphs_edited': list(self.structural.glyphs_edited) if self.structural else [],
                'composite_glyphs_reassembled': list(self.structural.composite_glyphs_reassembled) if self.structural else [],
                'glyphs_skipped': list(self.structural.glyphs_skipped) if self.structural else [],
                'validation_issues': [
                    {'glyph_name': i.glyph_name, 'contour_index': i.contour_index, 'kind': i.kind, 'detail': i.detail}
                    for i in (self.structural.validation_issues if self.structural else [])
                ],
                'kerning': (
                    {
                        'classes_used': self.structural.kerning.classes_used,
                        'class_rules_written': self.structural.kerning.class_rules_written,
                        'pair_rules_written': self.structural.kerning.pair_rules_written,
                        'skipped_missing_glyphs': self.structural.kerning.skipped_missing_glyphs,
                    }
                    if self.structural and self.structural.kerning else None
                ),
            },
            'incomplete': self.incomplete,
        }


def _save_bytes(font, flavor: str | None = None) -> bytes:
    buf = BytesIO()
    font.flavor = flavor
    font.save(buf)
    return buf.getvalue()


def export_font(
    font,
    new_family_name: str,
    *,
    range_ids=DEFAULT_RANGE_IDS,
    formats=('ttf', 'woff2', 'otf'),
    copyright_text: str | None = None,
    trademark_text: str | None = None,
    structural_report: StructuralEditReport | None = None,
) -> tuple[dict[str, bytes], ExportReport]:
    """
    Mutates `font` in place (rename, cleanup, subset) and returns
    ({format: bytes}, ExportReport). Raises OFLComplianceError — export
    must be blocked, not degraded — if `new_family_name` is empty or
    matches the font's original family name.
    """
    size_before_bytes = len(_save_bytes(font))

    rename_report = rename_for_ofl(font, new_family_name, copyright_text, trademark_text)  # raises on failure

    stripped = strip_unused_tables(font)
    names_before, names_after = prune_name_table_locales(font)
    subset_report = subset_font(font, range_ids)

    outputs: dict[str, bytes] = {}
    size_after: dict[str, int] = {}

    if 'ttf' in formats:
        data = _save_bytes(font, flavor=None)
        outputs['ttf'] = data
        size_after['ttf'] = len(data)

    if 'woff2' in formats:
        data = _save_bytes(font, flavor='woff2')
        outputs['woff2'] = data
        size_after['woff2'] = len(data)

    if 'otf' in formats:
        otf_font = convert_ttf_to_otf(font)
        data = _save_bytes(otf_font, flavor=None)
        outputs['otf'] = data
        size_after['otf'] = len(data)

    incomplete = bool(structural_report and structural_report.glyphs_skipped)

    report = ExportReport(
        rename=rename_report,
        subset=subset_report,
        stripped_tables=stripped,
        name_records_before=names_before,
        name_records_after=names_after,
        size_before_bytes=size_before_bytes,
        size_after_bytes=size_after,
        structural=structural_report,
        formats_produced=list(outputs.keys()),
        incomplete=incomplete,
    )

    return outputs, report


__all__ = ['export_font', 'ExportReport', 'OFLComplianceError']
