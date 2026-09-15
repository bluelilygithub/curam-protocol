"""
CLI entrypoint for the Node integration layer (server/services/fontExportPipeline.js).
Runs the full Phase 1 (fetch, only if a family name is given) -> Phase 3
(structural transforms + kerning) -> Phase 4 (OFL rename, cleanup, subset,
export) pipeline in one process invocation, writing output files to
--output-dir and a single-line JSON status to the LAST line of stdout.

Usage (must run as a module from server/services/, since this package
uses relative imports throughout — same reason tests/ does):
    python -m fonts.cli_export --params-file <path to params.json> --output-dir <dir>

params.json shape:
{
  "family": "PT Serif",           // OR "font_file" — exactly one required
  "font_file": "/tmp/.../input.ttf",
  "recipe": {                      // passed to structural.apply_transform_recipe
    "transforms": {"stemThickness": 0, "proportionalWidth": 100, "extendAscDesc": 0, "counterWidth": 0},
    "kerning": {"enabledGroupIds": [], "balance": 0, "advancedPairs": {}}
  },
  "rename": {"familyName": "My Custom Serif", "copyright": null, "trademark": null},
  "subset": {"rangeIds": ["basic-latin", "latin-1-supplement"]},
  "formats": ["ttf", "woff2", "otf"]
}

Output directory gets: export.ttf / export.woff2 / export.otf (whichever
were requested) and report.json (ExportReport.summary()).

Stdout contract: exactly one JSON object on the final line —
  success: {"ok": true, "formats": ["ttf", "woff2", "otf"]}
  failure: {"ok": false, "error_type": "OFLComplianceError", "error": "..."}
Exit code is 0 on success, 1 on any failure — but the Node side should
parse stdout's last line rather than rely on the exit code alone, since
that's where the actual error message and type live.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from fontTools.ttLib import TTFont

from .export.pipeline import export_font
from .export.rename import OFLComplianceError
from .google_fonts_repo import FontNotFoundError, LicenseNotAllowedError
from .pipeline import run as fetch_and_freeze
from .structural import apply_transform_recipe


def _emit(payload: dict) -> None:
    print(json.dumps(payload))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--params-file', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        params = json.loads(Path(args.params_file).read_text(encoding='utf-8'))

        family = params.get('family')
        font_file = params.get('font_file')
        if bool(family) == bool(font_file):
            raise ValueError("Exactly one of 'family' or 'font_file' must be provided.")

        if family:
            from io import BytesIO
            fetch_result = fetch_and_freeze(family)  # raises LicenseNotAllowedError / FontNotFoundError
            font = TTFont(BytesIO(fetch_result.static_font_bytes))
        else:
            font = TTFont(font_file)

        recipe = params.get('recipe') or {}
        structural_report = apply_transform_recipe(font, recipe)

        rename = params.get('rename') or {}
        subset = params.get('subset') or {}
        formats = params.get('formats') or ['ttf', 'woff2', 'otf']
        range_ids = subset.get('rangeIds') or ('basic-latin',)

        outputs, export_report = export_font(
            font,
            rename.get('familyName'),
            range_ids=range_ids,
            formats=formats,
            copyright_text=rename.get('copyright'),
            trademark_text=rename.get('trademark'),
            structural_report=structural_report,
        )

        for fmt, data in outputs.items():
            (output_dir / f'export.{fmt}').write_bytes(data)
        (output_dir / 'report.json').write_text(json.dumps(export_report.summary(), indent=2), encoding='utf-8')

        _emit({'ok': True, 'formats': list(outputs.keys())})
        return 0

    except (OFLComplianceError, LicenseNotAllowedError, FontNotFoundError, ValueError) as exc:
        # User-actionable failures — bad input, not a server/pipeline bug.
        _emit({'ok': False, 'error_type': type(exc).__name__, 'error': str(exc)})
        return 1
    except Exception as exc:  # noqa: BLE001 — deliberately broad: this is a CLI boundary, must always emit JSON
        _emit({
            'ok': False,
            'error_type': type(exc).__name__,
            'error': str(exc),
            'traceback': traceback.format_exc(),
        })
        return 1


if __name__ == '__main__':  # pragma: no cover — invoked via `python -m fonts.cli_export`
    sys.exit(main())
