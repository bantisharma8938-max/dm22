from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./attendance.db"
    jwt_secret: str = Field(default="dev-jwt-secret-key-at-least-32-bytes", min_length=32)
    jwt_expire_minutes: int = 60
    frontend_origin: str = "http://localhost:5173"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "attendance@example.com"
    smtp_starttls: bool = True
    teacher_registration_code: str = ""
    biometric_encryption_key: str = ""
    face_detection_model: str = "models/face_detection_yunet_2023mar.onnx"
    face_recognition_model: str = "models/face_recognition_sface_2021dec.onnx"
    face_match_threshold: float = Field(default=0.363, gt=0, le=1)
    max_location_accuracy_meters: float = Field(default=100, gt=0)
    otp_expire_minutes: int = Field(default=10, gt=0)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
