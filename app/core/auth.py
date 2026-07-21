from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_config


@dataclass(frozen=True)
class Principal:
    """Verified request identity used by HTTP and service boundaries."""

    subject: str
    tenant_id: str
    roles: frozenset[str]


_bearer = HTTPBearer(auto_error=False)
_SAFE_SUBJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$")
_SAFE_TENANT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_ALLOWED_ROLES = frozenset({"admin", "developer", "agent", "cli_service", "viewer"})


def create_application_token(
    subject: str,
    tenant_id: str,
    roles: list[str],
    expiry_seconds: int | None = None,
) -> str:
    """Create a validated, bounded application JWT on the local operator host."""
    config = get_config()
    if not config.jwt_secret:
        raise RuntimeError("JWT_SECRET is not configured")
    if not _SAFE_SUBJECT.fullmatch(subject):
        raise ValueError("subject must be a safe opaque identifier")
    if not _SAFE_TENANT.fullmatch(tenant_id):
        raise ValueError("tenant_id must be a safe opaque identifier")
    normalized_roles = sorted(set(roles))
    if not normalized_roles or not set(normalized_roles).issubset(_ALLOWED_ROLES):
        raise ValueError("roles contain an unsupported application role")
    lifetime = config.jwt_expiry_seconds if expiry_seconds is None else expiry_seconds
    if lifetime < 60 or lifetime > 86400:
        raise ValueError("token expiry must be between 60 and 86400 seconds")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "tenant_id": tenant_id,
        "roles": normalized_roles,
        "iss": config.jwt_issuer,
        "aud": config.jwt_audience,
        "exp": now + timedelta(seconds=lifetime),
        "iat": now,
    }
    return jwt.encode(payload, config.jwt_secret, algorithm=config.jwt_algorithm)


def create_short_lived_token(subject: str, role: str) -> str:
    """Backward-compatible single-role token helper."""
    return create_application_token(subject, subject, [role])


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode token."""
    try:
        config = get_config()
        if not config.jwt_secret:
            return None
        payload = jwt.decode(
            token,
            config.jwt_secret,
            algorithms=[config.jwt_algorithm],
            issuer=config.jwt_issuer,
            audience=config.jwt_audience,
            options={
                "require": ["sub", "tenant_id", "roles", "iss", "aud", "exp", "iat"]
            },
        )
        subject = payload.get("sub")
        tenant_id = payload.get("tenant_id")
        if not isinstance(subject, str) or not _SAFE_SUBJECT.fullmatch(subject):
            return None
        if not isinstance(tenant_id, str) or not _SAFE_TENANT.fullmatch(tenant_id):
            return None
        roles = payload.get("roles")
        if not isinstance(roles, list) or not all(
            isinstance(role, str) and role for role in roles
        ):
            return None
        if not roles or not set(roles).issubset(_ALLOWED_ROLES):
            return None
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


async def require_principal(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Principal:
    """Require a valid short-lived bearer token and normalized tenant claim."""
    config = get_config()
    if not config.auth_required:
        principal = Principal("development", "default", frozenset({"admin"}))
        request.state.principal = principal
        return principal
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = verify_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raw_roles = payload["roles"]
    roles = frozenset(str(role) for role in raw_roles if role)
    tenant_id = payload["tenant_id"]
    principal = Principal(str(payload["sub"]), tenant_id, roles)
    request.state.principal = principal
    return principal


def require_roles(*allowed_roles: str):
    """Build a dependency enforcing at least one allowed role."""

    async def authorize(
        principal: Principal = Depends(require_principal),
    ) -> Principal:
        if not principal.roles.intersection(allowed_roles):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return principal

    return authorize
