import csv
import io
import hmac
import logging
import smtplib
from datetime import datetime, timedelta, timezone
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.biometric import decrypt_embedding, encrypt_embedding
from app.core.config import settings
from app.core.limiter import limiter
from app.core.security import (
    create_access_token, create_liveness_challenge, generate_otp, hash_password,
    require_role, validate_liveness_challenge, verify_password,
)
from app.database.session import get_db
from app.models.models import (
    AttendanceRecord, AttendanceSession, AuditLog, ClassRoom, ClassStudent,
    FaceEmbedding, GeofenceLocation, OneTimeCode, Student, Subject, Teacher, User,
)
from app.schemas.schemas import (
    AttendanceCorrection, ClassCreate, ForgotPasswordRequest, GeofenceUpdate,
    LoginRequest, RegisterRequest, ResetPasswordRequest, SessionCreate,
    SessionStatusUpdate, StudentCreate, StudentUpdate, SubjectCreate, VerifyOtpRequest,
)
from app.services.email import send_code
from app.services.face import cosine_similarity, detect_and_embed, liveness_direction as check_liveness, read_image
from app.services.geo import distance_meters

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)
student_only = require_role("student")
teacher_only = require_role("teacher")


def _otp(db: Session, email: str, purpose: str) -> str:
    now = datetime.now(timezone.utc)
    db.query(OneTimeCode).filter(OneTimeCode.email == email, OneTimeCode.purpose == purpose).delete()
    code = generate_otp()
    db.add(OneTimeCode(
        email=email,
        purpose=purpose,
        code_hash=hash_password(code),
        expires_at=now + timedelta(minutes=settings.otp_expire_minutes),
    ))
    return code


def _student(db: Session, user: User) -> Student:
    result = db.scalar(select(Student).where(Student.user_id == user.id))
    if result is None:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return result


def _teacher(db: Session, user: User) -> Teacher:
    result = db.scalar(select(Teacher).where(Teacher.user_id == user.id))
    if result is None:
        raise HTTPException(status_code=404, detail="Teacher profile not found")
    return result


def _owned_class(db: Session, class_id: int, teacher_id: int) -> ClassRoom:
    classroom = db.scalar(select(ClassRoom).where(ClassRoom.id == class_id, ClassRoom.teacher_id == teacher_id))
    if classroom is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return classroom


def _audit(db: Session, user_id: int, action: str, entity_type: str, entity_id: int | None, details: dict):
    db.add(AuditLog(actor_user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details))


@router.post("/auth/register", status_code=201)
@limiter.limit("5/minute")
def register(request: Request, payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    if payload.role == "teacher" and (
        not settings.teacher_registration_code
        or not payload.teacher_invite_code
        or not hmac.compare_digest(payload.teacher_invite_code.encode("utf-8"), settings.teacher_registration_code.encode("utf-8"))
    ):
        raise HTTPException(status_code=403, detail="Teacher registration requires a valid invitation code")
    if payload.role == "student" and not payload.student_number:
        raise HTTPException(status_code=422, detail="student_number is required for student registration")
    user = User(email=email, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    db.flush()
    if payload.role == "student":
        db.add(Student(user_id=user.id, student_number=payload.student_number, full_name=payload.full_name))
    else:
        db.add(Teacher(user_id=user.id, full_name=payload.full_name))
    code = _otp(db, email, "verify")
    try:
        send_code(email, code, "email verification")
    except (OSError, RuntimeError, smtplib.SMTPException) as exc:
        db.rollback()
        logger.exception("Could not send account verification email", exc_info=exc)
        raise HTTPException(status_code=503, detail="Email verification could not be sent. Please try again later.") from exc
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or student number is already registered") from exc
    return {"message": "Account created. Check your email for a verification code."}


@router.post("/auth/verify-otp")
@limiter.limit("5/minute")
def verify_otp(request: Request, payload: VerifyOtpRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    record = db.scalar(select(OneTimeCode).where(
        OneTimeCode.email == email, OneTimeCode.purpose == payload.purpose,
    ).order_by(OneTimeCode.created_at.desc()))
    if record is None or record.expires_at < datetime.now(timezone.utc) or not verify_password(payload.code, record.code_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    if payload.purpose == "verify":
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            raise HTTPException(status_code=404, detail="Account not found")
        user.email_verified = True
    db.delete(record)
    db.commit()
    return {"message": "Email verified" if payload.purpose == "verify" else "Code verified"}


@router.post("/auth/login")
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Verify your email before signing in")
    profile = db.scalar(select(Student).where(Student.user_id == user.id)) if user.role == "student" else db.scalar(select(Teacher).where(Teacher.user_id == user.id))
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "role": user.role,
        "full_name": profile.full_name if profile else "",
    }


@router.get("/student/attendance/report")
def student_report(user: User = Depends(student_only), db: Session = Depends(get_db)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["class", "subject", "session_id", "status", "marked_at"])
    for row in student_history(user, db):
        writer.writerow([row["class_name"], row["subject"], row["session_id"], row["status"], row["marked_at"].isoformat()])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=my-attendance.csv"})


@router.post("/auth/forgot-password")
@limiter.limit("3/hour")
def forgot_password(request: Request, payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    if user:
        code = _otp(db, email, "reset")
        try:
            send_code(email, code, "password reset")
            db.commit()
        except (OSError, RuntimeError, smtplib.SMTPException) as exc:
            db.rollback()
            logger.exception("Could not send password reset email", exc_info=exc)
            raise HTTPException(status_code=503, detail="Password reset email could not be sent. Please try again later.") from exc
    return {"message": "If that account exists, a password reset code has been sent."}


@router.post("/auth/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    record = db.scalar(select(OneTimeCode).where(
        OneTimeCode.email == email, OneTimeCode.purpose == "reset",
    ).order_by(OneTimeCode.created_at.desc()))
    if record is None or record.expires_at < datetime.now(timezone.utc) or not verify_password(payload.code, record.code_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")
    user.password_hash = hash_password(payload.new_password)
    db.delete(record)
    db.commit()
    return {"message": "Password changed successfully"}


@router.post("/faces/register")
@limiter.limit("5/minute")
async def register_face(
    request: Request,
    image: Annotated[UploadFile, File()],
    consent: Annotated[bool, Form()],
    user: User = Depends(student_only),
    db: Session = Depends(get_db),
):
    if not consent:
        raise HTTPException(status_code=400, detail="Explicit biometric consent is required")
    student = _student(db, user)
    frame = await read_image(image)
    embedding, _ = detect_and_embed(frame)
    entry = db.scalar(select(FaceEmbedding).where(FaceEmbedding.student_id == student.id))
    consent_at = datetime.now(timezone.utc)
    if entry:
        entry.embedding = encrypt_embedding(embedding.tobytes())
        entry.consent_at = consent_at
    else:
        db.add(FaceEmbedding(student_id=student.id, embedding=encrypt_embedding(embedding.tobytes()), consent_at=consent_at))
    _audit(db, user.id, "face_registered", "student", student.id, {"consent": True})
    db.commit()
    return {"message": "Face registration completed"}


@router.post("/faces/verify")
@limiter.limit("10/minute")
async def verify_face(
    request: Request,
    image: Annotated[UploadFile, File()],
    user: User = Depends(student_only),
    db: Session = Depends(get_db),
):
    student = _student(db, user)
    stored = db.scalar(select(FaceEmbedding).where(FaceEmbedding.student_id == student.id))
    if stored is None:
        raise HTTPException(status_code=409, detail="Register your face before attendance")
    frame = await read_image(image)
    embedding, _ = detect_and_embed(frame)
    score = cosine_similarity(decrypt_embedding(stored.embedding), embedding)
    if score < settings.face_match_threshold:
        raise HTTPException(status_code=403, detail="Face verification failed")
    return {"verified": True, "message": "Face verified successfully"}


@router.get("/student/profile")
def student_profile(user: User = Depends(student_only), db: Session = Depends(get_db)):
    student = _student(db, user)
    return {"full_name": student.full_name, "email": user.email, "student_number": student.student_number}


@router.delete("/student/face")
def delete_student_face(user: User = Depends(student_only), db: Session = Depends(get_db)):
    student = _student(db, user)
    entry = db.scalar(select(FaceEmbedding).where(FaceEmbedding.student_id == student.id))
    if entry is None:
        return {"message": "No enrolled face data exists"}
    db.delete(entry)
    _audit(db, user.id, "face_deleted", "student", student.id, {"consent_revoked": True})
    db.commit()
    return {"message": "Enrolled face data deleted"}


@router.get("/student/attendance/sessions")
def student_active_attendance_sessions(user: User = Depends(student_only), db: Session = Depends(get_db)):
    student = _student(db, user)
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(AttendanceSession, ClassRoom, Subject)
        .join(ClassStudent, ClassStudent.class_id == AttendanceSession.class_id)
        .join(ClassRoom, ClassRoom.id == AttendanceSession.class_id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .outerjoin(
            AttendanceRecord,
            (AttendanceRecord.session_id == AttendanceSession.id)
            & (AttendanceRecord.student_id == student.id),
        )
        .where(
            ClassStudent.student_id == student.id,
            AttendanceSession.active.is_(True),
            AttendanceSession.starts_at <= now,
            AttendanceSession.ends_at >= now,
            AttendanceRecord.id.is_(None),
        )
        .order_by(AttendanceSession.starts_at.desc())
    ).all()
    return [{
        "id": session.id,
        "class_name": classroom.name,
        "subject_name": subject.name,
        "starts_at": session.starts_at,
        "ends_at": session.ends_at,
    } for session, classroom, subject in rows]


@router.post("/teacher/classes", status_code=201)
def create_class(payload: ClassCreate, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    classroom = ClassRoom(teacher_id=teacher.id, name=payload.name.strip())
    db.add(classroom)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A class with this name already exists") from exc
    db.refresh(classroom)
    return {"id": classroom.id, "name": classroom.name}


@router.get("/teacher/classes")
def list_classes(user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    classes = db.scalars(select(ClassRoom).where(ClassRoom.teacher_id == teacher.id).order_by(ClassRoom.name)).all()
    return [{"id": item.id, "name": item.name} for item in classes]


@router.get("/teacher/profile")
def teacher_profile(user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    return {"full_name": teacher.full_name, "email": user.email}


@router.post("/teacher/subjects", status_code=201)
def create_subject(payload: SubjectCreate, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    _owned_class(db, payload.class_id, teacher.id)
    subject = Subject(teacher_id=teacher.id, class_id=payload.class_id, name=payload.name.strip())
    db.add(subject)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This subject already exists in the class") from exc
    db.refresh(subject)
    return {"id": subject.id, "class_id": subject.class_id, "name": subject.name}


@router.get("/teacher/subjects")
def list_subjects(class_id: int | None = None, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    query = select(Subject).where(Subject.teacher_id == teacher.id)
    if class_id is not None:
        query = query.where(Subject.class_id == class_id)
    return [{"id": item.id, "class_id": item.class_id, "name": item.name} for item in db.scalars(query.order_by(Subject.name)).all()]


@router.post("/teacher/students", status_code=201)
def assign_student(payload: StudentCreate, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    classroom = _owned_class(db, payload.class_id, teacher.id)
    student = db.scalar(select(Student).join(User).where(User.email == payload.email.lower()))
    if student is None or student.full_name != payload.full_name or student.student_number != payload.student_number:
        raise HTTPException(status_code=404, detail="A registered student matching this email, name, and student number was not found")
    membership = db.get(ClassStudent, {"class_id": classroom.id, "student_id": student.id})
    if membership:
        raise HTTPException(status_code=409, detail="Student is already assigned to this class")
    db.add(ClassStudent(class_id=classroom.id, student_id=student.id))
    db.commit()
    return {"message": "Student assigned to class"}


@router.get("/teacher/students")
def list_students(class_id: int, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    _owned_class(db, class_id, teacher.id)
    rows = db.execute(
        select(Student, User.email)
        .join(ClassStudent, ClassStudent.student_id == Student.id)
        .join(User, User.id == Student.user_id)
        .where(ClassStudent.class_id == class_id)
        .order_by(Student.full_name)
    ).all()
    return [{
        "id": student.id, "full_name": student.full_name,
        "student_number": student.student_number, "email": email,
    } for student, email in rows]


@router.put("/teacher/students/{student_id}")
def update_student(
    student_id: int,
    payload: StudentUpdate,
    user: User = Depends(teacher_only),
    db: Session = Depends(get_db),
):
    teacher = _teacher(db, user)
    student = db.scalar(
        select(Student)
        .join(ClassStudent, ClassStudent.student_id == Student.id)
        .join(ClassRoom, ClassRoom.id == ClassStudent.class_id)
        .where(Student.id == student_id, ClassRoom.teacher_id == teacher.id)
    )
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found in your classes")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    previous = {"full_name": student.full_name, "student_number": student.student_number}
    for field, value in changes.items():
        setattr(student, field, value)
    _audit(db, user.id, "student_updated", "student", student.id, {
        "previous": previous, "updated": changes,
    })
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Student number is already in use") from exc
    return {"message": "Student record updated"}


@router.post("/teacher/attendance-sessions", status_code=201)
def create_attendance_session(payload: SessionCreate, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    _owned_class(db, payload.class_id, teacher.id)
    subject = db.scalar(select(Subject).where(
        Subject.id == payload.subject_id, Subject.class_id == payload.class_id, Subject.teacher_id == teacher.id,
    ))
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found in the selected class")
    starts = payload.starts_at
    ends = payload.ends_at
    late = payload.late_after
    if starts.tzinfo is None or ends.tzinfo is None or late.tzinfo is None:
        raise HTTPException(status_code=422, detail="Session times must include a timezone")
    if not starts < ends or not starts <= late <= ends:
        raise HTTPException(status_code=422, detail="Session must start before it ends and late_after must be within the session")
    session = AttendanceSession(teacher_id=teacher.id, class_id=payload.class_id, subject_id=subject.id, starts_at=starts, ends_at=ends, late_after=late)
    db.add(session)
    db.flush()
    db.add(GeofenceLocation(session_id=session.id, latitude=payload.latitude, longitude=payload.longitude, radius_meters=payload.radius_meters))
    _audit(db, user.id, "session_created", "attendance_session", session.id, {"class_id": session.class_id, "subject_id": subject.id})
    db.commit()
    return {"id": session.id, "active": session.active, "starts_at": starts, "ends_at": ends}


@router.put("/teacher/attendance-sessions/{session_id}/geofence")
def update_geofence(session_id: int, payload: GeofenceUpdate, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    session = db.scalar(select(AttendanceSession).where(AttendanceSession.id == session_id, AttendanceSession.teacher_id == teacher.id))
    if session is None:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    location = db.scalar(select(GeofenceLocation).where(GeofenceLocation.session_id == session.id))
    if location is None:
        location = GeofenceLocation(session_id=session.id, **payload.model_dump())
        db.add(location)
    else:
        location.latitude = payload.latitude
        location.longitude = payload.longitude
        location.radius_meters = payload.radius_meters
    _audit(db, user.id, "geofence_updated", "attendance_session", session.id, payload.model_dump())
    db.commit()
    return {"message": "Geofence updated"}


@router.get("/teacher/attendance-sessions")
def list_attendance_sessions(user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    rows = db.execute(
        select(AttendanceSession, ClassRoom, Subject, GeofenceLocation)
        .join(ClassRoom, ClassRoom.id == AttendanceSession.class_id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .outerjoin(GeofenceLocation, GeofenceLocation.session_id == AttendanceSession.id)
        .where(AttendanceSession.teacher_id == teacher.id)
        .order_by(AttendanceSession.starts_at.desc())
    ).all()
    return [{
        "id": session.id, "class_id": classroom.id, "class_name": classroom.name,
        "subject_id": subject.id, "subject_name": subject.name,
        "starts_at": session.starts_at, "ends_at": session.ends_at,
        "late_after": session.late_after, "active": session.active,
        "latitude": location.latitude if location else None,
        "longitude": location.longitude if location else None,
        "radius_meters": location.radius_meters if location else None,
    } for session, classroom, subject, location in rows]


@router.put("/teacher/attendance-sessions/{session_id}/status")
def update_session_status(
    session_id: int,
    payload: SessionStatusUpdate,
    user: User = Depends(teacher_only),
    db: Session = Depends(get_db),
):
    teacher = _teacher(db, user)
    session = db.scalar(select(AttendanceSession).where(
        AttendanceSession.id == session_id, AttendanceSession.teacher_id == teacher.id,
    ))
    if session is None:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    session.active = payload.active
    _audit(db, user.id, "session_status_updated", "attendance_session", session.id, {"active": payload.active})
    db.commit()
    return {"message": "Session status updated", "active": session.active}


@router.get("/teacher/attendance")
def teacher_attendance(
    session_id: int | None = None,
    class_id: int | None = None,
    subject_id: int | None = None,
    date: datetime | None = None,
    search: str | None = None,
    user: User = Depends(teacher_only),
    db: Session = Depends(get_db),
):
    teacher = _teacher(db, user)
    query = select(AttendanceRecord, Student, AttendanceSession).join(Student).join(AttendanceSession).join(Subject).where(AttendanceSession.teacher_id == teacher.id)
    if session_id is not None:
        query = query.where(AttendanceSession.id == session_id)
    if class_id is not None:
        query = query.where(AttendanceSession.class_id == class_id)
    if subject_id is not None:
        query = query.where(AttendanceSession.subject_id == subject_id)
    if date is not None:
        query = query.where(func.date(AttendanceSession.starts_at) == date.date())
    if search:
        query = query.where(Student.full_name.ilike(f"%{search.strip()}%"))
    rows = db.execute(query.order_by(AttendanceRecord.marked_at.desc())).all()
    results = [{
        "student_id": student.id,
        "record_id": record.id, "student": student.full_name, "student_number": student.student_number,
        "class_name": db.get(ClassRoom, session.class_id).name,
        "subject_name": db.get(Subject, session.subject_id).name,
        "session_id": session.id, "class_id": session.class_id, "subject_id": session.subject_id,
        "status": record.status, "marked_at": record.marked_at,
    } for record, student, session in rows]
    sessions_query = select(AttendanceSession).where(AttendanceSession.teacher_id == teacher.id)
    if session_id is not None:
        sessions_query = sessions_query.where(AttendanceSession.id == session_id)
    if class_id is not None:
        sessions_query = sessions_query.where(AttendanceSession.class_id == class_id)
    if subject_id is not None:
        sessions_query = sessions_query.where(AttendanceSession.subject_id == subject_id)
    if date is not None:
        sessions_query = sessions_query.where(func.date(AttendanceSession.starts_at) == date.date())
    now = datetime.now(timezone.utc)
    for session in db.scalars(sessions_query).all():
        if not session.active or session.ends_at >= now:
            continue
        enrolled_query = (
            select(Student)
            .join(ClassStudent, ClassStudent.student_id == Student.id)
            .join(User, User.id == Student.user_id)
            .outerjoin(AttendanceRecord, (AttendanceRecord.student_id == Student.id) & (AttendanceRecord.session_id == session.id))
            .where(ClassStudent.class_id == session.class_id, AttendanceRecord.id.is_(None))
        )
        if search:
            enrolled_query = enrolled_query.where(Student.full_name.ilike(f"%{search.strip()}%"))
        for student in db.scalars(enrolled_query).all():
            results.append({
                "student_id": student.id, "record_id": None, "student": student.full_name,
                "student_number": student.student_number, "class_name": db.get(ClassRoom, session.class_id).name,
                "subject_name": db.get(Subject, session.subject_id).name, "session_id": session.id,
                "class_id": session.class_id, "subject_id": session.subject_id,
                "status": "absent", "marked_at": session.ends_at,
            })
    results.sort(key=lambda item: item["marked_at"], reverse=True)
    return results


@router.put("/teacher/attendance/{record_id}")
def correct_attendance(record_id: int, payload: AttendanceCorrection, user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    record = db.scalar(select(AttendanceRecord).join(AttendanceSession).where(
        AttendanceRecord.id == record_id, AttendanceSession.teacher_id == teacher.id,
    ))
    if record is None:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    previous = record.status
    record.status = payload.status
    _audit(db, user.id, "attendance_corrected", "attendance_record", record.id, {
        "previous_status": previous, "new_status": payload.status, "reason": payload.reason,
    })
    db.commit()
    return {"message": "Attendance updated", "status": record.status}


@router.put("/teacher/attendance-sessions/{session_id}/students/{student_id}")
def correct_unmarked_attendance(
    session_id: int,
    student_id: int,
    payload: AttendanceCorrection,
    user: User = Depends(teacher_only),
    db: Session = Depends(get_db),
):
    teacher = _teacher(db, user)
    session = db.scalar(select(AttendanceSession).where(
        AttendanceSession.id == session_id, AttendanceSession.teacher_id == teacher.id,
    ))
    if session is None:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    if db.scalar(select(ClassStudent.class_id).where(
        ClassStudent.class_id == session.class_id, ClassStudent.student_id == student_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Student is not enrolled in this class")
    record = db.scalar(select(AttendanceRecord).where(
        AttendanceRecord.session_id == session.id, AttendanceRecord.student_id == student_id,
    ))
    previous = record.status if record else "absent"
    if record:
        record.status = payload.status
    else:
        record = AttendanceRecord(session_id=session.id, student_id=student_id, status=payload.status)
        db.add(record)
    db.flush()
    _audit(db, user.id, "attendance_corrected", "attendance_record", record.id, {
        "previous_status": previous, "new_status": payload.status, "reason": payload.reason,
    })
    db.commit()
    return {"message": "Attendance updated", "status": record.status}


@router.get("/student/attendance/challenge/{session_id}")
def attendance_challenge(
    session_id: int,
    user: User = Depends(student_only),
    db: Session = Depends(get_db),
):
    student = _student(db, user)
    session = db.get(AttendanceSession, session_id)
    now = datetime.now(timezone.utc)
    if session is None or not session.active or now < session.starts_at or now > session.ends_at:
        raise HTTPException(status_code=410, detail="Attendance session has expired or is not active")
    if db.scalar(select(ClassStudent.class_id).where(
        ClassStudent.class_id == session.class_id, ClassStudent.student_id == student.id,
    )) is None:
        raise HTTPException(status_code=403, detail="You are not enrolled in this class")
    token, direction = create_liveness_challenge(user.id, session.id, session.ends_at)
    return {"challenge_token": token, "direction": direction, "expires_in_seconds": 60}


@router.post("/student/attendance/mark", status_code=201)
@limiter.limit("5/minute")
async def mark_attendance(
    request: Request,
    session_id: Annotated[int, Form()],
    latitude: Annotated[float, Form(ge=-90, le=90)],
    longitude: Annotated[float, Form(ge=-180, le=180)],
    accuracy: Annotated[float, Form(gt=0, le=10000)],
    challenge_token: Annotated[str, Form()],
    images: Annotated[list[UploadFile], File()],
    user: User = Depends(student_only),
    db: Session = Depends(get_db),
):
    student = _student(db, user)
    attendance_session = db.get(AttendanceSession, session_id)
    now = datetime.now(timezone.utc)
    if attendance_session is None or not attendance_session.active or now < attendance_session.starts_at or now > attendance_session.ends_at:
        raise HTTPException(status_code=410, detail="Attendance session has expired or is not active")
    enrolled = db.scalar(select(ClassStudent.class_id).where(
        ClassStudent.class_id == attendance_session.class_id, ClassStudent.student_id == student.id,
    ))
    if enrolled is None:
        raise HTTPException(status_code=403, detail="You are not enrolled in this class")
    if db.scalar(select(AttendanceRecord.id).where(
        AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == student.id,
    )):
        raise HTTPException(status_code=409, detail="Attendance has already been marked")
    location = db.scalar(select(GeofenceLocation).where(GeofenceLocation.session_id == session_id))
    if location is None:
        raise HTTPException(status_code=503, detail="Attendance location has not been configured")
    if accuracy > settings.max_location_accuracy_meters:
        raise HTTPException(status_code=400, detail="Location accuracy is too low. Try again outdoors.")
    distance = distance_meters(latitude, longitude, location.latitude, location.longitude)
    if distance > location.radius_meters:
        raise HTTPException(status_code=403, detail="You are outside the permitted radius")
    if len(images) < 3 or len(images) > 8:
        raise HTTPException(status_code=400, detail="Capture 3 to 8 frames for the movement liveness check")
    challenge_direction = validate_liveness_challenge(challenge_token, user.id, session_id)
    stored = db.scalar(select(FaceEmbedding).where(FaceEmbedding.student_id == student.id))
    if stored is None:
        raise HTTPException(status_code=409, detail="Register your face before attendance")
    embeddings = []
    landmarks = []
    for image in images:
        frame = await read_image(image)
        vector, points = detect_and_embed(frame)
        embeddings.append(vector)
        landmarks.append(points)
    if not check_liveness(landmarks, challenge_direction):
        raise HTTPException(status_code=403, detail="Liveness check failed. Follow the on-screen head movement and try again.")
    scores = [cosine_similarity(decrypt_embedding(stored.embedding), item) for item in embeddings]
    if float(np.median(scores)) < settings.face_match_threshold:
        raise HTTPException(status_code=403, detail="Face verification failed")
    record = AttendanceRecord(
        session_id=session_id,
        student_id=student.id,
        status="late" if now > attendance_session.late_after else "present",
        latitude=latitude,
        longitude=longitude,
        location_accuracy=accuracy,
    )
    db.add(record)
    _audit(db, user.id, "attendance_marked", "attendance_record", None, {
        "session_id": session_id, "accuracy_meters": accuracy, "reported_distance_meters": round(distance, 1),
        "signal_note": "Browser-provided location is not proof of physical presence.",
    })
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Attendance has already been marked") from exc
    return {"message": "Attendance marked successfully", "status": record.status, "face_verified": True, "location_verified": True}


@router.get("/student/attendance/history")
def student_history(user: User = Depends(student_only), db: Session = Depends(get_db)):
    student = _student(db, user)
    rows = db.execute(
        select(AttendanceRecord, AttendanceSession, Subject, ClassRoom)
        .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .join(ClassRoom, ClassRoom.id == AttendanceSession.class_id)
        .where(AttendanceRecord.student_id == student.id)
        .order_by(AttendanceRecord.marked_at.desc())
    ).all()
    history = [{
        "id": record.id, "subject": subject.name, "class_name": classroom.name, "status": record.status,
        "marked_at": record.marked_at, "session_id": session.id,
    } for record, session, subject, classroom in rows]
    missing = db.execute(
        select(AttendanceSession, Subject, ClassRoom)
        .join(ClassStudent, ClassStudent.class_id == AttendanceSession.class_id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .join(ClassRoom, ClassRoom.id == AttendanceSession.class_id)
        .outerjoin(AttendanceRecord, (AttendanceRecord.session_id == AttendanceSession.id) & (AttendanceRecord.student_id == student.id))
        .where(
            ClassStudent.student_id == student.id,
            AttendanceSession.ends_at < datetime.now(timezone.utc),
            AttendanceSession.active.is_(True),
            AttendanceRecord.id.is_(None),
        )
    ).all()
    history.extend({
        "id": f"absent-{session.id}", "subject": subject.name, "class_name": classroom.name,
        "status": "absent", "marked_at": session.ends_at, "session_id": session.id,
    } for session, subject, classroom in missing)
    history.sort(key=lambda item: item["marked_at"], reverse=True)
    return history


@router.get("/student/attendance/summary")
def student_summary(user: User = Depends(student_only), db: Session = Depends(get_db)):
    student = _student(db, user)
    rows = db.execute(
        select(
            Subject.name,
            func.count(AttendanceSession.id),
            func.sum(case((AttendanceRecord.status.in_(("present", "late")), 1), else_=0)),
        )
        .join(AttendanceSession, AttendanceSession.subject_id == Subject.id)
        .join(ClassStudent, ClassStudent.class_id == AttendanceSession.class_id)
        .outerjoin(AttendanceRecord, (AttendanceRecord.session_id == AttendanceSession.id) & (AttendanceRecord.student_id == student.id))
        .where(ClassStudent.student_id == student.id, AttendanceSession.ends_at < datetime.now(timezone.utc), AttendanceSession.active.is_(True))
        .group_by(Subject.name)
    ).all()
    present, total = 0, 0
    for session_total, attended in db.execute(
        select(
            func.count(AttendanceSession.id),
            func.sum(case((AttendanceRecord.status.in_(("present", "late")), 1), else_=0)),
        )
        .join(ClassStudent, ClassStudent.class_id == AttendanceSession.class_id)
        .outerjoin(AttendanceRecord, (AttendanceRecord.session_id == AttendanceSession.id) & (AttendanceRecord.student_id == student.id))
        .where(ClassStudent.student_id == student.id, AttendanceSession.ends_at < datetime.now(timezone.utc), AttendanceSession.active.is_(True))
    ).all():
        total, present = session_total or 0, attended or 0
    return {
        "present": present, "absent": total - present,
        "percentage": round(100 * present / total, 1) if total else 0,
        "total_sessions": total,
        "subjects": [{
            "subject": name, "attended": attended or 0, "total": count,
            "percentage": round(100 * (attended or 0) / count, 1) if count else 0,
        } for name, count, attended in rows],
    }


@router.get("/teacher/analytics")
def teacher_analytics(user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    teacher = _teacher(db, user)
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(ClassRoom.id, ClassRoom.name, func.count(ClassStudent.student_id),
               func.sum(case((AttendanceRecord.status.in_(("present", "late")), 1), else_=0)))
        .outerjoin(AttendanceSession, and_(
            AttendanceSession.class_id == ClassRoom.id,
            AttendanceSession.ends_at < now,
            AttendanceSession.active.is_(True),
        ))
        .outerjoin(ClassStudent, ClassStudent.class_id == AttendanceSession.class_id)
        .outerjoin(AttendanceRecord, and_(
            AttendanceRecord.session_id == AttendanceSession.id,
            AttendanceRecord.student_id == ClassStudent.student_id,
        ))
        .where(ClassRoom.teacher_id == teacher.id)
        .group_by(ClassRoom.id, ClassRoom.name)
    ).all()
    student_counts = dict(db.execute(
        select(ClassStudent.class_id, func.count(ClassStudent.student_id))
        .join(ClassRoom, ClassRoom.id == ClassStudent.class_id)
        .where(ClassRoom.teacher_id == teacher.id)
        .group_by(ClassStudent.class_id)
    ).all())
    return [{
        "class_id": class_id, "class_name": name, "expected_checkins": total or 0,
        "present_records": present or 0,
        "student_count": student_counts.get(class_id, 0),
        "attendance_rate": round(100 * (present or 0) / total, 1) if total else 0,
    } for class_id, name, total, present in rows]


@router.get("/teacher/reports")
def teacher_reports(user: User = Depends(teacher_only), db: Session = Depends(get_db)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["student", "student_number", "class", "subject", "session_id", "status", "marked_at"])
    for row in teacher_attendance(user=user, db=db):
        writer.writerow([row["student"], row["student_number"], row["class_name"], row["subject_name"], row["session_id"], row["status"], row["marked_at"].isoformat()])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=attendance-report.csv"})
