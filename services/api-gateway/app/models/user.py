"""
User and Role models for AeroNet OS RBAC.
Roles follow least-privilege: each role inherits the permissions of those below it.
"""
from enum import Enum
from pydantic import BaseModel
from typing import Optional


class Role(str, Enum):
    VIEWER    = "viewer"     # Read-only: view devices, dashboards
    OPERATOR  = "operator"   # Viewer + trigger scans, acknowledge alerts
    ENGINEER  = "engineer"   # Operator + provision devices, edit inventory
    ADMIN     = "admin"      # Full access including user management


# Permission sets per role — checked in dependencies.py
ROLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.VIEWER:   {"devices:read", "alerts:read",  "dashboard:read"},
    Role.OPERATOR: {"devices:read", "alerts:read",  "alerts:ack",
                    "dashboard:read", "scan:trigger"},
    Role.ENGINEER: {"devices:read", "devices:write", "alerts:read",
                    "alerts:ack",   "dashboard:read", "scan:trigger",
                    "provision:run"},
    Role.ADMIN:    {"devices:read", "devices:write", "alerts:read",
                    "alerts:ack",   "dashboard:read", "scan:trigger",
                    "provision:run", "users:read",   "users:write",
                    "audit:read"},
}


def role_has_permission(role: Role, permission: str) -> bool:
    """Check if a role includes a specific permission string."""
    return permission in ROLE_PERMISSIONS.get(role, set())


class UserBase(BaseModel):
    username: str
    email:    str
    role:     Role
    site_id:  Optional[str] = None    # None = access to all sites (ADMIN only)


class UserInDB(UserBase):
    hashed_password: str
    is_active:       bool = True


class TokenPayload(BaseModel):
    sub:     str        # username
    role:    Role
    site_id: Optional[str] = None
    exp:     int        # Unix timestamp
