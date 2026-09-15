"""
Production cleanup: strip tables that only matter for hinting/legacy
rasterizers most modern renderers ignore, and prune the name table down to
one real locale — rename.py already writes the record we want kept for
each of those.
"""

from __future__ import annotations

DEFAULT_STRIP_TABLES = ('gasp', 'hdmx')

# Windows en-US, and the Mac default (platform 1 / unicode-ish 0 / English 0).
KEEP_NAME_LOCALES = {(3, 1, 0x409), (1, 0, 0)}


def strip_unused_tables(font, tables: tuple[str, ...] = DEFAULT_STRIP_TABLES) -> list[str]:
    removed = []
    for tag in tables:
        if tag in font:
            del font[tag]
            removed.append(tag)
    return removed


def prune_name_table_locales(font, keep=KEEP_NAME_LOCALES) -> tuple[int, int]:
    name_table = font['name']
    before = len(name_table.names)
    name_table.names = [r for r in name_table.names if (r.platformID, r.platEncID, r.langID) in keep]
    after = len(name_table.names)
    return before, after
