"""Domain-level validation invariants."""
from __future__ import annotations

from intervals.domain.model import Interval, Workout
from intervals.shared.errors import DomainRuleError


def validate_interval(interval: Interval) -> None:
    """Raise DomainRuleError if the interval violates domain invariants."""
    if interval.duration_seconds <= 0:
        raise DomainRuleError(
            f"interval.duration_seconds: must be positive, got {interval.duration_seconds}"
        )


def validate_workout(workout: Workout) -> None:
    """Raise DomainRuleError if the workout violates domain invariants."""
    if not workout.name.strip():
        raise DomainRuleError("workout.name: must not be blank")
    for i, interval in enumerate(workout.intervals):
        try:
            validate_interval(interval)
        except DomainRuleError as exc:
            raise DomainRuleError(f"workout.intervals[{i}]: {exc}") from exc
