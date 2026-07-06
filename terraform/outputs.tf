output "ec2_public_ip" {
  description = "Public IP of EC2 instance — point Cloudflare DNS here"
  value       = module.compute.ec2_public_ip
}

output "rds_endpoint" {
  description = "RDS endpoint — stored in Secrets Manager"
  value       = module.database.rds_endpoint
}
output "github_actions_role_arn" {
  value = module.cicd.github_actions_role_arn
}