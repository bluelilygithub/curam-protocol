"""
Catalog builder tests: OFL filtering must exclude a known non-OFL family
(Roboto Slab, per the Phase 1 finding) and use exactly the same rule
find_family() uses (list_ofl_family_slugs()), not a separate heuristic.
"""

import pytest

from ..cli_catalog import build_catalog
from ..google_fonts_repo import family_to_slug, list_ofl_family_slugs


@pytest.mark.network
def test_list_ofl_family_slugs_matches_find_family_for_known_cases():
    slugs = list_ofl_family_slugs()
    assert family_to_slug("PT Serif") in slugs        # OFL — confirmed in Phase 1
    assert family_to_slug("Roboto Slab") not in slugs  # Apache-2.0 — confirmed in Phase 1
    assert len(slugs) > 1000  # sanity: this is the whole-catalog set, not a handful


@pytest.mark.network
def test_catalog_excludes_known_non_ofl_family():
    catalog = build_catalog()
    families = {f["family"] for f in catalog}
    assert "Roboto Slab" not in families, "Roboto Slab is Apache-2.0 and must not be selectable"
    assert "PT Serif" in families


@pytest.mark.network
def test_catalog_flags_variable_vs_static_correctly():
    catalog = build_catalog()
    by_family = {f["family"]: f for f in catalog}

    roboto_flex = by_family.get("Roboto Flex")
    assert roboto_flex is not None
    assert roboto_flex["isVariable"] is True
    assert "wght" in roboto_flex["axisTags"]

    pt_serif = by_family.get("PT Serif")
    assert pt_serif is not None
    assert pt_serif["isVariable"] is False
    assert pt_serif["axisTags"] == []


@pytest.mark.network
def test_catalog_entries_have_required_fields():
    catalog = build_catalog()
    assert len(catalog) > 500
    for entry in catalog[:50]:
        assert entry["family"]
        assert entry["slug"] == family_to_slug(entry["family"])
        assert entry["category"]
        assert isinstance(entry["isVariable"], bool)
        assert isinstance(entry["axisTags"], list)
