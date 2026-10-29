from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi import HTTPException

from app.core.security import create_liveness_challenge, validate_liveness_challenge
from app.services.face import liveness_direction
from app.services.geo import distance_meters


def test_haversine_zero_distance():
    assert distance_meters(37.7749, -122.4194, 37.7749, -122.4194) == 0


def test_haversine_known_distance():
    distance = distance_meters(0, 0, 0, 1)
    assert 111_000 < distance < 111_400


def test_liveness_requires_motion_in_requested_direction():
    def landmarks(nose_x):
        return np.array([0, 0, 10, 0, nose_x, 5, 3, 10, 7, 10], dtype=np.float32)

    frames = [landmarks(5), landmarks(6), landmarks(7)]
    assert liveness_direction(frames, "left")
    assert not liveness_direction(frames, "right")


def test_liveness_rejects_insufficient_frames():
    points = np.zeros(10, dtype=np.float32)
    assert not liveness_direction([points, points], "left")


def test_liveness_challenge_is_bound_to_student_and_session():
    token, direction = create_liveness_challenge(12, 34, datetime.now(timezone.utc) + timedelta(minutes=2))
    assert direction in {"left", "right"}
    assert validate_liveness_challenge(token, 12, 34) == direction
    with pytest.raises(HTTPException):
        validate_liveness_challenge(token, 12, 35)
