"""FastAPI error handlers — map domain errors to HTTP responses."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from intervals.shared.errors import (
    DomainRuleError,
    InfrastructureError,
    NotFoundError,
    ValidationError,
)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ValidationError)
    async def validation_error_handler(
        request: Request, exc: ValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": str(exc)}},
        )

    @app.exception_handler(DomainRuleError)
    async def domain_rule_error_handler(
        request: Request, exc: DomainRuleError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "domain_rule_error", "message": str(exc)}},
        )

    @app.exception_handler(NotFoundError)
    async def not_found_error_handler(
        request: Request, exc: NotFoundError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": str(exc)}},
        )

    @app.exception_handler(InfrastructureError)
    async def infrastructure_error_handler(
        request: Request, exc: InfrastructureError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "Internal server error"}},
        )
