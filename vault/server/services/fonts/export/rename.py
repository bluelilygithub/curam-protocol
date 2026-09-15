"""
OFL Reserved Font Name compliance: rewrite name table IDs 1/4/6, insert a
Copyright line, adjust the Trademark field — and refuse to export at all
if the family name wasn't actually changed from the original, since
redistributing an OFL font under its Reserved Font Name is exactly what
the license's RFN clause exists to prevent.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

# (platformID, platEncID, langID) records we actively (re)write — Windows
# en-US and the Mac default locale, matching cleanup.py's kept locales.
TARGET_LOCALES = ((3, 1, 0x409), (1, 0, 0))


class OFLComplianceError(Exception):
    """Raised to block export — never caught silently by this module."""


@dataclass
class RenameReport:
    original_family: str
    new_family: str
    full_name: str
    postscript_name: str
    copyright: str
    trademark: str


def get_family_name(font) -> str:
    name_table = font['name']
    return (name_table.getDebugName(1) or name_table.getDebugName(16) or '').strip()


def _sanitize_postscript_name(family: str) -> str:
    cleaned = re.sub(r'[^A-Za-z0-9-]', '', family)
    return cleaned[:63] or 'CustomFont'


def rename_for_ofl(
    font,
    new_family_name: str,
    copyright_text: str | None = None,
    trademark_text: str | None = None,
) -> RenameReport:
    """
    Mutates `font['name']` in place. Raises OFLComplianceError (export
    must be blocked by the caller) if `new_family_name` is empty or
    unchanged from the font's current family name.
    """
    original_family = get_family_name(font)
    new_family_name = (new_family_name or '').strip()

    if not new_family_name:
        raise OFLComplianceError("A new family name is required before export.")
    if new_family_name.casefold() == original_family.casefold():
        raise OFLComplianceError(
            f"New family name ('{new_family_name}') matches the original ('{original_family}'). "
            f"OFL's Reserved Font Name clause requires a genuinely different name before redistributing "
            f"a modified font — export blocked."
        )

    full_name = f"{new_family_name} Regular"
    postscript_name = _sanitize_postscript_name(new_family_name)
    copyright_text = copyright_text or (
        f"Copyright {date.today().year} {new_family_name}. Derived from an OFL-licensed font and "
        f"redistributed under the SIL Open Font License, Version 1.1."
    )
    trademark_text = trademark_text or (
        f"{new_family_name} is an independently modified derivative work and is not affiliated with "
        f"or endorsed by the original typeface's foundry."
    )

    name_table = font['name']
    for plat_id, enc_id, lang_id in TARGET_LOCALES:
        name_table.setName(copyright_text, 0, plat_id, enc_id, lang_id)
        name_table.setName(new_family_name, 1, plat_id, enc_id, lang_id)
        name_table.setName(full_name, 4, plat_id, enc_id, lang_id)
        name_table.setName(postscript_name, 6, plat_id, enc_id, lang_id)
        name_table.setName(trademark_text, 7, plat_id, enc_id, lang_id)
        # Typographic family/subfamily, if the source font used them, stay in sync.
        if name_table.getDebugName(16) or name_table.getDebugName(17):
            name_table.setName(new_family_name, 16, plat_id, enc_id, lang_id)
            name_table.setName('Regular', 17, plat_id, enc_id, lang_id)

    return RenameReport(
        original_family=original_family,
        new_family=new_family_name,
        full_name=full_name,
        postscript_name=postscript_name,
        copyright=copyright_text,
        trademark=trademark_text,
    )
