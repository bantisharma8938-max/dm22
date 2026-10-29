import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, Bell, BookOpen, CalendarDays,
  Camera, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, Compass, Download,
  Fingerprint, GraduationCap, LayoutDashboard, LocateFixed, LogOut, MapPin, Menu,
  Moon, Plus, Search, ShieldCheck, Sun, Users, X,
} from "lucide-react";
import { api, json } from "./services/api";

const initialAuth = () => {
  try { return JSON.parse(sessionStorage.getItem("attendance_user") || "null"); }
  catch { return null; }
};

function App() {
  const [user, setUser] = useState(initialAuth);
  const [dark, setDark] = useState(() => localStorage.getItem("attendance_theme") === "dark");
  const [page, setPage] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("attendance_theme", dark ? "dark" : "light");
  }, [dark]);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3800);
  }, []);

  function signOut() {
    sessionStorage.removeItem("attendance_token");
    sessionStorage.removeItem("attendance_user");
    setUser(null);
    setPage("Overview");
  }

  if (!user) return <AuthPage onLogin={setUser} notify={notify} />;
  const teacher = user.role === "teacher";
  const nav = teacher
    ? [["Overview", LayoutDashboard], ["Classes", Users], ["Sessions", CalendarDays], ["Attendance", CheckCircle2], ["Reports", Activity], ["My profile", GraduationCap]]
    : [["Overview", LayoutDashboard], ["Mark attendance", Fingerprint], ["History", Clock3], ["My profile", GraduationCap]];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark"><Fingerprint size={22} /></div><span>attend<span className="brand-ai">ai</span></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list">
          {nav.map(([label, Icon]) => <button key={label} onClick={() => { setPage(label); setMenuOpen(false); }} className={`nav-item ${page === label ? "active" : ""}`}><Icon size={18} /><span>{label}</span>{label === "Mark attendance" && <span className="nav-dot" />}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={18} /></div><strong>Need a hand?</strong><p>Visit the quick start guide to get set up.</p><button onClick={() => notify("See the project README for the setup guide.")}>View guide <ArrowRight size={14} /></button></div>
          <div className="profile-mini"><div className="avatar">{initials(user.full_name)}</div><div className="profile-mini-text"><strong>{user.full_name}</strong><span>{teacher ? "Teacher account" : "Student account"}</span></div><button className="icon-btn subtle" aria-label="Log out" onClick={signOut}><LogOut size={17} /></button></div>
        </div>
      </aside>
      {menuOpen && <button className="mobile-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="breadcrumb">Workspace <span>/</span> <strong>{page}</strong></div>
          <div className="top-actions">
            <span className="today-label"><CalendarDays size={15} /> {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
            <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-btn notification-btn" aria-label="Notifications" onClick={() => notify("You're all caught up.")}><Bell size={18} /><i /></button>
            <div className="avatar top-avatar">{initials(user.full_name)}</div>
          </div>
        </header>
        <div className="content">
          {teacher
            ? <TeacherPage page={page} user={user} notify={notify} setPage={setPage} />
            : <StudentPage page={page} user={user} notify={notify} />}
          <footer className="footer-note"><ShieldCheck size={14} /> Your data is encrypted and only shared with authorized staff.</footer>
        </div>
      </main>
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}<button onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}

function initials(name = "User") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Heading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function AuthPage({ onLogin, notify }) {
  const [mode, setMode] = useState("welcome");
  const [role, setRole] = useState("student");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", student_number: "", teacher_invite_code: "", code: "" });
  const [notice, setNotice] = useState("");
  function change(key, value) { setForm((current) => ({ ...current, [key]: value })); setNotice(""); }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/api/auth/register", json("POST", {
          email: form.email, password: form.password, role, full_name: form.full_name,
          ...(role === "teacher" ? { teacher_invite_code: form.teacher_invite_code } : {}),
          ...(role === "student" ? { student_number: form.student_number } : {}),
        }));
        setMode("verify");
        setNotice("Account created. Enter the verification code sent to your email.");
      } else if (mode === "verify") {
        await api("/api/auth/verify-otp", json("POST", { email: form.email, code: form.code, purpose: "verify" }));
        setMode("login");
        setNotice("Email verified. You can now sign in.");
      } else if (mode === "forgot") {
        await api("/api/auth/forgot-password", json("POST", { email: form.email }));
        setMode("reset");
        setNotice("If the account exists, a reset code has been emailed.");
      } else if (mode === "reset") {
        await api("/api/auth/reset-password", json("POST", { email: form.email, code: form.code, new_password: form.password }));
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      } else {
        const result = await api("/api/auth/login", json("POST", { email: form.email, password: form.password }));
        sessionStorage.setItem("attendance_token", result.access_token);
        const nextUser = { role: result.role, full_name: result.full_name, email: form.email };
        sessionStorage.setItem("attendance_user", JSON.stringify(nextUser));
        onLogin(nextUser);
      }
    } catch (error) {
      setNotice(error.message);
    } finally { setBusy(false); }
  }

  const copy = {
    login: ["Welcome back", `Sign in to your ${role} workspace.`],
    register: ["Create your account", "Get started with secure, simple attendance."],
    verify: ["Check your inbox", "Enter the 6-digit code we sent to your email."],
    forgot: ["Reset your password", "We'll email you a one-time reset code."],
    reset: ["Choose a new password", "Enter the emailed code and a new password."],
  }[mode] || ["Welcome to attendai", "Attendance, thoughtfully managed."];

  return (
    <div className="auth-page">
      <div className="auth-decoration decor-one" /><div className="auth-decoration decor-two" />
      <div className="auth-layout">
        <section className="auth-story">
          <div className="brand auth-brand"><div className="brand-mark"><Fingerprint size={22} /></div><span>attend<span className="brand-ai">ai</span></span></div>
          <div className="story-content"><div className="story-pill"><span /> SMARTER CLASSROOMS START HERE</div><h1>Every class.<br /><span>Accounted for.</span></h1><p>A calmer, smarter way to keep track of the moments that matter in your classroom.</p>
            <div className="story-stats"><div><strong>AI</strong><span>face verification</span></div><i /><div><strong>GPS</strong><span>location checks</span></div><i /><div><strong>Live</strong><span>attendance insights</span></div></div>
          </div><div className="auth-story-footer">© {new Date().getFullYear()} AttendAI <span>•</span> Built for better learning</div>
        </section>
        <section className="auth-card">
          <div className="auth-heading"><div className="eyebrow">{mode === "welcome" ? "GET STARTED" : "YOUR ACCOUNT"}</div><h2>{copy[0]}</h2><p>{copy[1]}</p></div>
          {mode === "welcome" && <div className="role-picker"><button className={role === "student" ? "role-option selected" : "role-option"} onClick={() => setRole("student")}><span className="role-icon student-icon"><GraduationCap size={20} /></span><span><strong>Student</strong><small>Mark and track attendance</small></span><span className="radio" /></button><button className={role === "teacher" ? "role-option selected" : "role-option"} onClick={() => setRole("teacher")}><span className="role-icon teacher-icon"><BookOpen size={19} /></span><span><strong>Teacher</strong><small>Manage classes and sessions</small></span><span className="radio" /></button></div>}
          {mode === "welcome" && <button className="button primary full" onClick={() => setMode("login")}>Continue as {role} <ArrowRight size={17} /></button>}
          {mode !== "welcome" && <form onSubmit={submit} className="auth-form">
            {mode === "register" && <label>Full name<input required value={form.full_name} onChange={(e) => change("full_name", e.target.value)} placeholder="e.g. Alex Morgan" autoComplete="name" /></label>}
            {mode === "register" && role === "student" && <label>Student number<input required value={form.student_number} onChange={(e) => change("student_number", e.target.value)} placeholder="e.g. STU-2048" /></label>}
            {mode === "register" && role === "teacher" && <label>Teacher invitation code<input required value={form.teacher_invite_code || ""} onChange={(e) => change("teacher_invite_code", e.target.value)} placeholder="Provided by your school" /></label>}
            <label>Email address<input required type="email" value={form.email} onChange={(e) => change("email", e.target.value)} placeholder="you@school.edu" autoComplete="email" /></label>
            {(mode === "login" || mode === "register" || mode === "reset") && <label>{mode === "reset" ? "New password" : "Password"}<input required type="password" minLength={mode === "login" ? 1 : 12} value={form.password} onChange={(e) => change("password", e.target.value)} placeholder={mode === "login" ? "Enter your password" : "At least 12 characters"} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>}
            {(mode === "verify" || mode === "reset") && <label>6-digit code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={form.code} onChange={(e) => change("code", e.target.value)} placeholder="000000" /></label>}
            {notice && <div className={`form-notice ${notice.toLowerCase().includes("failed") || notice.toLowerCase().includes("invalid") || notice.toLowerCase().includes("error") ? "error" : ""}`}>{notice}</div>}
            {mode === "login" && <button type="button" className="text-button forgot-link" onClick={() => { setMode("forgot"); setNotice(""); }}>Forgot password?</button>}
            <button className="button primary full" disabled={busy}>{busy ? "Please wait…" : ({ login: "Sign in", register: "Create account", verify: "Verify email", forgot: "Send reset code", reset: "Update password" }[mode])}<ArrowRight size={17} /></button>
          </form>}
          {mode !== "welcome" && <div className="auth-switch">{mode === "login" ? "New here?" : "Already have an account?"} <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setNotice(""); }}> {mode === "login" ? "Create an account" : "Sign in"}</button></div>}
          {mode === "welcome" && <div className="auth-switch"><button className="text-button" onClick={() => setMode("login")}>Already have an account? Sign in</button></div>}
          <div className="auth-security"><ShieldCheck size={15} /> Your information is private and protected</div>
        </section>
      </div>
      {notice && mode === "welcome" && <div className="toast"><CheckCircle2 size={17} />{notice}<button onClick={() => notify("")}><X size={15} /></button></div>}
    </div>
  );
}

function useLoad(load, dependencies = [], intervalMs = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let mounted = true;
    load().then((result) => { if (mounted) { setData(result); setError(""); } })
      .catch((reason) => { if (mounted) setError(reason.message); });
    const timer = intervalMs ? window.setInterval(() => {
      load().then((result) => { if (mounted) { setData(result); setError(""); } })
        .catch((reason) => { if (mounted) setError(reason.message); });
    }, intervalMs) : null;
    return () => { mounted = false; if (timer) window.clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reload, intervalMs]);
  return { data, error, refresh: () => setReload((value) => value + 1) };
}

function StatCard({ label, value, note, icon: Icon, tone = "blue" }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19} /></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>;
}

function StudentPage({ page, user, notify }) {
  const summary = useLoad(() => api("/api/student/attendance/summary"));
  const history = useLoad(() => api("/api/student/attendance/history"));
  const profile = useLoad(() => api("/api/student/profile"));
  const stats = summary.data || { present: 0, absent: 0, percentage: 0, total_sessions: 0, subjects: [] };
  async function downloadReport() {
    try {
      const blob = await api("/api/student/attendance/report");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "my-attendance.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      notify("Attendance report downloaded.");
    } catch (error) { notify(error.message); }
  }
  return <>
    <Heading eyebrow="STUDENT WORKSPACE" title={page === "Overview" ? `Good to see you, ${user.full_name.split(" ")[0]}` : page} description={page === "Overview" ? "Here's your attendance snapshot for this semester." : page === "Mark attendance" ? "Check in to class with a secure face and location verification." : page === "History" ? "Review your check-ins and attendance record." : "Your personal details and account tools."} action={<div className="heading-actions"><div className="session-indicator"><span className="pulse" /> Student account</div>{(page === "Overview" || page === "History") && <button className="button secondary small-button" onClick={downloadReport}><ArrowDownToLine size={15} /> Download report</button>}</div>} />
    {page === "Mark attendance" ? <AttendanceCard notify={notify} onMarked={() => { history.refresh(); summary.refresh(); }} /> : null}
    {(page === "Overview" || page === "History") && <>
      {page === "Overview" && stats.total_sessions > 0 && stats.percentage < 75 && <div className="low-attendance-alert"><Bell size={17} /><div><strong>Attendance needs attention</strong><span>Your current rate is {stats.percentage}%. Check in regularly to stay on track.</span></div></div>}
      <div className="stats-grid">
        <StatCard label="ATTENDANCE RATE" value={`${stats.percentage}%`} note="Across recorded sessions" icon={Activity} tone="blue" />
        <StatCard label="PRESENT SESSIONS" value={stats.present} note="Including late arrivals" icon={CheckCircle2} tone="green" />
        <StatCard label="ABSENT SESSIONS" value={stats.absent} note="Recorded to date" icon={CalendarDays} tone="orange" />
        <StatCard label="SUBJECTS" value={stats.subjects?.length || 0} note="With attendance records" icon={BookOpen} tone="purple" />
      </div>
      <div className="panel history-panel">
        <div className="panel-heading"><div><h3>{page === "History" ? "Attendance history" : "Recent attendance"}</h3><p>Your latest class check-ins and status</p></div><span className="soft-badge"><Activity size={13} /> {history.data?.length || 0} records</span></div>
        <AttendanceTable rows={history.data || []} error={history.error} />
      </div>
      <div className="lower-grid">
        <div className="panel subject-panel"><div className="panel-heading"><div><h3>Subject overview</h3><p>Check in regularly to keep your progress on track</p></div><BookOpen size={17} className="muted" /></div>
          {(stats.subjects || []).length ? stats.subjects.map((subject, index) => <div className="subject-row" key={subject.subject}><div className={`subject-mini tone-${index % 4}`}><BookOpen size={16} /></div><div className="subject-row-text"><strong>{subject.subject}</strong><span>{subject.attended} of {subject.total} sessions · {subject.percentage}%</span></div><span className="subject-arrow"><ArrowRight size={15} /></span></div>) : <EmptyState text="Subject stats appear as your classes record attendance." />}
        </div>
        <div className="panel profile-card"><div className="panel-heading"><div><h3>Profile details</h3><p>Your registered student information</p></div><GraduationCap size={18} className="muted" /></div>
          <div className="profile-large"><div className="avatar avatar-large">{initials(profile.data?.full_name || user.full_name)}</div><div><strong>{profile.data?.full_name || user.full_name}</strong><span>{profile.data?.email || user.email}</span></div></div>
          <div className="detail-row"><span>Student number</span><strong>{profile.data?.student_number || "—"}</strong></div><div className="detail-row"><span>Account type</span><strong>Student</strong></div><div className="privacy-note"><ShieldCheck size={16} /><span>Face data is stored securely and only used for attendance verification.</span></div>
        </div>
      </div>
    </>}
    {page === "My profile" && <div className="panel profile-card standalone"><div className="profile-large"><div className="avatar avatar-large">{initials(profile.data?.full_name || user.full_name)}</div><div><strong>{profile.data?.full_name || user.full_name}</strong><span>{profile.data?.email || user.email}</span></div></div><div className="detail-row"><span>Student number</span><strong>{profile.data?.student_number || "—"}</strong></div><div className="detail-row"><span>Account type</span><strong>Student</strong></div><p className="muted privacy-copy">Biometric face data is used only to verify attendance. You may delete the enrolled face template at any time.</p><button className="button secondary" onClick={async () => { if (!window.confirm("Delete your enrolled face template? You will need to register again before marking attendance.")) return; try { const result = await api("/api/student/face", { method: "DELETE" }); notify(result.message); } catch (error) { notify(error.message); } }}>Delete enrolled face data</button></div>}
    {page === "History" && <AttendanceCalendar rows={history.data || []} />}
  </>;
}

function EmptyState({ text }) { return <div className="empty-state"><div><CalendarDays size={19} /></div><p>{text}</p></div>; }

function AttendanceTable({ rows, error }) {
  if (error) return <div className="inline-error">{error}</div>;
  if (!rows.length) return <EmptyState text="No attendance records yet. Your history will show up here." />;
  return <div className="table-scroll"><table><thead><tr><th>SUBJECT / CLASS</th><th>DATE & TIME</th><th>SESSION</th><th>STATUS</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.id}><td><div className="table-title">{row.subject}</div><div className="table-subtitle">{row.class_name}</div></td><td>{new Date(row.marked_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td><span className="session-code">#{row.session_id}</span></td><td><StatusBadge status={row.status} /></td></tr>)}
  </tbody></table></div>;
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}><i />{status?.charAt(0).toUpperCase() + status?.slice(1)}</span>;
}

function AttendanceCalendar({ rows }) {
  const today = new Date();
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const records = new Map(rows.filter((item) => {
    const date = new Date(item.marked_at);
    return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  }).map((item) => [new Date(item.marked_at).getDate(), item.status]));
  const offset = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  return <div className="panel calendar-panel"><div className="panel-heading"><div><h3>{today.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3><p>Your recorded attendance days</p></div><CalendarDays size={18} className="muted" /></div><div className="calendar-grid">{["S", "M", "T", "W", "T", "F", "S"].map((item, index) => <div className="calendar-weekday" key={`${item}${index}`}>{item}</div>)}{Array.from({ length: offset }, (_, i) => <span key={`blank${i}`} />)}{Array.from({ length: days }, (_, i) => { const day = i + 1; return <div key={day} className={`calendar-day ${records.has(day) ? "has-record" : ""} ${day === today.getDate() ? "today" : ""}`} title={records.get(day) || ""}>{day}{records.has(day) && <i />}</div>; })}</div></div>;
}

function AttendanceCard({ notify, onMarked }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const activeSessions = useLoad(() => api("/api/student/attendance/sessions"), [], 10000);
  const [cameraOn, setCameraOn] = useState(false);
  const [consent, setConsent] = useState(false);
  const [direction, setDirection] = useState("left");
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [step, setStep] = useState(0);
  const hasSessionId = Number.isInteger(Number(sessionId)) && Number(sessionId) > 0;
  const selectedSession = (activeSessions.data || []).find((session) => String(session.id) === sessionId);
  const activeStep = step > 0 ? 2 : cameraOn ? 1 : 0;
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      setMessage("");
      setMessageError(false);
    } catch (error) { setMessage(error.message || "Camera permission is needed to continue."); setMessageError(true); }
  }
  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error("Camera is still starting. Try again in a moment.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to capture an image from the camera.");
    context.drawImage(video, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob((image) => image ? resolve(image) : reject(new Error("Unable to capture an image from the camera.")), "image/jpeg", 0.9));
  }
  async function registerFace() {
    setBusy(true); setMessage("");
    setMessageError(false);
    try {
      const image = await capture();
      const form = new FormData();
      form.append("image", image, "face.jpg");
      form.append("consent", "true");
      await api("/api/faces/register", { method: "POST", body: form });
      setMessage("Face registered successfully.");
    } catch (error) { setMessage(error.message); setMessageError(true); }
    finally { setBusy(false); }
  }
  async function markAttendance() {
    setBusy(true); setMessage("");
    setMessageError(false);
    try {
      if (!hasSessionId) throw new Error("Enter a valid attendance session ID provided by your teacher.");
      if (!consent) throw new Error("Please confirm that you consent to biometric verification.");
      if (!navigator.geolocation) throw new Error("This browser does not support location access.");
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
      const challenge = await api(`/api/student/attendance/challenge/${sessionId}`);
      setDirection(challenge.direction);
      setMessage(`Location verified. Turn your head ${challenge.direction}.`);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const frames = [];
      for (let i = 0; i < 5; i += 1) {
        frames.push(await capture());
        setStep(i + 1);
        await new Promise((resolve) => window.setTimeout(resolve, 320));
      }
      const form = new FormData();
      form.append("session_id", sessionId);
      form.append("latitude", String(position.coords.latitude));
      form.append("longitude", String(position.coords.longitude));
      form.append("accuracy", String(position.coords.accuracy));
      form.append("challenge_token", challenge.challenge_token);
      frames.forEach((frame, index) => form.append("images", frame, `frame-${index}.jpg`));
      const result = await api("/api/student/attendance/mark", { method: "POST", body: form });
      setMessage(`${result.message} (${result.status})`);
      notify(`${result.message} — ${result.status}`);
      onMarked();
    } catch (error) {
      setMessage(error.code === 1 ? "Location permission was denied. Allow location access and retry." : error.message);
      setMessageError(true);
    } finally { setBusy(false); setStep(0); }
  }
  return <div className="student-attendance-page">
    <div className="attendance-intro">
      <div className="attendance-intro-icon"><Fingerprint size={19} /></div>
      <div><strong>Ready to check in?</strong><span>Select a session your teacher has activated for your class, allow camera and location access, then follow the face prompt.</span></div>
      <div className="attendance-secure-note"><ShieldCheck size={15} /> Secure check-in</div>
    </div>
    <div className="attendance-step-list" aria-label="Attendance check-in steps">
      {[["01", "Session ID"], ["02", "Face & movement"], ["03", "Location check"]].map(([number, label], index) => <div className={`attendance-step ${index === activeStep ? "current" : ""}`} key={number}><span>{number}</span><strong>{label}</strong>{index < 2 && <i />}</div>)}
    </div>
    <div className="attendance-workspace">
    <div className="panel camera-panel"><div className="panel-heading"><div><h3>Face & liveness check</h3><p>Center your face and follow the movement prompt</p></div><span className={`camera-state ${cameraOn ? "live" : ""}`}><i />{cameraOn ? "Camera on" : "Camera off"}</span></div>
      <div className={`camera-preview ${cameraOn ? "camera-active" : ""}`}>{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-placeholder"><div><Camera size={24} /></div><strong>Camera preview</strong><span>Allow camera access to get started</span></div>}<div className="face-guide" /></div>
      {cameraOn && <div className="challenge"><span className="challenge-icon">{direction === "left" ? <ArrowLeft size={17} /> : <ArrowRight size={17} />}</span><div><strong>Turn your head {direction}</strong><span>Keep your face inside the frame · frame {step || "—"}/5</span></div></div>}
      <div className="camera-actions">{!cameraOn ? <button className="button secondary" onClick={startCamera}><Camera size={16} /> Enable camera</button> : <button className="button secondary" disabled={busy} onClick={stopCamera}><X size={16} /> Stop camera</button>}
        {cameraOn && <><button className="button secondary" disabled={busy || !consent} onClick={registerFace}><Fingerprint size={16} /> {busy ? "Processing…" : "Register face"}</button><button className="button primary" disabled={busy} onClick={markAttendance}><Check size={16} /> {busy ? "Verifying…" : "Verify & mark"}</button></>}
      </div>
      {cameraOn && <label className="consent-row"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>I consent to secure face processing for attendance verification.</span></label>}
      {message && <div className={`inline-message ${messageError ? "error" : ""}`}>{message}</div>}
      <div className="fine-print"><ShieldCheck size={14} /> Images are processed for verification and not retained as photos.</div>
    </div>
    <div className="attendance-side">
      <div className="panel session-panel"><div className="panel-heading"><div><h3>Class session</h3><p>Sessions activated by your teacher for your enrolled classes</p></div><span className={`active-pill ${hasSessionId ? "session-entered" : "session-waiting"}`}><i />{selectedSession ? "Ready" : hasSessionId ? "ID entered" : "Required"}</span></div>
        <label className="field-label">Available sessions<select value={selectedSession ? sessionId : ""} disabled={busy} onChange={(event) => setSessionId(event.target.value)}><option value="">Select an active class session</option>{(activeSessions.data || []).map((session) => <option key={session.id} value={session.id}>{session.class_name} · {session.subject_name} · #{session.id}</option>)}</select></label>
        {activeSessions.error && <div className="inline-error">{activeSessions.error}</div>}
        {!activeSessions.error && !activeSessions.data?.length && <div className="session-empty"><CalendarDays size={18} /><span>No active sessions right now. Your teacher needs to activate a session during its scheduled time.</span></div>}
        <label className="field-label manual-session-field">Or enter a session ID shared by your teacher<input type="number" min="1" step="1" inputMode="numeric" value={selectedSession ? "" : sessionId} disabled={busy} onChange={(event) => setSessionId(event.target.value)} placeholder="e.g. 1042" /></label>
        {selectedSession && <div className="session-selected-detail"><CheckCircle2 size={15} /><span>{selectedSession.class_name} · {selectedSession.subject_name} · session #{selectedSession.id}</span></div>}
      </div>
      <div className="panel verification-panel"><div className="panel-heading"><div><h3>Verification steps</h3><p>All checks must pass</p></div></div>
        {[["1", "Active session", "Teacher-created and within schedule"], ["2", "Location signal", "Inside the allowed radius"], ["3", "Face match", "Compare with enrolled face"], ["4", "Liveness", "Follow a randomized movement"]].map(([number, title, text], index) => <div className="verify-step" key={number}><span className={`verify-number ${index === 0 ? "current" : ""}`}>{number}</span><div><strong>{title}</strong><span>{text}</span></div>{index === 0 ? <Clock3 size={15} /> : <span className="step-wait" />}</div>)}
        <p className="gps-caveat"><MapPin size={14} /> Browser GPS is a location signal, not proof of physical presence.</p>
      </div>
    </div>
    </div>
  </div>;
}

function TeacherPage({ page, user, notify, setPage }) {
  const classes = useLoad(() => api("/api/teacher/classes"));
  const analytics = useLoad(() => api("/api/teacher/analytics"));
  const sessions = useLoad(() => api("/api/teacher/attendance-sessions"));
  const profile = useLoad(() => api("/api/teacher/profile"));
  const [filters, setFilters] = useState({ search: "", class_id: "", subject_id: "", date: "" });
  const [statusFilter, setStatusFilter] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [correction, setCorrection] = useState(null);
  useEffect(() => {
    if (!filters.class_id) { setSubjects([]); setFilters((current) => ({ ...current, subject_id: "" })); return; }
    api(`/api/teacher/subjects?class_id=${filters.class_id}`).then(setSubjects).catch((error) => notify(error.message));
  }, [filters.class_id, notify]);
  const search = new URLSearchParams();
  if (filters.search) search.set("search", filters.search);
  if (filters.class_id) search.set("class_id", filters.class_id);
  if (filters.subject_id) search.set("subject_id", filters.subject_id);
  if (filters.date) search.set("date", `${filters.date}T00:00:00`);
  const liveRefresh = ["Overview", "Attendance", "Reports"].includes(page) ? 10000 : 0;
  const attendance = useLoad(() => api(`/api/teacher/attendance${search.size ? `?${search}` : ""}`), [filters.search, filters.class_id, filters.subject_id, filters.date], liveRefresh);
  const report = async () => {
    try {
      const blob = await api("/api/teacher/reports");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "attendance-report.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      notify("Attendance report downloaded.");
    } catch (error) { notify(error.message); }
  };
  const totalExpected = (analytics.data || []).reduce((sum, item) => sum + item.expected_checkins, 0);
  const totalPresent = (analytics.data || []).reduce((sum, item) => sum + item.present_records, 0);
  const now = Date.now();
  const activeSessions = (sessions.data || []).filter((item) => item.active && new Date(item.starts_at).getTime() <= now && new Date(item.ends_at).getTime() >= now).length;
  const attendanceRows = attendance.data || [];
  const filteredAttendance = statusFilter
    ? attendanceRows.filter((row) => row.status === statusFilter)
    : attendanceRows;
  const presentCount = attendanceRows.filter((row) => row.status === "present").length;
  const lateCount = attendanceRows.filter((row) => row.status === "late").length;
  const absentCount = attendanceRows.filter((row) => row.status === "absent").length;
  const hasAttendanceFilters = Boolean(filters.search || filters.class_id || filters.subject_id || filters.date || statusFilter);
  const clearAttendanceFilters = () => {
    setFilters({ search: "", class_id: "", subject_id: "", date: "" });
    setStatusFilter("");
  };
  return <>
    <Heading eyebrow="TEACHER WORKSPACE" title={page === "Overview" ? `Welcome back, ${user.full_name.split(" ")[0]}` : page} description={page === "Overview" ? "Your classrooms at a glance. Let's make today count." : page === "Attendance" ? "Review student check-ins, spot absences, and correct records." : "Manage your classes and keep your classroom in sync."} action={<div className="heading-actions"><div className="session-indicator"><span className="pulse" /> Teacher account</div>{page === "Overview" && <button className="button primary" onClick={() => setPage("Sessions")}><Plus size={16} /> New session</button>}</div>} />
    {page === "Classes" && <TeacherClasses classes={classes.data || []} refresh={classes.refresh} notify={notify} />}
    {page === "Sessions" && <TeacherSessions classes={classes.data || []} notify={notify} />}
    {page === "My profile" && <div className="panel profile-card standalone"><div className="profile-large"><div className="avatar avatar-large">{initials(profile.data?.full_name || user.full_name)}</div><div><strong>{profile.data?.full_name || user.full_name}</strong><span>{profile.data?.email || user.email}</span></div></div><div className="detail-row"><span>Account type</span><strong>Teacher</strong></div><p className="muted privacy-copy">Teacher access is restricted to classes and sessions assigned to this account.</p></div>}
    {(page === "Overview" || page === "Attendance" || page === "Reports") && <>
      {page === "Overview" && <div className="stats-grid">
        <StatCard label="MY CLASSES" value={classes.data?.length || 0} note="Classes you manage" icon={Users} tone="blue" />
        <StatCard label="STUDENTS" value={(analytics.data || []).reduce((sum, item) => sum + (item.student_count || 0), 0)} note="Across assigned classes" icon={GraduationCap} tone="purple" />
        <StatCard label="ATTENDANCE RATE" value={`${totalExpected ? Math.round(totalPresent / totalExpected * 100) : 0}%`} note="For completed sessions" icon={Activity} tone="green" />
        <StatCard label="ACTIVE SESSIONS" value={activeSessions} note="Currently accepting check-ins" icon={CalendarDays} tone="orange" />
      </div>}
      {page === "Attendance" && <div className="stats-grid">
        <StatCard label="TOTAL RECORDS" value={attendanceRows.length} note="For the selected filters" icon={Users} tone="blue" />
        <StatCard label="PRESENT" value={presentCount} note="Checked in on time" icon={CheckCircle2} tone="green" />
        <StatCard label="LATE" value={lateCount} note="Checked in after start" icon={Clock3} tone="orange" />
        <StatCard label="ABSENT" value={absentCount} note="No check-in recorded" icon={CalendarDays} tone="purple" />
      </div>}
      {page !== "Attendance" && <div className="panel analytics-panel"><div className="panel-heading"><div><h3>Class analytics</h3><p>Attendance rates across your assigned classes</p></div><Activity size={18} className="muted" /></div>
        {analytics.error ? <div className="inline-error">{analytics.error}</div> : analytics.data?.length ? <div className="analytics-list">{analytics.data.map((item, index) => <div className="analytics-row" key={item.class_id}><div className={`class-avatar class-${index % 4}`}><BookOpen size={17} /></div><div className="analytics-class"><strong>{item.class_name}</strong><span>{item.expected_checkins} expected check-ins · {item.present_records} present or late</span></div><div className="progress-track"><span style={{ width: `${item.attendance_rate}%` }} /></div><strong className="rate-value">{item.attendance_rate}%</strong></div>)}</div> : <EmptyState text="Create a class and attendance session to see analytics." />}
      </div>}
      <div className="panel attendance-list-panel">
        <div className="panel-heading"><div><h3>{page === "Attendance" ? "Attendance register" : "Recent attendance"}</h3><p>{page === "Attendance" ? "Filter check-ins by student, class, subject, date, or status." : "Latest student check-ins from your classes"}</p></div><button className="button secondary small-button" onClick={report}><Download size={15} /> Export CSV</button></div>
        <div className="table-toolbar"><div className="search-field"><Search size={16} /><input aria-label="Search students" placeholder="Search students…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div><select className="toolbar-select" aria-label="Filter by class" value={filters.class_id} onChange={(e) => setFilters({ ...filters, class_id: e.target.value })}><option value="">All classes</option>{(classes.data || []).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select className="toolbar-select" aria-label="Filter by subject" value={filters.subject_id} onChange={(e) => setFilters({ ...filters, subject_id: e.target.value })}><option value="">All subjects</option>{subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input className="toolbar-select date-select" type="date" aria-label="Filter by date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />{page === "Attendance" && <select className="toolbar-select" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option></select>}{hasAttendanceFilters && <button className="button secondary small-button" onClick={clearAttendanceFilters}>Clear filters</button>}{page !== "Attendance" && <button className="button secondary small-button" onClick={() => { setPage("Sessions"); }}><CalendarDays size={15} /> Sessions</button>}</div>
        {attendance.error ? <div className="inline-error">{attendance.error}</div> : filteredAttendance.length ? <>{page === "Attendance" && <div className="attendance-result-count">Showing {filteredAttendance.length} of {attendanceRows.length} records</div>}<div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>CLASS / SUBJECT</th><th>SESSION</th><th>STATUS</th><th>MARKED AT</th><th>ACTION</th></tr></thead><tbody>{filteredAttendance.map((row) => <tr key={row.record_id ?? `${row.session_id}-${row.student_id}`}><td><div className="student-table-cell"><div className="avatar avatar-sm">{initials(row.student)}</div><div><div className="table-title">{row.student}</div><div className="table-subtitle">{row.student_number}</div></div></div></td><td>{row.class_name} · {row.subject_name}</td><td><span className="session-code">#{row.session_id}</span></td><td><StatusBadge status={row.status} /></td><td>{new Date(row.marked_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td><button className="text-button" onClick={() => setCorrection(row)}>Correct</button></td></tr>)}</tbody></table></div></> : <EmptyState text={hasAttendanceFilters ? "No attendance records match these filters." : "Attendance records appear here when students check in."} />}
      </div>
    </>}
    {correction && <Modal title={`Correct attendance · ${correction.student}`} onClose={() => setCorrection(null)}><CorrectionForm record={correction} onDone={() => { setCorrection(null); attendance.refresh(); notify("Attendance correction saved to the audit trail."); }} /></Modal>}
    {page === "Overview" && <div className="quick-actions"><div><div className="quick-icon"><Users size={18} /></div><div><strong>Set up your classroom</strong><span>Create classes and subjects before taking attendance.</span></div></div><button className="button secondary" onClick={() => setPage("Classes")}>Manage classes <ArrowRight size={15} /></button></div>}
  </>;
}

function TeacherClasses({ classes, refresh, notify }) {
  const [showClass, setShowClass] = useState(false);
  const [selected, setSelected] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [student, setStudent] = useState({ email: "", full_name: "", student_number: "", class_id: "" });
  const [listClassId, setListClassId] = useState("");
  const [editingStudent, setEditingStudent] = useState(null);
  const students = useLoad(() => listClassId ? api(`/api/teacher/students?class_id=${listClassId}`) : Promise.resolve([]), [listClassId]);
  async function addSubject(event) {
    event.preventDefault();
    try { await api("/api/teacher/subjects", json("POST", { class_id: Number(selected), name: subjectName })); setSubjectName(""); notify("Subject added."); }
    catch (error) { notify(error.message); }
  }
  async function addStudent(event) {
    event.preventDefault();
    try { await api("/api/teacher/students", json("POST", { ...student, class_id: Number(student.class_id) })); setStudent({ email: "", full_name: "", student_number: "", class_id: "" }); students.refresh(); notify("Student assigned to class."); }
    catch (error) { notify(error.message); }
  }
  return <div className="teacher-manage-grid"><div className="panel"><div className="panel-heading"><div><h3>Your classes</h3><p>Only classes assigned to your account</p></div><button className="button primary small-button" onClick={() => setShowClass(true)}><Plus size={15} /> New class</button></div>
    {classes.length ? classes.map((item, index) => <div className="managed-class" key={item.id}><div className={`class-avatar class-${index % 4}`}><BookOpen size={17} /></div><div><strong>{item.name}</strong><span>Class ID #{item.id}</span></div><span className="managed-tag">Assigned to you</span></div>) : <EmptyState text="Create your first class to get started." />}</div>
    <div className="panel"><div className="panel-heading"><div><h3>Add a subject</h3><p>Assign a subject to a class</p></div><BookOpen size={17} className="muted" /></div><form className="stack-form" onSubmit={addSubject}><label>Class<select required value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Select a class</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Subject name<input required value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="e.g. Biology" /></label><button className="button primary"><Plus size={15} /> Add subject</button></form></div>
    <div className="panel student-add-panel"><div className="panel-heading"><div><h3>Assign a student</h3><p>Student must register an account first</p></div><GraduationCap size={17} className="muted" /></div><form className="stack-form" onSubmit={addStudent}><label>Class<select required value={student.class_id} onChange={(e) => setStudent({ ...student, class_id: e.target.value })}><option value="">Select a class</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Student email<input type="email" required value={student.email} onChange={(e) => setStudent({ ...student, email: e.target.value })} /></label><label>Full name<input required value={student.full_name} onChange={(e) => setStudent({ ...student, full_name: e.target.value })} /></label><label>Student number<input required value={student.student_number} onChange={(e) => setStudent({ ...student, student_number: e.target.value })} /></label><button className="button primary"><Users size={15} /> Assign student</button></form></div>
    <div className="panel student-add-panel"><div className="panel-heading"><div><h3>Manage student records</h3><p>View and update students in your classes</p></div><Users size={17} className="muted" /></div><label className="student-class-picker">Class<select value={listClassId} onChange={(event) => setListClassId(event.target.value)}><option value="">Select a class</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{students.error && <div className="inline-error">{students.error}</div>}{listClassId && students.data?.length ? students.data.map((item) => <div className="managed-class" key={item.id}><div className="avatar avatar-sm">{initials(item.full_name)}</div><div><strong>{item.full_name}</strong><span>{item.student_number} · {item.email}</span></div><button className="button secondary small-button" onClick={() => setEditingStudent(item)}>Edit</button></div>) : listClassId ? <EmptyState text="No students are assigned to this class yet." /> : <p className="muted">Select a class to view enrolled students.</p>}</div>
    {showClass && <Modal title="Create a class" onClose={() => setShowClass(false)}><ClassForm onDone={async () => { setShowClass(false); await refresh(); notify("Class created."); }} /></Modal>}
    {editingStudent && <Modal title={`Edit student · ${editingStudent.full_name}`} onClose={() => setEditingStudent(null)}><StudentEditForm student={editingStudent} onDone={() => { setEditingStudent(null); students.refresh(); notify("Student record updated."); }} /></Modal>}
  </div>;
}

function ClassForm({ onDone }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); try { await api("/api/teacher/classes", json("POST", { name })); onDone(); } catch (reason) { setError(reason.message); } }
  return <form className="stack-form" onSubmit={submit}><label>Class name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Grade 10 — Section A" /></label>{error && <div className="inline-error">{error}</div>}<button className="button primary"><Plus size={15} /> Create class</button></form>;
}

function CorrectionForm({ record, onDone }) {
  const [status, setStatus] = useState(record.status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    try {
      const path = record.record_id
        ? `/api/teacher/attendance/${record.record_id}`
        : `/api/teacher/attendance-sessions/${record.session_id}/students/${record.student_id}`;
      await api(path, json("PUT", { status, reason }));
      onDone();
    } catch (failure) { setError(failure.message); }
  }
  return <form className="stack-form" onSubmit={submit}><p className="modal-copy">Change the status for {record.student}. Your reason will be recorded in the audit trail.</p><label>Attendance status<select value={status} onChange={(event) => setStatus(event.target.value)}>{["present", "late", "absent"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Reason<textarea required minLength="3" maxLength="500" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this record is being corrected" /></label>{error && <div className="inline-error">{error}</div>}<button className="button primary">Save correction</button></form>;
}

function StudentEditForm({ student, onDone }) {
  const [fullName, setFullName] = useState(student.full_name);
  const [studentNumber, setStudentNumber] = useState(student.student_number);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    try {
      await api(`/api/teacher/students/${student.id}`, json("PUT", { full_name: fullName, student_number: studentNumber }));
      onDone();
    } catch (failure) { setError(failure.message); }
  }
  return <form className="stack-form" onSubmit={submit}><label>Full name<input required minLength="2" maxLength="160" value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label>Student number<input required maxLength="50" value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}<button className="button primary">Save changes</button></form>;
}

function TeacherSessions({ classes, notify }) {
  const sessions = useLoad(() => api("/api/teacher/attendance-sessions"));
  const [classId, setClassId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [editingSession, setEditingSession] = useState(null);
  const [geofenceForm, setGeofenceForm] = useState({ latitude: "", longitude: "", radius_meters: "100" });
  const [form, setForm] = useState({ subject_id: "", starts_at: "", ends_at: "", late_after: "", latitude: "", longitude: "", radius_meters: "100" });
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    if (!classId) { setSubjects([]); return; }
    api(`/api/teacher/subjects?class_id=${classId}`).then(setSubjects).catch((reason) => setError(reason.message));
  }, [classId]);
  async function useLocation() {
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }));
      setForm({ ...form, latitude: String(position.coords.latitude.toFixed(6)), longitude: String(position.coords.longitude.toFixed(6)) });
      setError("Location captured. Verify the coordinates before creating a session.");
    } catch (reason) { setError(reason.message); }
  }
  async function submit(event) {
    event.preventDefault(); setError("");
    try {
      const result = await api("/api/teacher/attendance-sessions", json("POST", {
        class_id: Number(classId), subject_id: Number(form.subject_id), starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(), late_after: new Date(form.late_after).toISOString(),
        latitude: Number(form.latitude), longitude: Number(form.longitude), radius_meters: Number(form.radius_meters),
      }));
      setSessionId(String(result.id)); sessions.refresh(); notify(`Attendance session #${result.id} created.`);
    } catch (reason) { setError(reason.message); }
  }
  async function saveGeofence(event) {
    event.preventDefault();
    try {
      await api(`/api/teacher/attendance-sessions/${editingSession}/geofence`, json("PUT", {
        latitude: Number(geofenceForm.latitude), longitude: Number(geofenceForm.longitude), radius_meters: Number(geofenceForm.radius_meters),
      }));
      setEditingSession(null); await sessions.refresh(); notify("Session geofence updated.");
    } catch (reason) { setError(reason.message); }
  }
  async function toggleSession(session) {
    try {
      await api(`/api/teacher/attendance-sessions/${session.id}/status`, json("PUT", { active: !session.active }));
      await sessions.refresh(); notify(`Session ${session.active ? "paused" : "activated"}.`);
    } catch (reason) { setError(reason.message); }
  }
  async function copySessionId(id) {
    try {
      await navigator.clipboard.writeText(String(id));
      notify(`Session #${id} copied for your students.`);
    } catch (reason) { setError(reason.message || "Unable to copy the session ID."); }
  }
  return <><div className="session-creation-layout"><div className="panel session-form-panel"><div className="panel-heading"><div><h3>Create attendance session</h3><p>Choose the class, schedule and classroom location</p></div><CalendarDays size={18} className="muted" /></div>
    <form className="stack-form" onSubmit={submit}><div className="form-two-col"><label>Class<select required value={classId} onChange={(e) => { setClassId(e.target.value); setForm({ ...form, subject_id: "" }); }}><option value="">Select class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Subject<select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}><option value="">Select subject</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <div className="form-two-col"><label>Starts at<input required type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label><label>Ends at<input required type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label></div>
      <label>Late after<input required type="datetime-local" value={form.late_after} onChange={(e) => setForm({ ...form, late_after: e.target.value })} /></label>
      <div className="form-section-label"><MapPin size={15} /> Geofence location</div>
      <button type="button" className="button secondary location-button" onClick={useLocation}><LocateFixed size={15} /> Use my current location</button>
      <div className="form-two-col"><label>Latitude<input required type="number" min="-90" max="90" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="37.7749" /></label><label>Longitude<input required type="number" min="-180" max="180" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="-122.4194" /></label></div>
      <label>Allowed radius<select value={form.radius_meters} onChange={(e) => setForm({ ...form, radius_meters: e.target.value })}>{[50, 100, 200].map((radius) => <option key={radius} value={radius}>{radius} meters</option>)}<option value="500">500 meters</option></select></label>
      {error && <div className={`inline-message ${error.toLowerCase().includes("error") ? "error" : ""}`}>{error}</div>}
      <button className="button primary"><Plus size={15} /> Create session</button>
    </form>
  </div><div className="panel session-info-panel"><div className="session-info-icon"><ShieldCheck size={21} /></div><h3>Session security</h3><p>Students must be enrolled in the selected class and pass each verification check before their attendance is recorded.</p><div className="info-check"><CheckCircle2 size={16} /><span>Server checks session schedule</span></div><div className="info-check"><CheckCircle2 size={16} /><span>GPS radius and accuracy are verified</span></div><div className="info-check"><CheckCircle2 size={16} /><span>Face match and movement challenge</span></div><div className="gps-caveat"><MapPin size={14} /> GPS can be spoofed; it is a location signal, not proof.</div>{sessionId && <div className="created-session"><span>New session ID</span><strong>#{sessionId}</strong><p>Share this ID with your students.</p><button className="button secondary small-button" onClick={() => navigator.clipboard?.writeText(sessionId).then(() => notify("Session ID copied."))}>Copy session ID</button></div>}</div></div>
    <div className="panel scheduled-sessions"><div className="panel-heading"><div><h3>Scheduled sessions</h3><p>Manage your session windows and geofence</p></div><CalendarDays size={18} className="muted" /></div>
      {sessions.error && <div className="inline-error">{sessions.error}</div>}
      {!sessions.error && !sessions.data?.length && <EmptyState text="Your created sessions will appear here." />}
      {(sessions.data || []).map((session) => <div className="scheduled-session" key={session.id}><div className="scheduled-session-main"><div className="class-avatar class-0"><CalendarDays size={16} /></div><div className="scheduled-session-title"><strong>{session.class_name} · {session.subject_name}</strong><span>Session #{session.id} · {new Date(session.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span><small>{session.radius_meters} m radius · {session.latitude}, {session.longitude}</small></div><span className={`session-status ${session.active ? "enabled" : ""}`}>{session.active ? "Active" : "Paused"}</span><button className="button secondary small-button" onClick={() => copySessionId(session.id)}>Copy ID</button><button className="button secondary small-button" onClick={() => toggleSession(session)}>{session.active ? "Pause" : "Activate"}</button><button className="button secondary small-button" onClick={() => { setEditingSession(session.id); setGeofenceForm({ latitude: String(session.latitude ?? ""), longitude: String(session.longitude ?? ""), radius_meters: String(session.radius_meters ?? 100) }); setError(""); }}>Edit geofence</button></div>
        {editingSession === session.id && <form className="geofence-edit-form" onSubmit={saveGeofence}><label>Latitude<input required type="number" min="-90" max="90" step="any" value={geofenceForm.latitude} onChange={(event) => setGeofenceForm({ ...geofenceForm, latitude: event.target.value })} /></label><label>Longitude<input required type="number" min="-180" max="180" step="any" value={geofenceForm.longitude} onChange={(event) => setGeofenceForm({ ...geofenceForm, longitude: event.target.value })} /></label><label>Radius<select value={geofenceForm.radius_meters} onChange={(event) => setGeofenceForm({ ...geofenceForm, radius_meters: event.target.value })}>{[50, 100, 200, 500].map((radius) => <option key={radius} value={radius}>{radius} m</option>)}</select></label><button className="button primary small-button">Save</button><button type="button" className="button secondary small-button" onClick={() => setEditingSession(null)}>Cancel</button></form>}
      </div>)}
      {error && <div className="inline-error">{error}</div>}
    </div></>;
}

function Modal({ title, children, onClose }) {
  useEffect(() => { function escape(event) { if (event.key === "Escape") onClose(); } window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><div className="modal-heading"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</div></div>;
}

export default App;
