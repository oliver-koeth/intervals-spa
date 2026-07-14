"""Application-layer orchestration — use-case services."""
from __future__ import annotations

from uuid import uuid4

from intervals.application.contracts import WorkoutRequest, WorkoutResponse
from intervals.application.validation import validate_workout_request
from intervals.domain.enums import WorkoutStatus
from intervals.domain.model import Interval, Workout
from intervals.domain.validation import validate_workout
from intervals.infrastructure.workout_store import WorkoutStore
from intervals.shared.errors import NotFoundError


class WorkoutService:
    """Orchestrates workout use cases."""

    def __init__(self, store: WorkoutStore) -> None:
        self._store = store

    def create(self, request: WorkoutRequest) -> WorkoutResponse:
        validate_workout_request(request)
        intervals = [
            Interval(
                zone=i.zone,
                duration_seconds=i.duration_seconds,
                target_watts=i.target_watts,
            )
            for i in request.intervals
        ]
        workout = Workout(
            id=uuid4(),
            name=request.name,
            training_type=request.training_type,
            planned_date=request.planned_date,
            status=WorkoutStatus.PLANNED,
            intervals=intervals,
        )
        validate_workout(workout)
        self._store.save(workout)
        return _to_response(workout)

    def get(self, workout_id: str) -> WorkoutResponse:
        from uuid import UUID

        try:
            uid = UUID(workout_id)
        except ValueError as exc:
            raise NotFoundError(f"Invalid workout id: {workout_id!r}") from exc
        workout = self._store.find(uid)
        if workout is None:
            raise NotFoundError(f"Workout not found: {workout_id!r}")
        return _to_response(workout)

    def list_all(self) -> list[WorkoutResponse]:
        return [_to_response(w) for w in self._store.all()]


def _to_response(workout: Workout) -> WorkoutResponse:
    from intervals.application.contracts import IntervalResponse

    return WorkoutResponse(
        id=workout.id,
        name=workout.name,
        training_type=workout.training_type,
        planned_date=workout.planned_date,
        status=workout.status,
        total_duration_seconds=workout.total_duration_seconds,
        intervals=[
            IntervalResponse(
                zone=i.zone,
                duration_seconds=i.duration_seconds,
                target_watts=i.target_watts,
            )
            for i in workout.intervals
        ],
    )
