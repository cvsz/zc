resource "cloudflare_zero_trust_tunnel_cloudflared" "zc" {
  account_id = var.cloudflare_account_id
  name       = var.cloudflare_tunnel_name
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_access_policy" "users" {
  account_id       = var.cloudflare_account_id
  name             = "zc explicit users"
  decision         = "allow"
  session_duration = var.access_session_duration
  include = [
    for email in var.allowed_emails : {
      email = {
        email = email
      }
    }
  ]
}

resource "cloudflare_zero_trust_access_policy" "cli_services" {
  account_id = var.cloudflare_account_id
  name       = "zc explicit cli service auth"
  decision   = "non_identity"
  include = [
    {
      service_token = [var.service_token_id]
    }
  ]
}


resource "cloudflare_zero_trust_access_application" "zc" {
  account_id                = var.cloudflare_account_id
  name                      = "zc at zeaz.dev"
  domain                    = var.zc_domain
  type                      = "self_hosted"
  session_duration          = var.access_session_duration
  app_launcher_visible      = true
  service_auth_401_redirect = true
  policies = [
    { id = cloudflare_zero_trust_access_policy.users.id },
  ]
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "zc" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.zc.id
  source     = "cloudflare"

  config = {
    ingress = [
      {
        hostname = var.zc_domain
        service  = var.local_origin_url
        origin_request = {
          access = {
            aud_tag   = [cloudflare_zero_trust_access_application.zc.aud]
            team_name = var.cloudflare_access_team_name
            required  = true
          }
        }
      },
      {
        service = "http_status:404"
      },
    ]
  }
}

resource "cloudflare_dns_record" "zc" {
  zone_id = var.cloudflare_zone_id
  name    = var.zc_domain
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.zc.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "zc web workspace and API via Cloudflare Tunnel"
}

resource "cloudflare_zero_trust_access_application" "sso" {
  account_id                = var.cloudflare_account_id
  name                      = "Authentik SSO"
  type                      = "saas"
  session_duration          = "24h"
  app_launcher_visible      = true
  auto_redirect_to_identity = false

  policies = [
    { id = cloudflare_zero_trust_access_policy.users.id },
  ]

  saas_app = {
    auth_type            = "saml"
    consumer_service_url = "https://auth.zeaz.dev/source/saml/cloudflare-access/acs/"
    sp_entity_id         = "https://auth.zeaz.dev/source/saml/cloudflare-access/"
    name_id_format       = "email"
  }
}
