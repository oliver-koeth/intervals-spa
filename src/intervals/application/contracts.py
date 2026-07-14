"""Boundary request/response DTOs for the intervals application layer.

Every DTO subclasses BoundaryModel so extra fields are forbidden at each
level and strict numeric types block silent string coercion.
"""
from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from intervals.domain.enums import IntensityZone, TrainingType, WorkoutStatus


class BoundaryModel(BaseModel):
    """Base for all boundary DTOs — forbids extra fields."""

    model_config = ConfigDict(extra="forbid")


# ── Interval ──────────────────────────────────────────────────────────────────


class IntervalRequest(BoundaryModel):
    zone: IntensityZone
    duration_seconds: StrictInt
    target_watts: StrictInt | None = None


class IntervalResponse(BoundaryModel):
    zone: IntensityZone
    duration_seconds: StrictInt
    target_watts: StrictInt | None = None


# ── Workout ───────────────────────────────────────────────────────────────────


class WorkoutRequest(BoundaryModel):
    name: StrictStr
    training_type: TrainingType
    planned_date: date
    intervals: list[IntervalRequest] = []


class WorkoutResponse(BoundaryModel):
    id: UUID
    name: StrictStr
    training_type: TrainingType
    planned_date: date
    status: WorkoutStatus
    total_duration_seconds: StrictInt
    intervals: list[IntervalResponse] = []
