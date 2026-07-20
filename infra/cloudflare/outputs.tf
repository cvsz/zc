output "zc_dns_records" {
  description = "zc DNS records managed by Terraform"
  value = {
    for key, record in cloudflare_dns_record.zc :
    key => {
      id      = record.id
      name    = record.name
      type    = record.type
      content = record.content
      proxied = record.proxied
    }
  }
}
