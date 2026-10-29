# AI-Based Face Recognition Attendance System

A role-based attendance application for students and teachers. The reference architecture keeps authentication, authorization, geofence evaluation, and biometric comparison on the FastAPI server. Browser GPS is an untrusted signal and must not be treated as proof of physical presence.

## Architecture

```text
React + Vite + Tailwind
        | HTTPS / JSON / multipart
        v
FastAPI ── JWT + Argon2 ── SMTP email OTP
   |       face service (OpenCV YuNet + SFace ONNX)
   |       server-side geofence distance check
   v
PostgreSQL (SQLAlchemy models; database/schema.sql reference schema)
```

The browser captures a face image and requests a location reading. The API validates the session, user role, location accuracy and radius, checks a short head-turn challenge from face landmarks, then compares a server-generated SFace embedding. A movement check is a basic liveness signal, not a guarantee against sophisticated presentation attacks. For production, integrate and validate a dedicated anti-spoofing model and perform a privacy/security review.

## Project structure

```text
face-attendance-system/
├── README.md
├── backend/
│   ├── .env.example
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py
│   │   ├── api/routes.py
│   │   ├── core/{biometric,config,limiter,security}.py
│   │   ├── database/{base.py,session.py,migrations/}
│   │   ├── models/models.py
│   │   ├── schemas/schemas.py
│   │   └── services/{email,face,geo}.py
│   ├── database/schema.sql
│   └── tests/test_geo.py
└── frontend/
    ├── package.json
    ├── index.html
    └── src/{App.jsx,main.jsx,index.css,services/api.js}
```

## Windows setup (VS Code)

Prerequisites: Python 3.11+, Node.js 20+, PostgreSQL 15+, Git (optional), and VS Code with the Python and JavaScript/TypeScript extensions.

1. Open this folder in VS Code. In a PowerShell terminal:

   ```powershell
   cd backend
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   Copy-Item .env.example .env
   ```

   Generate fresh secrets and place them in `backend\.env` (do not commit that file):

   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Use the first value for `JWT_SECRET`, the second for `BIOMETRIC_ENCRYPTION_KEY`, and set a separate strong `TEACHER_REGISTRATION_CODE` to provision teachers.
   Back up the biometric key securely: enrolled embeddings cannot be decrypted if it is lost. Plan and test key rotation by re-encrypting templates before replacing it.

2. Create a PostgreSQL database and user (substitute a strong local password):

   ```sql
   CREATE USER attendance_user WITH PASSWORD 'change-this-local-password';
   CREATE DATABASE attendance OWNER attendance_user;
   ```

   Set `DATABASE_URL` in `backend\.env`, then apply the initial Alembic migration:

   ```powershell
   alembic upgrade head
   ```

   `backend\database\schema.sql` is the equivalent plain PostgreSQL schema for manual review/bootstrap.

3. Download the OpenCV Zoo [YuNet detector](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) and [SFace recognizer](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) ONNX model files from their official repositories. Place them in `backend\models\face_detection_yunet_2023mar.onnx` and `backend\models\face_recognition_sface_2021dec.onnx`, or set `FACE_DETECTION_MODEL` and `FACE_RECOGNITION_MODEL` to their paths. Model files are not included; review their licenses and source before use. The face endpoints return a clear service-unavailable error until both files are installed.

4. Configure a real SMTP server in `backend\.env` for email verification and password reset. The API never returns OTPs in responses. Use HTTPS, a managed secret store, secure database backups, distributed rate limiting, and a validated anti-spoofing model before deployment.

5. Start the API:

   ```powershell
   uvicorn app.main:app --reload
   ```

   Interactive OpenAPI docs: `http://127.0.0.1:8000/docs`.

6. In a second terminal:

   ```powershell
   cd frontend
   npm install
   Copy-Item .env.example .env
   npm run dev
   ```

   Open the Vite URL printed in the terminal. Set `VITE_API_URL` if the API is hosted elsewhere. Browser camera and GPS require `localhost` or HTTPS and user permission.

## API and implementation notes

- Roles are exactly `student` and `teacher`; users must verify their email before login. Student self-registration creates a student profile. Teacher registration requires the `TEACHER_REGISTRATION_CODE` invitation code; keep it private and provision it only through a trusted channel.
- Auth: `POST /api/auth/register`, `/login`, `/verify-otp`, `/forgot-password`; `POST /api/auth/reset-password` completes a reset.
- Faces: `POST /api/faces/register` (student consent required) and `/verify`; `DELETE /api/student/face` revokes and deletes the enrolled template.
- Teacher: `GET /api/teacher/profile`; `POST /api/teacher/students` assigns an existing registered student, `PUT /api/teacher/students/{id}` updates a student in an assigned class, and `GET /api/teacher/students?class_id=...` lists students in an assigned class. Teachers can create classes and subjects, schedule sessions, list/update geofences and activate sessions, filter attendance by student/class/subject/date, and export reports. Students enrolled in a class can discover its active, in-window sessions. Corrections are audited.
- Student: `GET /api/student/attendance/sessions` lists active sessions for the student's enrolled classes that have not yet been marked; `GET /api/student/attendance/challenge/{session_id}` obtains a short-lived server-signed movement challenge; `POST /api/student/attendance/mark`; `GET /api/student/attendance/history`, `/summary`, `/report`; `GET /api/student/profile`; `DELETE /api/student/face` revokes the biometric template.
- Reports return CSV. Teacher corrections are audited; students can only view their own records. A unique database constraint prevents duplicate attendance for a session/student pair.
- Configure at minimum `DATABASE_URL`, `JWT_SECRET`, `BIOMETRIC_ENCRYPTION_KEY`, SMTP settings, teacher invitation code, and model paths. `JWT_SECRET` and the encryption key must be generated securely and must not use the example values.

## Tests

Backend smoke checks:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m compileall app
python -m pytest
```

Use `/docs` to exercise API validation after configuring PostgreSQL and SMTP. End-to-end biometric attendance requires the two model files, a registered/verified student, an assigned class, an active teacher-created session, a camera, and location permission.

## Privacy and operational requirements

Obtain explicit, revocable biometric consent before face enrollment. Restrict model access, encrypt backups and transport, define retention and deletion workflows, and comply with applicable biometric/privacy law. Browser-provided coordinates and accuracy can be spoofed; use additional controls appropriate to the deployment risk. Configure monitoring and external rate limiting before production.
