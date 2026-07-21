# zc Cloudflare Terraform

Terraform-managed DNS, Tunnel, ingress, and Access policy for the zc
local-first full-stack.

Managed hostname:

- `zeaz.dev` — zc web workspace and `/v1` API on one origin

Rules:

- Use scoped `CLOUDFLARE_API_TOKEN`.
- Do not use Global API Key.
- Protect the entire hostname with one Cloudflare Access application.
- Allow only explicit email addresses and explicit CLI service-token IDs.
- Keep the final Tunnel ingress rule at `http_status:404`.
- Keep the origin fixed at `http://127.0.0.1:8000`.
- Do not commit `.env`, `.env.cloudflare`, `.tfvars`, `.terraform/`, or Terraform state.
- Import an existing Tunnel, Access application/policies, and DNS record before apply.
- Apply requires explicit Makefile guards.

The Tunnel token is retrieved after apply/import and stored outside Terraform
configuration. Never print it or commit it.
