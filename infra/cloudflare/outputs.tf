output "zc_dns_record" {
  description = "Canonical zc DNS record managed by Terraform"
  value = {
    id      = cloudflare_dns_record.zc.id
    name    = cloudflare_dns_record.zc.name
    type    = cloudflare_dns_record.zc.type
    content = cloudflare_dns_record.zc.content
    proxied = cloudflare_dns_record.zc.proxied
  }
}

output "zc_tunnel_id" {
  description = "Cloudflare Tunnel ID used by the local cloudflared connector"
  value       = cloudflare_zero_trust_tunnel_cloudflared.zc.id
}

output "zc_access_audience" {
  description = "Audience tag expected in the Cloudflare Access JWT"
  value       = cloudflare_zero_trust_access_application.zc.aud
}
