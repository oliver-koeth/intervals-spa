"""Core domain entities for the intervals package."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from intervals.domain.enums import IntensityZone, TrainingType, WorkoutStatus


@dataclass(frozen=True)
class Interval:
    """A single training interval block within a workout."""

    zone: IntensityZone
    duration_seconds: int
    target_watts: int | None = None

    def __post_init__(self) -> None:
        if self.duration_seconds <= 0:
            raise ValueError("duration_seconds must be positive")
        if self.target_watts is not None and self.target_watts < 0:
            raise ValueError("target_watts must be non-negative")


@dataclass(frozen=True)
class Workout:
    """A planned or completed workout composed of one or more intervals."""

    id: UUID
    name: str
    training_type: TrainingType
    planned_date: date
    status: WorkoutStatus
    intervals: list[Interval] = field(default_factory=list)

    @property
    def total_duration_seconds(self) -> int:
        return sum(i.duration_seconds for i in self.intervals)
