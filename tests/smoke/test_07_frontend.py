"""
Test 07 — Frontend static asset serving and white-label theme integrity.
"""
import pytest
from .conftest import FRONTEND_URL


def test_frontend_serves_index(http):
    r = http.get(f"{FRONTEND_URL}/")
    assert r.status_code == 200
    assert '<div id="root">' in r.text, "index.html must contain #root mount point"


def test_frontend_serves_theme_json(http):
    r = http.get(f"{FRONTEND_URL}/theme/theme.json")
    assert r.status_code == 200
    data = r.json()
    assert "brand"  in data, "theme.json must contain 'brand' key"
    assert "colors" in data, "theme.json must contain 'colors' key"
    assert "fonts"  in data, "theme.json must contain 'fonts' key"


def test_theme_json_required_color_keys(http):
    r = http.get(f"{FRONTEND_URL}/theme/theme.json")
    colors = r.json()["colors"]
    required = [
        "--color-primary", "--color-background", "--color-surface",
        "--color-text-primary", "--color-alert-critical", "--color-alert-warning",
    ]
    for key in required:
        assert key in colors, f"theme.json missing required color: {key}"


def test_frontend_spa_routing(http):
    """
    Any deep route must return index.html (SPA try_files fallback).
    """
    r = http.get(f"{FRONTEND_URL}/devices/some-serial-number")
    assert r.status_code == 200
    assert '<div id="root">' in r.text


def test_assets_directory_reachable(http):
    """
    The /assets/ mount must be reachable (even if files aren't present in smoke test).
    A 404 on /assets/ is acceptable; a 502 or 503 is not.
    """
    r = http.get(f"{FRONTEND_URL}/assets/logo.svg")
    assert r.status_code in (200, 404), (
        f"Assets directory unreachable: {r.status_code}"
    )
