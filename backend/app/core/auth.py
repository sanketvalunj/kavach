from datetime import datetime, timedelta, timezone
from secrets import compare_digest
from typing import Annotated, Literal
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from .config import settings

Role = Literal["OPERATOR", "RESEARCHER"]
bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


class User(BaseModel):
    username: str
    role: Role


def authenticate(username: str, password: str) -> Role | None:
    for role, expected_user, expected_password in (
        ("OPERATOR", settings.operator_username, settings.operator_password),
        ("RESEARCHER", settings.researcher_username, settings.researcher_password),
    ):
        if expected_user and expected_password and compare_digest(username, expected_user) and compare_digest(password, expected_password):
            return role  # type: ignore[return-value]
    return None


def issue_token(username: str, role: Role) -> tuple[str, int]:
    if len(settings.jwt_secret) < 32:
        raise HTTPException(status_code=503, detail="JWT authentication is not configured with a 32-character signing secret")
    expires_in = settings.jwt_expiration_minutes * 60
    token = jwt.encode({"sub": username, "role": role, "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in)}, settings.jwt_secret, algorithm="HS256")
    return token, expires_in


def user_from_token(token: str) -> User | None:
    if len(settings.jwt_secret) < 32:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return User(username=payload["sub"], role=payload["role"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> User:
    if credentials is None or len(settings.jwt_secret) < 32:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required", headers={"WWW-Authenticate": "Bearer"})
    user = user_from_token(credentials.credentials)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}) from None
    return user


def require_roles(*roles: Role):
    def dependency(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This action requires " + " or ".join(roles))
        return user
    return dependency


require_operator = require_roles("OPERATOR", "RESEARCHER")
require_researcher = require_roles("RESEARCHER")
