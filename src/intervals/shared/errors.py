"""Shared error hierarchy for the intervals package."""
from __future__ import annotations


class IntervalsError(Exception):
    """Base error for all intervals domain exceptions."""


class ValidationError(IntervalsError):
    """Input/schema validation failure (maps to HTTP 400 / exit code 2)."""


class DomainRuleError(IntervalsError):
    """Domain invariant violation (maps to HTTP 422 / exit code 3)."""


class NotFoundError(IntervalsError):
    """Requested resource does not exist (maps to HTTP 404 / exit code 3)."""


class InfrastructureError(IntervalsError):
    """Persistence or external I/O failure (maps to HTTP 500 / exit code 4)."""
