variable "private_subnet_ids" {
  description = "List of private subnet IDs for RDS"
  type        = list(string)
}

variable "rds_sg_id" {
  description = "Security group ID for RDS"
  type        = string
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

# DB subnet group — assigns subnets to RDS
resource "aws_db_subnet_group" "main" {
  name       = "vault-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "vault-db-subnet-group"
  }
}

# RDS PostgreSQL instance
resource "aws_db_instance" "main" {
  identifier        = "vault-db"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t3.micro"    # free tier eligible
  allocated_storage = 20               # GB, minimum for free tier

  db_name  = "vaultdb"
  username = "admin"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_sg_id]

  # free tier — no multi-AZ, no read replicas
  multi_az            = false
  publicly_accessible = false    # private subnet, no public access ever

  # backups
  backup_retention_period = 7    # keep 7 days of backups
  backup_window           = "03:00-04:00"

  # don't delete the DB if terraform destroy is run accidentally
  deletion_protection = true

  # skip final snapshot on destroy (fine for dev, remove for prod)
  skip_final_snapshot = true

  tags = {
    Name = "vault-db"
  }
}

# Outputs
output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "rds_db_name" {
  value = aws_db_instance.main.db_name
}