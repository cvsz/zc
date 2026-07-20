"""AST policy for narrowly scoped generated document transformations."""

from __future__ import annotations

import ast
from collections.abc import Collection


class RestrictedCodeError(ValueError):
    """Raised when generated code exceeds the document transformation policy."""


_DENIED_NODES = (
    ast.AsyncFunctionDef,
    ast.AsyncFor,
    ast.AsyncWith,
    ast.Await,
    ast.ClassDef,
    ast.Delete,
    ast.FunctionDef,
    ast.Global,
    ast.Import,
    ast.ImportFrom,
    ast.Lambda,
    ast.Nonlocal,
    ast.Raise,
    ast.Try,
    ast.TryStar,
    ast.With,
    ast.Yield,
    ast.YieldFrom,
)


def validate_restricted_code(
    code: str,
    *,
    allowed_calls: Collection[str],
    allowed_methods: Collection[str] = (),
) -> None:
    """Reject imports, definitions, private attributes, and unknown calls."""
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise RestrictedCodeError(f"invalid generated syntax: {exc.msg}") from exc

    allowed_call_names = frozenset(allowed_calls)
    allowed_method_names = frozenset(allowed_methods)
    for node in ast.walk(tree):
        if isinstance(node, _DENIED_NODES):
            raise RestrictedCodeError(
                f"generated code node is not allowed: {type(node).__name__}"
            )
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise RestrictedCodeError("private names are not allowed")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise RestrictedCodeError("private attributes are not allowed")
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name):
            if node.func.id not in allowed_call_names:
                raise RestrictedCodeError(
                    f"generated call is not allowed: {node.func.id}"
                )
            continue
        if isinstance(node.func, ast.Attribute):
            if node.func.attr not in allowed_method_names:
                raise RestrictedCodeError(
                    f"generated method is not allowed: {node.func.attr}"
                )
            continue
        raise RestrictedCodeError("indirect generated calls are not allowed")


def execute_restricted_code(
    code: str,
    *,
    allowed_calls: Collection[str],
    allowed_methods: Collection[str] = (),
    builtins: dict[str, object],
    local_namespace: dict[str, object],
    filename: str,
) -> None:
    """Validate and execute code with an explicit builtins namespace."""
    validate_restricted_code(
        code,
        allowed_calls=allowed_calls,
        allowed_methods=allowed_methods,
    )
    compiled = compile(code, filename, "exec")
    exec(compiled, {"__builtins__": builtins}, local_namespace)  # nosec B102


__all__ = [
    "RestrictedCodeError",
    "execute_restricted_code",
    "validate_restricted_code",
]
