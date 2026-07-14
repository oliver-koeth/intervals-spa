"""Semantic validation guards for application-layer requests."""
from __future__ import annotations

from intervals.application.contracts import WorkoutRequest
from intervals.shared.errors import ValidationError


def validate_workout_request(request: WorkoutRequest) -> None:
    """Raise ValidationError if *request* violates semantic rules."""
    if not request.name.strip():
        raise ValidationError("name: must not be blank")
    for idx, interval in enumerate(request.intervals):
        if interval.duration_seconds <= 0:
            raise ValidationError(
                f"intervals[{idx}].duration_seconds: must be positive"
            )
