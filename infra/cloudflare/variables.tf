variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for zeaz.dev"
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be the real 32-character Cloudflare zone ID, not a placeholder."
  }
}

variable "cloudflare_tunnel_id" {
  description = "Cloudflare Tunnel UUID for zeaz.dev"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$", var.cloudflare_tunnel_id))
    error_message = "cloudflare_tunnel_id must be the real Cloudflare Tunnel UUID, not a placeholder."
  }
}

variable "zc_domain" {
  description = "Canonical zc web application hostname"
  type        = string
  default     = "zai.zeaz.dev"

  validation {
    condition     = var.zc_domain == "zai.zeaz.dev"
    error_message = "zc_domain must remain zai.zeaz.dev."
  }
}

variable "zc_api_domain" {
  description = "Canonical zc Enterprise API hostname"
  type        = string
  default     = "api.zeaz.dev"

  validation {
    condition     = var.zc_api_domain == "api.zeaz.dev"
    error_message = "zc_api_domain must remain api.zeaz.dev."
  }
}
