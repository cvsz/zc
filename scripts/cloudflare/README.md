# Cloudflare Operations

Terraform under `infra/cloudflare/` is the only canonical owner of the
`zeaz.dev` DNS record, Cloudflare Tunnel configuration, Access application,
and Access policies.

Read-only discovery, validation, plan generation, and live smoke checks may run
without a mutation flag. The following operations change external state and
must only run after an operator has reviewed the exact command and granted
approval:

- Terraform import: `APPLY=true CONFIRM_TERRAFORM_IMPORT=yes`
- Credential rotation: `ZC_ALLOW_CLOUDFLARE_CREDENTIAL_MUTATION=true --yes`
- Terraform apply: run directly only after reviewing a saved plan

Token helpers are restricted to the canonical DNS, Zero Trust Access, and
Tunnel scopes. This repository does not generate Workers, Pages, R2, D1, WAF,
AI Gateway, or other product tokens. It also does not deploy those products.

Production `cloudflared` receives its tunnel token through the permission-
restricted token file documented in `deploy/systemd/cloudflared-zc.service`.
Never put a tunnel token on a process command line or commit it to Git.
