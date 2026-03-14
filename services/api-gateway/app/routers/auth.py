"""
Auth router: login -> JWT token issuance.
Tokens are signed with SECRET_KEY (HS256), expire after ACCESS_TOKEN_EXPIRE_MINUTES.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated
import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
import jwt
from passlib.context import CryptContext

from ..models.user import Role, TokenPayload, UserInDB
from .. import db

router = APIRouter(prefix="/auth", tags=["auth"])

SECRET_KEY                  = os.environ["SECRET_KEY"]
ALGORITHM                   = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(username: str, role: Role, site_id: str | None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = TokenPayload(
        sub=username, role=role, site_id=site_id,
        exp=int(expire.timestamp())
    )
    return jwt.encode(payload.model_dump(), SECRET_KEY, algorithm=ALGORITHM)


async def get_user_from_db(username: str) -> UserInDB | None:
    """Fetch user record from the users table."""
    pool = await db.get_pool()
    row = await pool.fetchrow(
        "SELECT username, email, role, hashed_password, site_id, is_active "
        "FROM users WHERE username = $1",
        username,
    )
    if row is None:
        return None
    return UserInDB(
        username=row["username"],
        email=row["email"],
        role=Role(row["role"]),
        hashed_password=row["hashed_password"],
        site_id=row["site_id"],
        is_active=row["is_active"],
    )


@router.post("/token")
async def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    """
    Exchange username + password for a signed JWT.
    Returns: {"access_token": "...", "token_type": "bearer"}
    Raises 401 if credentials are invalid or user is inactive.
    """
    user = await get_user_from_db(form.username)
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Account disabled")

    token = create_access_token(user.username, user.role, user.site_id)
    return {"access_token": token, "token_type": "bearer"}
