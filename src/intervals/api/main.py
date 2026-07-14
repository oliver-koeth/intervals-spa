"""FastAPI application factory and entry point."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from intervals.api.error_handlers import register_error_handlers
from intervals.api.routers import health, workouts
from intervals.infrastructure.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()

    application = FastAPI(
        title="intervals-spa API",
        version="0.1.0",
        description="Training interval management REST API.",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_error_handlers(application)

    application.include_router(health.router, prefix="/api/v1")
    application.include_router(workouts.router, prefix="/api/v1")

    return application


app = create_app()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "intervals.api.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=False,
    )
