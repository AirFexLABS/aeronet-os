"""
Test 16 — Vault credential management.
"""
import pytest
from conftest import API_URL

ADMIN_CREDS = {"username": "admin", "password": "ChangeMe123!"}


def get_token(http):
    r = http.post(f"{API_URL}/auth/token", data=ADMIN_CREDS)
    if r.status_code != 200:
        pytest.skip("Admin credentials not configured")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_vault_list_empty(http):
    auth = get_token(http)
    r = http.get(f"{API_URL}/vault", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_vault_create_ssh_credential(http):
    auth = get_token(http)
    r = http.post(f"{API_URL}/vault", headers=auth, json={
        "name":            "Smoke Test SSH",
        "credential_type": "ssh_password",
        "scope":           "global",
        "username":        "admin",
        "secret_value":    "test-password-123",
        "tags":            ["smoke", "test"],
    })
    assert r.status_code in (200, 201)
    data = r.json()
    assert "id" in data
    assert "secret_value" not in data
    assert "encrypted_value" not in data


def test_vault_secret_never_in_response(http):
    auth = get_token(http)
    # Create
    r = http.post(f"{API_URL}/vault", headers=auth, json={
        "name":            "Secret Leak Test",
        "credential_type": "api_token",
        "scope":           "global",
        "secret_value":    "super-secret-token-xyz",
    })
    assert r.status_code in (200, 201)
    entry_id = r.json()["id"]
    # Get
    r = http.get(f"{API_URL}/vault/{entry_id}", headers=auth)
    response_text = r.text
    assert "super-secret-token-xyz" not in response_text
    assert "encrypted_value" not in response_text
    # List
    r = http.get(f"{API_URL}/vault", headers=auth)
    assert "super-secret-token-xyz" not in r.text


def test_vault_rotate_credential(http):
    auth = get_token(http)
    r = http.post(f"{API_URL}/vault", headers=auth, json={
        "name": "Rotation Test", "credential_type": "ssh_password",
        "scope": "global", "secret_value": "old-password",
    })
    assert r.status_code in (200, 201)
    entry_id = r.json()["id"]
    r = http.post(f"{API_URL}/vault/{entry_id}/rotate",
                  headers=auth, json={"new_secret_value": "new-password"})
    assert r.status_code in (200, 202)


def test_vault_audit_trail_populated(http):
    auth = get_token(http)
    r = http.post(f"{API_URL}/vault", headers=auth, json={
        "name": "Audit Test", "credential_type": "api_token",
        "scope": "global", "secret_value": "audit-test-token",
    })
    assert r.status_code in (200, 201)
    entry_id = r.json()["id"]
    r = http.get(f"{API_URL}/vault/{entry_id}/audit", headers=auth)
    assert r.status_code == 200
    audit = r.json()
    assert len(audit) >= 1
    assert audit[0]["action"] == "created"


def test_vault_delete_soft_deletes(http):
    auth = get_token(http)
    r = http.post(f"{API_URL}/vault", headers=auth, json={
        "name": "Delete Test", "credential_type": "api_token",
        "scope": "global", "secret_value": "delete-me",
    })
    assert r.status_code in (200, 201)
    entry_id = r.json()["id"]
    r = http.delete(f"{API_URL}/vault/{entry_id}", headers=auth)
    assert r.status_code in (200, 204)
    # Verify soft delete — entry still exists but inactive
    r = http.get(f"{API_URL}/vault/{entry_id}", headers=auth)
    assert r.status_code == 200
    assert r.json()["is_active"] is False


def test_vault_filter_by_type(http):
    auth = get_token(http)
    r = http.get(f"{API_URL}/vault?type=ssh_password", headers=auth)
    assert r.status_code == 200
    for entry in r.json():
        assert entry["credential_type"] == "ssh_password"


def test_vault_filter_by_scope(http):
    auth = get_token(http)
    r = http.get(f"{API_URL}/vault?scope=global", headers=auth)
    assert r.status_code == 200
    for entry in r.json():
        assert entry["scope"] == "global"
