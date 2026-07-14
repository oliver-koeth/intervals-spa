"""Parse external payloads into application contracts.

All Pydantic validation failures are caught here and re-raised as
intervals.shared.errors.ValidationError with stable field-path messages.
"""
from __future__ import annotations

from typing import Any, TypeVar

from pydantic import ValidationError as PydanticValidationError

from intervals.application.contracts import BoundaryModel
from intervals.shared.errors import ValidationError

_T = TypeVar("_T", bound=BoundaryModel)


def parse_contract(model_cls: type[_T], payload: dict[str, Any]) -> _T:
    """Parse *payload* into *model_cls*, mapping Pydantic errors to ValidationError."""
    try:
        return model_cls.model_validate(payload)
    except PydanticValidationError as exc:
        messages = "; ".join(
            f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        raise ValidationError(messages) from exc
