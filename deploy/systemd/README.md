# Native Ubuntu services

These units implement the canonical single-host runtime:

```text
Cloudflare Tunnel -> 127.0.0.1:8000 -> zc
```

They assume:

- the reviewed `zcoder` wheel and virtual environment are installed under
  `/opt/zc`;
- the application runs as the unprivileged `zc` user;
- cloudflared runs as the separate `cloudflared` user;
- cloudflared is version `2025.4.0` or newer because the unit uses
  `--token-file`;
- application secrets are stored in `/etc/zc/zc.env` with mode `0600`;
- the tunnel token is stored in `/etc/cloudflared/zc.token` with mode `0600`;
- persistent application state is owned by `zc` under `/var/lib/zc`.

The environment file must define the production settings documented in
`.env.production.example`, including authentication, encryption, CORS, and Cloudflare
Access verification values. Do not copy development defaults into it.

## Prepare the host

Every command in this section changes the host and requires explicit operator
approval. Build and inspect the wheel before using elevated privileges:

```bash
make package-wheel
python -m zipfile --list dist/zcoder-1.33.0-py3-none-any.whl
```

After approval, create separate non-login service users and private
directories:

```bash
sudo useradd --system --home /var/lib/zc --shell /usr/sbin/nologin zc
sudo useradd --system --home /var/lib/cloudflared \
  --shell /usr/sbin/nologin cloudflared
sudo install -d -o root -g root -m 0755 /opt/zc
sudo install -d -o zc -g zc -m 0700 /var/lib/zc
sudo install -d -o root -g root -m 0700 /etc/zc
sudo install -d -o root -g cloudflared -m 0750 /etc/cloudflared
```

Install only the reviewed wheel and the repository-owned LiteLLM
configuration:

```bash
sudo python3 -m venv /opt/zc/.venv
sudo install -o root -g root -m 0644 requirements-deploy.lock \
  /opt/zc/requirements-deploy.lock
sudo /opt/zc/.venv/bin/python -m pip install --require-hashes \
  -r /opt/zc/requirements-deploy.lock
sudo /opt/zc/.venv/bin/python -m pip install --no-deps \
  dist/zcoder-1.33.0-py3-none-any.whl
sudo install -o root -g root -m 0644 litellm-config.yaml \
  /opt/zc/litellm-config.yaml
sudo /opt/zc/.venv/bin/python -m pip check
```

Populate secrets through a protected temporary file without putting values on
the command line, then remove the temporary file:

```bash
sudo install -o root -g root -m 0600 \
  /path/to/populated-zc.env /etc/zc/zc.env
sudo install -o cloudflared -g cloudflared -m 0400 \
  /path/to/downloaded-tunnel-token /etc/cloudflared/zc.token
```

The token must be owned by `cloudflared`; mode `0600` owned by root would make
it unreadable after systemd drops privileges.

## Install the units

Review the units and run the non-mutating source preflight first:

```bash
scripts/native-deployment-preflight.sh
```

Installing or enabling units changes the host and requires a separate approval:

```bash
sudo install -o root -g root -m 0644 deploy/systemd/zc.service \
  /etc/systemd/system/zc.service
sudo install -o root -g root -m 0644 deploy/systemd/cloudflared-zc.service \
  /etc/systemd/system/cloudflared-zc.service
sudo systemctl daemon-reload
sudo systemctl enable --now zc.service
curl --fail --silent http://127.0.0.1:8000/ready

APPLY=true \
CONFIRM_SYSTEMD_INSTALL=yes \
CONFIRM_LEGACY_TUNNEL_COEXISTENCE=yes \
scripts/cloudflare/repair-cloudflared-service.sh

scripts/native-deployment-preflight.sh --require-installed
```

Verify the origin remains loopback-only:

```bash
curl --fail --silent http://127.0.0.1:8000/ready
ss -ltnp | grep -E ':8000|:8001'
```

## Legacy tunnel coexistence and cutover

This host may already run `cloudflared.service` for unrelated `zeaz.dev`
subdomains. Do not stop that service as part of the zc installation. A safe
cutover is:

1. Inventory the existing tunnel ingress and confirm which applications still
   depend on it.
2. Start `zc.service` and verify localhost readiness.
3. Start the separate `cloudflared-zc.service` connector while the legacy
   tunnel remains online.
4. Retrieve current Cloudflare state with a working scoped read token.
5. Import existing `zeaz.dev` DNS or Access resources into Terraform state
   where required.
6. Review a saved Terraform plan that changes only the intended zc resources.
7. Obtain explicit approval, apply the reviewed plan, and verify Access deny
   and allow flows.
8. Remove only the obsolete `zeaz.dev` rule from the legacy tunnel through its
   own separately approved change. Keep unrelated hostname rules online.

Never run both Terraform and an unmanaged local ingress as concurrent owners
of the same `zeaz.dev` hostname indefinitely.

Rollback:

```bash
sudo systemctl disable --now cloudflared-zc.service zc.service
```

If Terraform was applied, use the previously reviewed reverse plan to restore
the old `zeaz.dev` DNS/Access route before stopping the new connector. Do not
delete the new tunnel or state during an incident; preserve them for diagnosis.

## Offline backup

Backups stay outside hosted storage. Stop the application briefly so SQLite
and atomic JSON state have one consistent cut, stream an encrypted archive
directly to operator-owned offline media, then restart:

```bash
sudo systemctl stop zc.service
sudo tar -C /var/lib -cf - zc \
  | age --recipient AGE_PUBLIC_RECIPIENT \
      --output /media/offline/zc-data-$(date -u +%Y%m%dT%H%M%SZ).tar.age
sudo systemctl start zc.service
```

Back up `/etc/zc/zc.env`, `/etc/cloudflared/zc.token`, and the local Terraform
state separately with the same encryption and restrictive offline handling.
Never copy plaintext secrets or Terraform state into the repository.

Test restoration on an isolated host before relying on a backup. Restore into
an empty `/var/lib/zc`, reapply ownership `zc:zc` and mode `0700`, then start
`zc.service` and verify `/ready` locally before starting cloudflared.
