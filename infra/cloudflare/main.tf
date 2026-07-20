locals {
  tunnel_target = "${var.cloudflare_tunnel_id}.cfargotunnel.com"

  zc_dns_records = {
    zc_app = {
      name    = var.zc_domain
      type    = "CNAME"
      content = local.tunnel_target
      proxied = true
      comment = "zc via Cloudflare Tunnel"
    }
    zc_api = {
      name    = var.zc_api_domain
      type    = "CNAME"
      content = local.tunnel_target
      proxied = true
      comment = "zc Enterprise API via Cloudflare Tunnel"
    }
  }
}

resource "cloudflare_dns_record" "zc" {
  for_each = local.zc_dns_records

  zone_id = var.cloudflare_zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  proxied = each.value.proxied
  ttl     = 1
  comment = each.value.comment
}
