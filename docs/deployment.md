# Production Deployment

How the maintained live instance of Glasshouse runs on AWS. This documents the real deployment behind `passmanager.sudarshankaushik.com` — the architecture, the provisioning, and the operational workflow. It is a reference for how the system is operated, not a copy-paste tutorial; account IDs, domains, and IPs are specific to this instance.

For running Glasshouse yourself without AWS, see [self-hosting.md](self-hosting.md).

---

## Topology

```
passmanager.sudarshankaushik.com  →  Vercel (static frontend, global CDN)
                                         │
                                         │  API calls to vault-api.sudarshankaushik.com
                                         ▼
                                     Cloudflare  (DDoS, edge TLS, origin hidden)
                                         │  origin cert; SG admits 443 from Cloudflare IPs only
                                         ▼
                                     EC2 instance (public subnet, Elastic IP)
                                       ├─ nginx container   (443, TLS termination, rate limit)
                                       └─ API container     (Docker network only)
                                         │  SSL
                                         ▼
                                     RDS PostgreSQL (private subnet, no public address)
```

The frontend and backend are deliberately on separate origins and separate platforms. The static frontend is served by Vercel's CDN; the API runs on AWS. They are distinct trust domains, which reinforces the zero-knowledge boundary — the crypto-running static app and the encrypted-blob API are not co-located.

---

## Components and why each exists

**Vercel (frontend).** The frontend is static files that run all cryptography in the browser. It needs a fast CDN, not a managed server. Vercel provides global distribution, automatic TLS, and Git-driven deploys at zero cost and zero server maintenance. `VITE_API_URL` points it at the API domain.

**Cloudflare (edge).** Sits in front of the API. Provides DDoS absorption, edge TLS, and origin-IP hiding. DNS for the API subnet is proxied (orange-cloud); the frontend subdomain is DNS-only because Vercel manages its own certificate.

**EC2 (compute).** A single t3.micro in a public subnet with an Elastic IP for a stable origin address. User-data installs Docker on first boot. Runs two containers via Docker Compose: nginx and the API.

**nginx (reverse proxy).** The only process bound to a host port (443). Terminates the Cloudflare origin TLS, applies request rate limiting, blocks `/metrics` from external access, and proxies to the API container over the Docker network. The API is never published to the host.

**RDS PostgreSQL (data).** Managed Postgres in a private subnet with no public address. Reachable only from the API's security group. Automated backups and point-in-time recovery are enabled. Choosing managed RDS over a self-run database buys automated backups, patching, and failover capability that a container on the instance would not have.

**Secrets Manager + IAM (secrets).** The pepper, JWT secret, and database URL live in Secrets Manager. The EC2 instance assumes an IAM role scoped to `GetSecretValue` on exactly those three ARNs. Values are fetched via the role at deploy time and injected as container environment variables.

---

## Provisioning (Terraform)

All AWS infrastructure is defined in Terraform under `terraform/`, in four modules with an explicit dependency chain:

| Module      | Provisions                                                                 |
|-------------|----------------------------------------------------------------------------|
| networking  | VPC, public subnet, two private subnets (two AZs), IGW, route table, API + RDS security groups |
| database    | RDS subnet group, PostgreSQL instance, backups                             |
| secrets     | Three Secrets Manager secrets (DB URL assembled from the RDS endpoint output) |
| compute     | IAM role + least-privilege policy + instance profile, EC2 instance, Elastic IP |

Outputs flow forward: networking's subnet and security-group IDs feed database and compute; database's endpoint feeds the secrets module's DB-URL secret; secrets' ARNs feed compute's IAM policy. A single `terraform apply` builds the stack in order.

```bash
cd terraform
terraform init
terraform plan      # review before applying
terraform apply
```

Sensitive inputs (DB password, pepper, JWT secret, operator IP, key name) live in `terraform.tfvars`, which is gitignored. The provider lock file is committed; state, tfvars, and `.terraform/` are not.

State is currently local. Migrating it to an encrypted S3 backend with DynamoDB locking is the prerequisite for running Terraform from CI.

---

## Application deploy workflow

The application image is built and pushed separately from infrastructure provisioning.

1. Build the API image locally (or, in future, in CI) and push to ECR:
   ```bash
   docker build -t vault-api ./backend
   docker tag vault-api:latest <account>.dkr.ecr.us-east-1.amazonaws.com/vault-api:latest
   docker push <account>.dkr.ecr.us-east-1.amazonaws.com/vault-api:latest
   ```
2. On the instance, pull the new image and restart:
   ```bash
   docker compose -f docker-compose.prod.yml pull api
   docker compose -f docker-compose.prod.yml up -d
   ```

The instance pulls from ECR using its IAM role — no registry credentials are stored on the box. The `backend/.env` on the instance is populated from Secrets Manager and is gitignored, so a `git pull` never touches it.

The production compose file differs from the local one in two ways: it runs the API from the ECR image rather than building from source, and it adds nginx with the TLS config and cert mounts. It does **not** run a Postgres container — the database is RDS, selected purely through `DATABASE_URL`.

---

## TLS

Two TLS hops:

- **Browser → Cloudflare:** Cloudflare's edge certificate (Universal SSL) for the API subdomain.
- **Cloudflare → origin:** a Cloudflare Origin Certificate installed in nginx on the instance. Cloudflare's SSL mode is Full (Strict), so the edge validates the origin certificate.

The origin certificate and key live only on the instance, mounted read-only into the nginx container, and are gitignored. They are never committed and never placed in Terraform state.

---

## Operational notes

- **Backups.** Automated RDS backups with point-in-time recovery are on. Retention is free-tier limited and set via a Terraform variable; production-grade retention is a one-line change.
- **Cost.** The stack is designed to sit within AWS free tier — t3.micro EC2, db.t3.micro RDS, one Elastic IP attached to a running instance, minimal Secrets Manager usage. A free tier compatible budget and billing alerts are configured.
- **Metrics.** The API exposes Prometheus metrics, reachable only internally; `/metrics` is blocked at nginx from the public internet.
- **Teardown.** `terraform destroy` removes the stack. RDS deletion protection must be disabled first when intentionally tearing down.

---

## What this demonstrates

This deployment is a major point of the project as existing self hosted password managers rarely covery deployment. It shows a security-critical service operated with: infrastructure as code, least-privilege IAM scoped to specific resource ARNs, secrets in a managed store rather than in code, defense-in-depth networking (edge → proxy → private-subnet database), TLS at every hop, and a clean separation between provisioning infrastructure and deploying the application.