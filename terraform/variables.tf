variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "your_ip" {
  description = "Your IP CIDR for SSH access (e.g. x.x.x.0/24)"
  type        = string
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "pepper" {
  description = "Server-side pepper for auth_key hashing"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret"
  type        = string
  sensitive   = true
}

variable "key_name" {
  description = "Name of EC2 key pair for SSH access"
  type        = string
}

variable "db_backup_retention_days" {
  description = "RDS backup retention in days. Free-tier capped; production would use 7-35."
  type        = number
  default     = 1
}