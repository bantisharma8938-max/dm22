from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: Literal["student", "teacher"]
    full_name: str = Field(min_length=2, max_length=160)
    student_number: str | None = Field(default=None, min_length=1, max_length=50)
    teacher_invite_code: str | None = Field(default=None, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    purpose: Literal["verify", "reset"] = "verify"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=12, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str


class StudentCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    student_number: str = Field(min_length=1, max_length=50)
    class_id: int


class StudentUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    student_number: str | None = Field(default=None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def require_a_change(self):
        if self.full_name is None and self.student_number is None:
            raise ValueError("Provide a full_name or student_number to update")
        return self


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SubjectCreate(BaseModel):
    class_id: int
    name: str = Field(min_length=1, max_length=120)


class SessionCreate(BaseModel):
    class_id: int
    subject_id: int
    starts_at: datetime
    ends_at: datetime
    late_after: datetime
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_meters: int = Field(ge=10, le=2000)


class GeofenceUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_meters: int = Field(ge=10, le=2000)


class SessionStatusUpdate(BaseModel):
    active: bool


class AttendanceMark(BaseModel):
    session_id: int
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float = Field(gt=0, le=10000)
    liveness_direction: Literal["left", "right"]


class AttendanceCorrection(BaseModel):
    status: Literal["present", "late", "absent"]
    reason: str = Field(min_length=3, max_length=500)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
