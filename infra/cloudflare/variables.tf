variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Tunnel and Access application"
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a real 32-character Cloudflare account ID."
  }
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for zeaz.dev"
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be the real 32-character Cloudflare zone ID, not a placeholder."
  }
}

variable "cloudflare_tunnel_name" {
  description = "Name of the remotely managed Cloudflare Tunnel"
  type        = string
  default     = "zc"

  validation {
    condition     = length(trimspace(var.cloudflare_tunnel_name)) > 0
    error_message = "cloudflare_tunnel_name must not be empty."
  }
}

variable "zc_domain" {
  description = "Canonical same-origin hostname for the zc web workspace and API"
  type        = string
  default     = "zeaz.dev"

  validation {
    condition     = var.zc_domain == "zeaz.dev"
    error_message = "zc_domain must remain zeaz.dev."
  }
}

variable "cloudflare_access_team_name" {
  description = "Cloudflare Zero Trust team name used by cloudflared Access validation"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.cloudflare_access_team_name))
    error_message = "cloudflare_access_team_name must contain only lowercase letters, digits, and hyphens."
  }
}

variable "allowed_emails" {
  description = "Explicit user email addresses allowed through Cloudflare Access"
  type        = set(string)

  validation {
    condition = (
      length(var.allowed_emails) > 0 &&
      alltrue([
        for email in var.allowed_emails :
        can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", email))
      ])
    )
    error_message = "allowed_emails must contain at least one valid explicit email address."
  }
}

variable "service_token_ids" {
  description = "Explicit Cloudflare Access service-token IDs allowed for CLI automation"
  type        = set(string)

  validation {
    condition     = length(var.service_token_ids) > 0
    error_message = "service_token_ids must contain at least one explicit service-token ID."
  }
}

variable "access_session_duration" {
  description = "Cloudflare Access browser session duration"
  type        = string
  default     = "4h"

  validation {
    condition     = contains(["15m", "30m", "1h", "2h", "4h", "8h"], var.access_session_duration)
    error_message = "access_session_duration must be one of 15m, 30m, 1h, 2h, 4h, or 8h."
  }
}

variable "local_origin_url" {
  description = "Loopback-only HTTP origin reached by cloudflared"
  type        = string
  default     = "http://127.0.0.1:8000"

  validation {
    condition     = var.local_origin_url == "http://127.0.0.1:8000"
    error_message = "local_origin_url must remain http://127.0.0.1:8000."
  }
}
