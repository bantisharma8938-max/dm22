from datetime import datetime, timedelta, timezone
import secrets

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import get_db
from app.models.models import User

password_hash = PasswordHash.recommended()
bearer = HTTPBearer()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": str(user.id), "role": user.role, "exp": expires}, settings.jwt_secret, algorithm="HS256")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc
    user = db.get(User, user_id)
    if user is None or not user.email_verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not available")
    return user


def require_role(role: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role != role:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return dependency


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def create_liveness_challenge(user_id: int, session_id: int, expires_at: datetime) -> tuple[str, str]:
    direction = secrets.choice(("left", "right"))
    expiry = min(datetime.now(timezone.utc) + timedelta(seconds=60), expires_at)
    token = jwt.encode(
        {"sub": str(user_id), "session_id": session_id, "purpose": "liveness", "direction": direction, "exp": expiry},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return token, direction


def validate_liveness_challenge(token: str, user_id: int, session_id: int) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=400, detail="Liveness challenge is invalid or expired") from exc
    if (
        payload.get("purpose") != "liveness"
        or payload.get("sub") != str(user_id)
        or payload.get("session_id") != session_id
        or payload.get("direction") not in {"left", "right"}
    ):
        raise HTTPException(status_code=400, detail="Liveness challenge does not match this user or session")
    return payload["direction"]
