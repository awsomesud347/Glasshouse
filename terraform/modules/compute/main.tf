variable "public_subnet_id" {
  description = "Public subnet ID for EC2"
  type        = string
}

variable "ec2_sg_id" {
  description = "Security group ID for EC2"
  type        = string
}

variable "pepper_arn" {
  description = "ARN of pepper secret in Secrets Manager"
  type        = string
}

variable "jwt_secret_arn" {
  description = "ARN of JWT secret in Secrets Manager"
  type        = string
}

variable "db_url_arn" {
  description = "ARN of DB URL secret in Secrets Manager"
  type        = string
}

variable "key_name" {
  description = "Name of the EC2 key pair for SSH access"
  type        = string
}

# IAM role for EC2 — allows it to read from Secrets Manager
resource "aws_iam_role" "ec2" {
  name = "vault-ec2-role"

  # trust policy — allows EC2 service to assume this role
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "vault-ec2-role"
  }
}

# IAM policy — exactly which secrets EC2 can read
resource "aws_iam_policy" "ec2_secrets" {
  name        = "vault-ec2-secrets-policy"
  description = "Allow EC2 to read vault secrets from Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          var.pepper_arn,
          var.jwt_secret_arn,
          var.db_url_arn
        ]
      }
    ]
  })
}

# Attach policy to role
resource "aws_iam_role_policy_attachment" "ec2_secrets" {
  role       = aws_iam_role.ec2.name
  policy_arn = aws_iam_policy.ec2_secrets.arn
}

# Instance profile — wraps the role so EC2 can use it
resource "aws_iam_instance_profile" "ec2" {
  name = "vault-ec2-profile"
  role = aws_iam_role.ec2.name
}

# EC2 instance
resource "aws_instance" "main" {
  ami                    = "ami-0c02fb55956c7d316"  # Amazon Linux 2 us-east-1
  instance_type          = "t3.micro"               # free tier eligible
  subnet_id              = var.public_subnet_id
  vpc_security_group_ids = [var.ec2_sg_id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = var.key_name

  # user data — runs once on first boot
  # installs Docker and Docker Compose
  user_data = <<-EOF
    #!/bin/bash
    yum update -y
    yum install -y docker
    systemctl start docker
    systemctl enable docker
    usermod -aG docker ec2-user

    # install docker compose plugin
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64 \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  EOF

  tags = {
    Name = "vault-ec2"
  }
}

# Elastic IP — gives EC2 a static public IP that survives reboots
resource "aws_eip" "main" {
  instance = aws_instance.main.id
  domain   = "vpc"

  tags = {
    Name = "vault-eip"
  }
}

# Outputs
output "ec2_public_ip" {
  value = aws_eip.main.public_ip
}

output "ec2_instance_id" {
  value = aws_instance.main.id
}