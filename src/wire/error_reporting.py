"""Low-noise diagnostics for optional or corrupt local records."""

from __future__ import annotations

import logging


def log_ignored_error(module_name: str, context: str) -> None:
    """Record a best-effort failure without changing CLI output."""
    logging.getLogger(module_name).debug(context, exc_info=True)


__all__ = ["log_ignored_error"]
