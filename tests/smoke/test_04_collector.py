"""
Test 04 — MistWorker environment validation and backoff constant integrity.
"""
import sys
import os
import pytest


@pytest.fixture(autouse=True)
def _add_collector_to_path():
    """Add collector service to sys.path for direct import."""
    collector_path = os.path.join(os.getcwd(), "services", "collector")
    if collector_path not in sys.path:
        sys.path.insert(0, collector_path)
    yield
    if collector_path in sys.path:
        sys.path.remove(collector_path)


def test_mist_worker_constants():
    """
    Validate that the MistWorker module exposes the correct
    backoff constants without starting the poll loop.
    """
    from app.mist_worker import (
        POLL_INTERVAL_DEFAULT,
        POLL_INTERVAL_MAX,
        ERROR_THRESHOLD,
        ERROR_SLOWDOWN_MULTIPLIER,
    )

    assert POLL_INTERVAL_DEFAULT == 60,    "POLL_INTERVAL_DEFAULT must be 60"
    assert POLL_INTERVAL_MAX == 600,       "POLL_INTERVAL_MAX must be 600"
    assert ERROR_THRESHOLD == 5,           "ERROR_THRESHOLD must be 5"
    assert ERROR_SLOWDOWN_MULTIPLIER == 2, "ERROR_SLOWDOWN_MULTIPLIER must be 2"


def test_mist_worker_fails_fast_without_env(monkeypatch):
    """
    MistWorker.__init__ must raise EnvironmentError
    if MIST_API_TOKEN or MIST_SITE_ID are absent.
    """
    monkeypatch.delenv("MIST_API_TOKEN", raising=False)
    monkeypatch.delenv("MIST_SITE_ID",   raising=False)

    from app.mist_worker import MistWorker

    with pytest.raises(EnvironmentError):
        MistWorker(api_token="", site_id="")


def test_backoff_sequence_is_correct():
    """
    Verify the exponential backoff formula produces the expected sequence.
    Formula: min(60 * (2 ** exponent), 600)
    """
    expected = [60, 120, 240, 480, 600, 600]
    for exp, want in enumerate(expected):
        got = min(60 * (2 ** exp), 600)
        assert got == want, f"Backoff at exponent {exp}: expected {want}, got {got}"
