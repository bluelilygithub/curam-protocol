"""
Standalone fetch+freeze step (Phase 1, unmodified) for the session cache:
runs once when a font is selected, so the debounced preview endpoint never
re-fetches from GitHub — only cli_export.py's existing `font_file` path
(no fetch, no re-check) runs per preview call, against the bytes this
wrote.

Usage:
    python -m fonts.cli_fetch_freeze --family "Roboto" --output-dir <dir>

Writes <output-dir>/frozen.ttf (static font bytes, ready for repeated
structural edits) and <output-dir>/meta.json. Same one-JSON-line stdout
contract as cli_export.py / cli_catalog.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .google_fonts_repo import FontNotFoundError, LicenseNotAllowedError
from .pipeline import run as fetch_and_freeze


def _emit(payload: dict) -> None:
    print(json.dumps(payload))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--family', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = fetch_and_freeze(args.family)  # raises LicenseNotAllowedError / FontNotFoundError

        (output_dir / 'frozen.ttf').write_bytes(result.static_font_bytes)
        meta = {
            'family': result.family,
            'slug': result.slug,
            'license': result.license,
            'source_file': result.source_file,
            'was_variable': result.was_variable,
            'original_axes': [asdict(a) for a in result.original_axes],
            'frozen_axis_values': result.frozen_axis_values,
        }
        (output_dir / 'meta.json').write_text(json.dumps(meta), encoding='utf-8')

        _emit({'ok': True})
        return 0

    except (LicenseNotAllowedError, FontNotFoundError) as exc:
        _emit({'ok': False, 'error_type': type(exc).__name__, 'error': str(exc)})
        return 1
    except Exception as exc:  # noqa: BLE001 — CLI boundary, must always emit JSON
        _emit({'ok': False, 'error_type': type(exc).__name__, 'error': str(exc)})
        return 1


if __name__ == '__main__':  # pragma: no cover — invoked via `python -m fonts.cli_fetch_freeze`
    sys.exit(main())
