from pathlib import Path

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile

from app.core.config import settings

MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _models():
    detector_path = Path(settings.face_detection_model)
    recognizer_path = Path(settings.face_recognition_model)
    if not detector_path.is_file() or not recognizer_path.is_file():
        raise HTTPException(status_code=503, detail="Face models are not installed. See the setup guide.")
    detector = cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), 0.8, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")
    return detector, recognizer


async def read_image(image: UploadFile) -> np.ndarray:
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP image")
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller")
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise HTTPException(status_code=400, detail="Image could not be decoded")
    return decoded


def detect_and_embed(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    detector, recognizer = _models()
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None or len(faces) != 1:
        raise HTTPException(status_code=400, detail="Exactly one face must be visible")
    aligned = recognizer.alignCrop(image, faces[0])
    embedding = recognizer.feature(aligned).astype(np.float32).flatten()
    landmarks = faces[0][4:14].astype(np.float32)
    return embedding, landmarks


def cosine_similarity(left: bytes, right: np.ndarray) -> float:
    stored = np.frombuffer(left, dtype=np.float32)
    if stored.shape != right.shape:
        return 0
    denominator = float(np.linalg.norm(stored) * np.linalg.norm(right))
    return float(np.dot(stored, right) / denominator) if denominator else 0


def liveness_direction(landmarks_frames: list[np.ndarray], direction: str) -> bool:
    if len(landmarks_frames) < 3:
        return False
    centers = [float(points.reshape(5, 2)[2][0]) for points in landmarks_frames]
    face_widths = [float(np.linalg.norm(points.reshape(5, 2)[0] - points.reshape(5, 2)[1])) for points in landmarks_frames]
    if min(face_widths) <= 0:
        return False
    movement = (centers[-1] - centers[0]) / float(np.mean(face_widths))
    return movement >= 0.08 if direction == "left" else movement <= -0.08
