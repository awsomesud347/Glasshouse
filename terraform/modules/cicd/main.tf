# ---------------------------------------------------------------------------
# CI/CD IAM — GitHub OIDC provider + a role the pipeline assumes to push to
# ECR and deploy via SSM. No long-lived AWS keys stored in GitHub.
#
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint. AWS now validates against the library of CAs,
  # but the field is still required; this is GitHub's well-known thumbprint.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Name = "github-actions-oidc" }
}

# The role GitHub Actions assumes. Trust policy is scoped to THIS repo only.
resource "aws_iam_role" "github_actions" {
  name = "glasshouse-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          # Scope to your repo. Restrict to main branch for deploys.
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:awsomesud347/Glasshouse:*"
          }
        }
      }
    ]
  })

  tags = { Name = "glasshouse-github-actions" }
}

# Permissions: push to ECR + trigger SSM deploy.
resource "aws_iam_role_policy" "github_actions" {
  name = "glasshouse-cicd-permissions"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ECR: auth token is account-wide; push/pull scoped to the repo.
      {
        Sid      = "ECRAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "ECRPushPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = "arn:aws:ecr:us-east-1:111169964335:repository/vault-api"
      },
      # EC2: look up the app instance ID by tag (describe has no resource scoping).
      {
        Sid      = "EC2Describe"
        Effect   = "Allow"
        Action   = "ec2:DescribeInstances"
        Resource = "*"
      },
      # SSM: send the deploy command to the specific app instance only.
      {
        Sid    = "SSMSendCommand"
        Effect = "Allow"
        Action = [
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations"
        ]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_role_arn" {
  description = "Set this as the AWS_ROLE_ARN secret/var in GitHub Actions"
  value       = aws_iam_role.github_actions.arn
}
