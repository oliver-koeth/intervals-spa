"""Unit tests for domain model invariants."""
import pytest

from intervals.domain.enums import IntensityZone
from intervals.domain.model import Interval


def test_interval_rejects_zero_duration() -> None:
    with pytest.raises(ValueError, match="duration_seconds must be positive"):
        Interval(zone=IntensityZone.Z2, duration_seconds=0)


def test_interval_rejects_negative_watts() -> None:
    with pytest.raises(ValueError, match="target_watts must be non-negative"):
        Interval(zone=IntensityZone.Z3, duration_seconds=60, target_watts=-10)


def test_interval_valid() -> None:
    i = Interval(zone=IntensityZone.Z4, duration_seconds=120, target_watts=250)
    assert i.duration_seconds == 120
    assert i.target_watts == 250
