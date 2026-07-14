"""Canonical domain enumerations for the intervals package."""
from __future__ import annotations

from enum import Enum


class IntensityZone(str, Enum):
    """Heart-rate / power training zones Z1–Z5."""

    Z1 = "z1"
    Z2 = "z2"
    Z3 = "z3"
    Z4 = "z4"
    Z5 = "z5"


class TrainingType(str, Enum):
    """High-level workout modality."""

    CYCLING = "cycling"
    RUNNING = "running"
    SWIMMING = "swimming"
    STRENGTH = "strength"
    OTHER = "other"


class WorkoutStatus(str, Enum):
    """Lifecycle status of a planned or completed workout."""

    PLANNED = "planned"
    COMPLETED = "completed"
    SKIPPED = "skipped"
