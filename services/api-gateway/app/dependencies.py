"""
FastAPI dependency functions for JWT validation and permission enforcement.
Import these in route handlers to protect endpoints.
"""
import os
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from .models.user import Role, TokenPayload, role_has_permission

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM  = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)]
) -> TokenPayload:
    """
    Decode and validate JWT. Raises 401 on any failure.
    Returns the decoded TokenPayload for use in route handlers.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return TokenPayload(**payload)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Token expired",
                            headers={"WWW-Authenticate": "Bearer"})
    except jwt.PyJWTError:
        raise credentials_exception


def require_permission(permission: str):
    """
    Dependency factory. Usage:
        @router.get("/devices", dependencies=[Depends(require_permission("devices:read"))])

    Raises 403 if the authenticated user's role does not include the permission.
    """
    async def _guard(current_user: Annotated[TokenPayload, Depends(get_current_user)]):
        if not role_has_permission(current_user.role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: '{permission}' required",
            )
        return current_user
    return _guard


def require_role(minimum_role: Role):
    """
    Dependency factory for role-level gating (ordered: VIEWER < OPERATOR < ENGINEER < ADMIN).
    Usage:
        @router.delete("/devices/{serial}", dependencies=[Depends(require_role(Role.ADMIN))])
    """
    ROLE_ORDER = [Role.VIEWER, Role.OPERATOR, Role.ENGINEER, Role.ADMIN]

    async def _guard(current_user: Annotated[TokenPayload, Depends(get_current_user)]):
        user_level = ROLE_ORDER.index(current_user.role)
        min_level  = ROLE_ORDER.index(minimum_role)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{minimum_role.value}' or higher required",
            )
        return current_user
    return _guard
