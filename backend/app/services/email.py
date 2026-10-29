import smtplib
from email.message import EmailMessage

from app.core.config import settings


def send_code(email: str, code: str, purpose: str) -> None:
    if not settings.smtp_host or not settings.smtp_username or not settings.smtp_password:
        raise RuntimeError("Email delivery is not configured. Set SMTP_HOST, SMTP_USERNAME, and SMTP_PASSWORD.")
    message = EmailMessage()
    message["Subject"] = "Your attendance system verification code"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(f"Your {purpose} code is {code}. It expires in {settings.otp_expire_minutes} minutes.")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_starttls:
            server.starttls()
        server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)
