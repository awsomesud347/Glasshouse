# ---------------------------------------------------------------------------
# Glasshouse — On-Demand Monitoring Stack (standalone Terraform config)
#
# Provisions an ephemeral EC2 instance running Prometheus + Grafana that
# scrapes the app instance's /metrics over the private VPC network.
#
#   terraform apply    -> spin up monitoring
#   terraform destroy  -> tear it down (also removes the app-SG ingress rule)
#
# This config is INTENTIONALLY separate from the main infrastructure config.
# It references existing resources (VPC, subnet, app SG) via data sources and
# never modifies the main config's state. The only thing it adds to existing
# infra is a single standalone ingress rule on the app SG (removed on destroy).
#
# NOTE on inline vs standalone SG rules: the app SG (vault-ec2-sg) defines its
# rules inline. This config adds a SEPARATE aws_security_group_rule for a
# different port/source. They manage non-overlapping rules and coexist safely.
# Do not add an overlapping inline rule for 443-from-monitoring in the main
# config, or the two will fight.
# ---------------------------------------------------------------------------

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region (must match the app infrastructure)"
  type        = string
  default     = "us-east-1"
}

variable "your_ip" {
  description = "Your IP CIDR for SSH access to the monitoring instance"
  type        = string
}

variable "key_name" {
  description = "EC2 key pair for SSH (reuses the app key)"
  type        = string
  default     = "vault-key"
}

variable "monitoring_instance_type" {
  description = "Instance type for the monitoring host"
  type        = string
  default     = "t3.small" # more RAM than t3.micro — Prometheus+Grafana need it
}

# ---------------------------------------------------------------------------
# Data sources — look up existing infrastructure by the tags the main config set
# ---------------------------------------------------------------------------

data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["vault-vpc"]
  }
}

data "aws_subnet" "public" {
  filter {
    name   = "tag:Name"
    values = ["vault-public-subnet"]
  }
}

# The app instance's security group — we attach an ingress rule to this.
data "aws_security_group" "app" {
  filter {
    name   = "tag:Name"
    values = ["vault-ec2-sg"]
  }
}

# The app instance itself — we need its private IP as the scrape target.
data "aws_instances" "app" {
  filter {
    name   = "tag:Name"
    values = ["vault-ec2"]
  }
  instance_state_names = ["running"]
}

# Amazon Linux 2 AMI (matches the app instance's AMI family)
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

# ---------------------------------------------------------------------------
# Monitoring security group
# ---------------------------------------------------------------------------

resource "aws_security_group" "monitoring" {
  name        = "glasshouse-monitoring-sg"
  description = "Monitoring instance: SSH from operator, egress all"
  vpc_id      = data.aws_vpc.main.id

  ingress {
    description = "SSH from operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.your_ip]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "glasshouse-monitoring-sg"
  }
}

# ---------------------------------------------------------------------------
# Allow the monitoring SG to reach the app's nginx (443) over the private
# network, for scraping /metrics. Identity-based: references the monitoring SG.
# Lives in THIS config so `terraform destroy` here removes it cleanly.
# ---------------------------------------------------------------------------

resource "aws_security_group_rule" "app_allow_monitoring_scrape" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = data.aws_security_group.app.id
  source_security_group_id = aws_security_group.monitoring.id
  description              = "Allow Glasshouse monitoring instance to scrape /metrics via nginx"
}

# ---------------------------------------------------------------------------
# Monitoring EC2 instance
# ---------------------------------------------------------------------------

resource "aws_instance" "monitoring" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.monitoring_instance_type
  subnet_id              = data.aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.monitoring.id]
  key_name               = var.key_name

  user_data = <<-EOF
    #!/bin/bash
    yum update -y
    yum install -y docker git
    systemctl start docker
    systemctl enable docker
    usermod -aG docker ec2-user

    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64 \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    # Clone the repo to get the monitoring/ configs and the observability compose file.
    cd /home/ec2-user
    git clone https://github.com/awsomesud347/Glasshouse.git
    chown -R ec2-user:ec2-user Glasshouse
  EOF

  tags = {
    Name = "glasshouse-monitoring"
  }
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "monitoring_public_ip" {
  description = "Public IP of the monitoring instance (SSH-tunnel to it for Grafana)"
  value       = aws_instance.monitoring.public_ip
}

output "app_private_ip" {
  description = "Private IP of the app instance — set this as the Prometheus scrape target"
  value       = length(data.aws_instances.app.private_ips) > 0 ? data.aws_instances.app.private_ips[0] : "APP_INSTANCE_NOT_RUNNING"
}

output "scrape_target_hint" {
  description = "What to set API_METRICS_TARGET to on the monitoring instance"
  value       = length(data.aws_instances.app.private_ips) > 0 ? "${data.aws_instances.app.private_ips[0]}:443" : "app instance not found"
}
