from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.core.config import settings


def _cipher() -> Fernet:
    if not settings.biometric_encryption_key:
        raise HTTPException(status_code=503, detail="Biometric encryption is not configured")
    try:
        return Fernet(settings.biometric_encryption_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise HTTPException(status_code=503, detail="Biometric encryption key is invalid") from exc


def encrypt_embedding(embedding: bytes) -> bytes:
    return _cipher().encrypt(embedding)


def decrypt_embedding(encrypted: bytes) -> bytes:
    try:
        return _cipher().decrypt(encrypted)
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="Stored biometric data could not be decrypted") from exc
