"""In-memory workout store (placeholder — replace with persistent backend)."""
from __future__ import annotations

from uuid import UUID

from intervals.domain.model import Workout


class WorkoutStore:
    """Simple in-memory store; replace with SQLite/PostgreSQL adapter."""

    def __init__(self) -> None:
        self._data: dict[UUID, Workout] = {}

    def save(self, workout: Workout) -> None:
        self._data[workout.id] = workout

    def find(self, workout_id: UUID) -> Workout | None:
        return self._data.get(workout_id)

    def all(self) -> list[Workout]:
        return list(self._data.values())

    def delete(self, workout_id: UUID) -> bool:
        if workout_id in self._data:
            del self._data[workout_id]
            return True
        return False
