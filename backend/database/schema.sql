CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('student', 'teacher')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    student_number VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE teachers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE classes (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (teacher_id, name)
);
CREATE TABLE class_students (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    PRIMARY KEY (class_id, student_id)
);
CREATE TABLE subjects (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, name)
);
CREATE TABLE face_embeddings (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    embedding BYTEA NOT NULL,
    consent_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE attendance_sessions (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    late_after TIMESTAMPTZ NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (starts_at < ends_at),
    CHECK (starts_at <= late_after AND late_after <= ends_at)
);
CREATE TABLE geofence_locations (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL UNIQUE REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    radius_meters INTEGER NOT NULL CHECK (radius_meters BETWEEN 10 AND 2000)
);
CREATE TABLE attendance_records (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL CHECK (status IN ('present', 'late', 'absent')),
    marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_accuracy DOUBLE PRECISION,
    UNIQUE (session_id, student_id)
);
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id INTEGER,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE one_time_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verify', 'reset')),
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_classes_teacher_id ON classes(teacher_id);
CREATE INDEX ix_subjects_class_id ON subjects(class_id);
CREATE INDEX ix_sessions_class_time ON attendance_sessions(class_id, starts_at);
CREATE INDEX ix_attendance_student_marked ON attendance_records(student_id, marked_at);
CREATE INDEX ix_audit_actor_created ON audit_logs(actor_user_id, created_at);
CREATE INDEX ix_one_time_codes_lookup ON one_time_codes(email, purpose, created_at);
