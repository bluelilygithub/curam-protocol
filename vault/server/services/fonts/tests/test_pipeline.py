"""
Network-hitting integration tests against the real google/fonts GitHub repo,
per the brief: confirm correct detection + freezing for a known variable
font (Roboto Flex) and a known static font (Roboto Slab).
"""

import pytest

from ..font_inspect import inspect_font_bytes
from ..google_fonts_repo import (
    FontNotFoundError,
    LicenseNotAllowedError,
    choose_font_file,
    download_file,
    family_to_slug,
    find_family,
)
from ..pipeline import run


def test_family_to_slug():
    assert family_to_slug("Roboto Flex") == "robotoflex"
    assert family_to_slug("Open Sans") == "opensans"
    assert family_to_slug("Noto Sans JP") == "notosansjp"


@pytest.mark.network
def test_roboto_flex_is_variable_and_freezes():
    result = run("Roboto Flex")

    assert result.license == "OFL"
    assert result.was_variable is True
    assert len(result.original_axes) > 0
    axis_tags = {a.tag for a in result.original_axes}
    assert "wght" in axis_tags  # Roboto Flex has a weight axis at minimum

    # The frozen output must itself be static — no residual fvar.
    frozen_report = inspect_font_bytes(result.static_font_bytes)
    assert frozen_report.is_variable is False


@pytest.mark.network
def test_pacifico_is_static_and_passes_through_unfrozen():
    # Note: Roboto Slab (the brief's suggested static example) is actually
    # Apache-2.0 in the real google/fonts repo, and Merriweather has since
    # gone variable — using Pacifico instead, a known-OFL, known-static
    # family, to exercise the pass-through-without-freezing path.
    result = run("Pacifico")

    assert result.license == "OFL"
    assert result.was_variable is False
    assert result.frozen_axis_values is None

    report = inspect_font_bytes(result.static_font_bytes)
    assert report.is_variable is False


@pytest.mark.network
def test_variable_font_freezes_at_custom_axis_values():
    result = run("Roboto Flex", axis_values={"wght": 700})
    assert result.frozen_axis_values["wght"] == 700

    frozen_report = inspect_font_bytes(result.static_font_bytes)
    assert frozen_report.is_variable is False


@pytest.mark.network
def test_unknown_family_raises_not_found():
    with pytest.raises(FontNotFoundError):
        find_family("Definitely Not A Real Font Family Xyz123")


@pytest.mark.network
def test_non_ofl_family_halts_with_license_not_allowed():
    # Roboto Slab is Apache-2.0 in the real repo — must halt, not proceed.
    with pytest.raises(LicenseNotAllowedError) as exc_info:
        find_family("Roboto Slab")
    assert exc_info.value.license_name == "Apache-2.0"


def test_choose_font_file_prefers_variable_non_italic():
    from ..google_fonts_repo import RepoFile

    files = [
        RepoFile(name="RobotoFlex-Italic[GRAD,opsz,slnt,wdth,wght,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC].ttf", download_url="x"),
        RepoFile(name="RobotoFlex[GRAD,opsz,slnt,wdth,wght,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC].ttf", download_url="y"),
    ]
    chosen = choose_font_file(files)
    assert "Italic" not in chosen.name


def test_choose_font_file_prefers_regular_for_static():
    from ..google_fonts_repo import RepoFile

    files = [
        RepoFile(name="RobotoSlab-Bold.ttf", download_url="x"),
        RepoFile(name="RobotoSlab-Regular.ttf", download_url="y"),
        RepoFile(name="RobotoSlab-Light.ttf", download_url="z"),
    ]
    chosen = choose_font_file(files)
    assert chosen.name == "RobotoSlab-Regular.ttf"
