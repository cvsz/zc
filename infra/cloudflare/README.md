# zc Cloudflare Terraform

Terraform-managed DNS for the zc full-stack.

Managed hostnames:

- `zai.zeaz.dev` — zc web application
- `api.zeaz.dev` — zc Enterprise API

Rules:

- Use scoped `CLOUDFLARE_API_TOKEN`.
- Do not use Global API Key.
- Do not commit `.env`, `.env.cloudflare`, `.tfvars`, `.terraform/`, or Terraform state.
- Import existing DNS records before apply.
- Apply requires explicit Makefile guards.
