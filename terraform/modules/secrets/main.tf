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

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "rds_endpoint" {
  description = "RDS endpoint from database module"
  type        = string
}

variable "rds_db_name" {
  description = "RDS database name"
  type        = string
}

# Pepper for auth_key hashing
resource "aws_secretsmanager_secret" "pepper" {
  name        = "vault/pepper"
  description = "Server-side pepper for auth_key hashing"

  tags = {
    Name = "vault-pepper"
  }
}

resource "aws_secretsmanager_secret_version" "pepper" {
  secret_id     = aws_secretsmanager_secret.pepper.id
  secret_string = var.pepper
}

# JWT secret
resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "vault/jwt-secret"
  description = "JWT signing secret"

  tags = {
    Name = "vault-jwt-secret"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}

# Database credentials
resource "aws_secretsmanager_secret" "db_url" {
  name        = "vault/db-url"
  description = "Full database connection URL"

  tags = {
    Name = "vault-db-url"
  }
}

resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id     = aws_secretsmanager_secret.db_url.id
  secret_string = "postgresql+asyncpg://admin:${var.db_password}@${var.rds_endpoint}/${var.rds_db_name}"
}

# Outputs — EC2 needs these secret ARNs for IAM policy
output "pepper_arn" {
  value = aws_secretsmanager_secret.pepper.arn
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt_secret.arn
}

output "db_url_arn" {
  value = aws_secretsmanager_secret.db_url.arn
}