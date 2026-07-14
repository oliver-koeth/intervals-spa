"""Workout CRUD routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from intervals.application.contracts import WorkoutRequest, WorkoutResponse
from intervals.application.orchestration import WorkoutService
from intervals.infrastructure.workout_store import WorkoutStore

router = APIRouter(prefix="/workouts", tags=["workouts"])

# Simple singleton store — replace with dependency-injected persistent store.
_store = WorkoutStore()
_service = WorkoutService(_store)


def get_service() -> WorkoutService:
    return _service


@router.get("", response_model=list[WorkoutResponse])
async def list_workouts(
    service: WorkoutService = Depends(get_service),
) -> list[WorkoutResponse]:
    return service.list_all()


@router.post("", response_model=WorkoutResponse, status_code=201)
async def create_workout(
    body: WorkoutRequest,
    service: WorkoutService = Depends(get_service),
) -> WorkoutResponse:
    return service.create(body)


@router.get("/{workout_id}", response_model=WorkoutResponse)
async def get_workout(
    workout_id: str,
    service: WorkoutService = Depends(get_service),
) -> WorkoutResponse:
    return service.get(workout_id)
