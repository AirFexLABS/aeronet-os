from enum import Enum
from typing import Optional, Any
from pydantic import BaseModel, field_validator
from datetime import datetime


class CredentialType(str, Enum):
    SSH_PASSWORD       = "ssh_password"
    SSH_KEY            = "ssh_key"
    API_TOKEN          = "api_token"
    SNMP_V2_COMMUNITY  = "snmp_v2_community"
    SNMP_V3            = "snmp_v3"
    TLS_CERT           = "tls_cert"


class VaultCreate(BaseModel):
    name:            str
    credential_type: CredentialType
    scope:           str = "global"
    username:        Optional[str] = None
    secret_value:    str
    metadata:        dict[str, Any] = {}
    tags:            list[str] = []
    expires_at:      Optional[datetime] = None

    @field_validator("secret_value")
    @classmethod
    def secret_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("secret_value cannot be empty")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("name cannot be empty")
        return v


class VaultUpdate(BaseModel):
    name:         Optional[str] = None
    username:     Optional[str] = None
    secret_value: Optional[str] = None
    metadata:     Optional[dict] = None
    tags:         Optional[list[str]] = None
    expires_at:   Optional[datetime] = None
    is_active:    Optional[bool] = None


class VaultEntry(BaseModel):
    """Safe response model — never includes secret_value."""
    id:              str
    name:            str
    credential_type: CredentialType
    scope:           str
    username:        Optional[str]
    metadata:        dict
    tags:            list[str]
    created_by:      str
    created_at:      datetime
    updated_at:      datetime
    last_used_at:    Optional[datetime]
    expires_at:      Optional[datetime]
    is_active:       bool
    is_expired:      bool


class VaultAuditEntry(BaseModel):
    id:             int
    vault_id:       Optional[str]
    action:         str
    performed_by:   str
    source_service: Optional[str]
    ip_address:     Optional[str]
    created_at:     datetime
