terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # S3 backend for state — uncomment after creating the S3 bucket
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "vault/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}

module "networking" {
  source         = "./modules/networking"
  your_ip        = var.your_ip
}

module "database" {
  source             = "./modules/database"
  private_subnet_ids = module.networking.private_subnet_ids
  rds_sg_id          = module.networking.rds_sg_id
  db_password        = var.db_password
  db_backup_retention_days = var.db_backup_retention_days
}

module "secrets" {
  source       = "./modules/secrets"
  db_password  = var.db_password
  rds_endpoint = module.database.rds_endpoint
  rds_db_name  = module.database.rds_db_name
  pepper       = var.pepper
  jwt_secret   = var.jwt_secret
}

module "compute" {
  source           = "./modules/compute"
  public_subnet_id = module.networking.public_subnet_id
  ec2_sg_id        = module.networking.ec2_sg_id
  pepper_arn       = module.secrets.pepper_arn
  jwt_secret_arn   = module.secrets.jwt_secret_arn
  db_url_arn       = module.secrets.db_url_arn
  key_name         = var.key_name
}