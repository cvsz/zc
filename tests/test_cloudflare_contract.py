"""Regression checks for the local-first Cloudflare publishing contract."""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_HOST = "zeaz.dev"
RETIRED_HOSTS = ("zai.zeaz.dev", "api.zeaz.dev")


def _read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_terraform_uses_one_same_origin_hostname() -> None:
    variables = _read("infra/cloudflare/variables.tf")
    main = _read("infra/cloudflare/main.tf")
    example = _read("infra/cloudflare/terraform.tfvars.example")

    assert 'default     = "zeaz.dev"' in variables
    assert 'variable "zc_api_domain"' not in variables
    assert "var.zc_api_domain" not in main
    assert main.count('resource "cloudflare_dns_record" "zc"') == 1
    assert "for_each" not in main
    assert 'zc_domain = "zeaz.dev"' in example
    assert 'resource "cloudflare_zero_trust_tunnel_cloudflared" "zc"' in main
    assert 'resource "cloudflare_zero_trust_tunnel_cloudflared_config" "zc"' in main
    assert 'resource "cloudflare_zero_trust_access_application" "zc"' in main
    assert 'resource "cloudflare_zero_trust_access_policy" "users"' in main
    assert 'resource "cloudflare_zero_trust_access_policy" "cli_services"' in main
    assert 'service = "http_status:404"' in main
    assert "required  = true" in main
    assert 'default     = "http://127.0.0.1:8000"' in variables


def test_access_example_protects_web_and_api_on_one_hostname() -> None:
    payload = json.loads(
        _read("configs/cloudflare/access/zc-zc-access-policy.example.json")
    )

    assert "api" not in payload
    assert len(payload["applications"]) == 1
    application = payload["applications"][0]
    assert application["hostname"] == CANONICAL_HOST
    assert application["paths"] == ["/", "/v1/*"]
    assert application["defaultDecision"] == "deny"
    assert "explicit-cli-service-auth" in application["policies"]


def test_cloudflared_service_uses_a_token_file_as_non_root() -> None:
    unit = _read("deploy/systemd/cloudflared-zc.service")
    setup = _read("scripts/cloudflare/setup-cloudflare-tunnel.sh")
    repair = _read("scripts/cloudflare/repair-cloudflared-service.sh")

    assert "User=cloudflared" in unit
    assert "Group=cloudflared" in unit
    assert "--token-file /etc/cloudflared/zc.token" in unit
    assert "UMask=0077" in unit
    assert "NoNewPrivileges=true" in unit
    assert "ProtectSystem=strict" in unit
    assert "--token " not in unit
    assert "tunnel create" not in setup
    assert "tunnel route dns" not in setup
    assert 'service install "$CLOUDFLARE_TUNNEL_TOKEN"' not in repair
    assert "install -o cloudflared -g cloudflared -m 400" in setup
    assert "install -d -o root -g cloudflared -m 750" in setup
    assert 'owner" == "cloudflared"' in setup


def test_cloudflared_repair_requires_explicit_host_mutation_confirmation() -> None:
    repair = _read("scripts/cloudflare/repair-cloudflared-service.sh")

    assert 'APPLY="${APPLY:-false}"' in repair
    assert 'CONFIRM_SYSTEMD_INSTALL="${CONFIRM_SYSTEMD_INSTALL:-no}"' in repair
    assert "CONFIRM_LEGACY_TUNNEL_COEXISTENCE" in repair
    assert 'source "$file"' not in repair
    assert 'token_owner" == "cloudflared"' in repair
    assert "sudo systemctl enable --now" in repair


def test_native_preflight_has_source_and_installed_modes() -> None:
    preflight = ROOT / "scripts/native-deployment-preflight.sh"
    source = preflight.read_text(encoding="utf-8")

    assert preflight.stat().st_mode & 0o111
    assert "--require-installed" in source
    assert "systemd-analyze verify" in source
    assert "ExecStart=/bin/true" in source
    assert "systemd manager is not queryable" in source
    assert "installation state cannot be verified without systemd access" in source
    assert "cloudflared.service is active" in source
    assert "/etc/cloudflared/zc.token" in source
    assert "127.0.0.1:" in source
    assert "sudo " not in source


def test_production_runtime_requires_cloudflare_access_configuration() -> None:
    compose = yaml.safe_load(_read("docker-compose.production.yml"))
    environment = compose["services"]["zc"]["environment"]

    assert environment["CLOUDFLARE_ACCESS_REQUIRED"] == "true"
    assert (
        "CLOUDFLARE_ACCESS_TEAM_DOMAIN is required"
        in environment["CLOUDFLARE_ACCESS_TEAM_DOMAIN"]
    )
    assert "CLOUDFLARE_ACCESS_AUD is required" in environment["CLOUDFLARE_ACCESS_AUD"]


def test_retired_public_hostnames_are_confined_to_rejection_checks() -> None:
    contract_files = [
        ".env.example",
        "infra/cloudflare/main.tf",
        "infra/cloudflare/variables.tf",
        "infra/cloudflare/terraform.tfvars.example",
        "scripts/cloudflare/cloudflare-stability-check.sh",
        "scripts/cloudflare/sync-zc-terraform-env-from-api.sh",
        "scripts/cloudflare/zc-cloudflare-preflight.sh",
        "scripts/cloudflare/zc-terraform-env-guard.sh",
        "scripts/cloudflare/zc-terraform-integrate.sh",
        "scripts/cloudflare/zc-verify-live.sh",
    ]

    for relative_path in contract_files:
        text = _read(relative_path)
        for retired_host in RETIRED_HOSTS:
            assert retired_host not in text, (
                f"{retired_host} remains in {relative_path}"
            )


def test_cloudflare_tunnel_connects_directly_to_the_local_application() -> None:
    assert not (ROOT / "deploy/nginx/zc.conf").exists()
    terraform = _read("infra/cloudflare/variables.tf")
    assert 'default     = "http://127.0.0.1:8000"' in terraform


def test_cloudflare_helpers_cannot_generate_noncanonical_product_tokens() -> None:
    generator = _read("scripts/cloudflare/clean-and-regenerate-tokens.sh")
    preflight = _read("scripts/cloudflare/rotate-tokens-with-permission-preflight.sh")

    for forbidden in ("workers", "pages", "waf", "r2", "d1", "ai_gateway"):
        assert f'[{forbidden}]="' not in generator
        assert f"pick_permission {forbidden}" not in preflight
    assert 'TYPES_CSV="dns,zt,tunnel"' in generator
    assert "ZC_ALLOW_CLOUDFLARE_CREDENTIAL_MUTATION" in generator


def test_terraform_import_requires_explicit_state_mutation_confirmation() -> None:
    importer = _read("scripts/cloudflare/zc-terraform-import-existing.sh")

    assert "APPLY:-false" in importer
    assert "CONFIRM_TERRAFORM_IMPORT:-no" in importer
    assert 'eval "' not in importer


def test_make_runtime_uses_canonical_loopback_origin() -> None:
    makefile = _read("Makefile")

    assert "HOST        ?= 127.0.0.1" in makefile
    assert "PORT        ?= 8000" in makefile
    assert "app.main:app" in makefile
    assert "webapp.backend.server:app" not in makefile
    assert "HOST        ?= 0.0.0.0" not in makefile
    assert "git pull" not in makefile
