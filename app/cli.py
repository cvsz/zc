"""Lightweight console entry point for the zcoder API service."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
import sys

from dotenv import load_dotenv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the zcoder API service")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--workers", type=int, default=None)
    subparsers = parser.add_subparsers(dest="command")
    token = subparsers.add_parser(
        "token",
        help="Create a short-lived local application JWT",
    )
    token.add_argument("--subject", required=True)
    token.add_argument("--tenant", required=True)
    token.add_argument(
        "--role",
        action="append",
        required=True,
        choices=["admin", "developer", "agent", "cli_service", "viewer"],
    )
    token.add_argument("--expires-in", type=int, default=None)
    return parser


def cli(argv: Sequence[str] | None = None) -> None:
    load_dotenv(override=False)
    args = build_parser().parse_args(argv)
    if args.command == "token":
        from .core.auth import create_application_token

        token = create_application_token(
            subject=args.subject,
            tenant_id=args.tenant,
            roles=args.role,
            expiry_seconds=args.expires_in,
        )
        print(
            "Sensitive application token follows; do not save it in Git.",
            file=sys.stderr,
        )
        print(token)
        return

    from .main import run_server

    run_server(host=args.host, port=args.port, workers=args.workers)


if __name__ == "__main__":
    cli()
