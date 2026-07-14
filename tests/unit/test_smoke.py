"""Smoke test — verify the package imports and app creates without errors."""
from intervals.api.main import create_app
from intervals.domain.enums import IntensityZone, TrainingType, WorkoutStatus


def test_app_creates() -> None:
    app = create_app()
    assert app.title == "intervals-spa API"


def test_enums_importable() -> None:
    assert IntensityZone.Z1.value == "z1"
    assert TrainingType.CYCLING.value == "cycling"
    assert WorkoutStatus.PLANNED.value == "planned"
