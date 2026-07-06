# Production Deployment

How the maintained live instance of Glasshouse runs on AWS. This documents the real deployment behind `passmanager.sudarshankaushik.com` — the architecture, the provisioning, the delivery pipeline, and the operational workflow. It is a reference for how the system is operated, not a copy-paste tutorial; account IDs, domains, and IPs are specific to this instance.

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

**nginx (reverse proxy).** The only process bound to a host port (443). Terminates the Cloudflare origin TLS, applies request rate limiting, access-controls `/metrics` (allowed from the private monitoring subnet, blocked from the public internet), and proxies to the API container over the Docker network. The API is never published to the host.

**RDS PostgreSQL (data).** Managed Postgres in a private subnet with no public address. Reachable only from the API's security group. Automated backups and point-in-time recovery are enabled. Choosing managed RDS over a self-run database buys automated backups, patching, and failover capability that a container on the instance would not have.

**Secrets Manager + IAM (secrets).** The pepper, JWT secret, and database URL live in Secrets Manager. The EC2 instance assumes an IAM role scoped to `GetSecretValue` on exactly those three ARNs. Values are fetched via the role at deploy time and injected as container environment variables.

**Systems Manager (deploy channel).** The instance is an SSM-managed node. The CI/CD pipeline deploys by sending a command over SSM rather than opening an SSH session — so no inbound SSH port is required for automated deploys.

---

## Provisioning (Terraform)

All AWS infrastructure is defined in Terraform under `terraform/`. The core stack is a chain of modules with explicit dependencies:

| Module      | Provisions                                                                 |
|-------------|----------------------------------------------------------------------------|
| networking  | VPC, public subnet, two private subnets (two AZs), IGW, route table, API + RDS security groups |
| database    | RDS subnet group, PostgreSQL instance, backups                             |
| secrets     | Three Secrets Manager secrets (DB URL assembled from the RDS endpoint output) |
| compute     | IAM role + least-privilege policy + instance profile (Secrets Manager + SSM), EC2 instance, Elastic IP |
| cicd        | GitHub OIDC provider and the pipeline's IAM role (trust-scoped to the repo; ECR + SSM permissions) |

Outputs flow forward: networking's subnet and security-group IDs feed database and compute; database's endpoint feeds the secrets module's DB-URL secret; secrets' ARNs feed compute's IAM policy. A single `terraform apply` builds the core stack in order.

```bash
cd terraform
terraform init
terraform plan      # review before applying
terraform apply
```

**On-demand infrastructure** — the monitoring and load-generation stacks — lives in separate standalone Terraform configurations (`terraform/monitoring/`, `terraform/loadgen/`) with their own state. Each is applied to spin up and destroyed to tear down, independently of the core stack, so ephemeral infrastructure never touches the production state.

Sensitive inputs (DB password, pepper, JWT secret, operator IP, key name) live in `terraform.tfvars`, which is gitignored. The provider lock file is committed; state, tfvars, and `.terraform/` are not.

State is currently local. Migrating it to an encrypted S3 backend with locking is the prerequisite for the pipeline *provisioning* infrastructure; note that the pipeline already *deploys the application* today without needing remote state, since application delivery does not run Terraform.

---

## Delivery pipeline (CI/CD)

Application delivery is automated through **GitHub Actions**. Infrastructure provisioning (Terraform) remains a separate, manually-run concern; the pipeline ships application code onto the already-provisioned stack.

**CI** runs on every push and pull request:

- **Secret scanning** (gitleaks) across repository history.
- **Dependency-vulnerability audit** (pip-audit) against `backend/requirements.txt`.
- **Docker image build.**
- **Container-image vulnerability scan** (Trivy), failing on critical findings.

A failure blocks the merge.

**CD** runs after a successful CI run on `main`:

1. Authenticate to AWS via **GitHub OIDC** — the workflow assumes a repo-scoped IAM role; no AWS keys are stored in GitHub.
2. Build the API image, tag it with the **commit SHA**, and push to ECR.
3. Deploy over **SSM**: a remote command on the instance logs in to ECR (via the instance's IAM role), pulls the SHA-tagged image, and recreates the API container. The image tag is injected so the running container is pinned to that exact commit.
4. **Health-check** the live service and fail the deploy if it does not come up.

The two security-relevant choices — OIDC (no long-lived pipeline credentials) and SSM (no inbound SSH for the deploy) — remove standing attack surface that a "store an AWS key and SSH in to pull" pipeline would introduce. SHA-tagged images make deploys deterministic and every running container traceable to its commit.

---

## Manual deploy (fallback)

The pipeline is the normal path. A manual deploy is still possible for break-glass situations — build and push to ECR, then on the instance:

```bash
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d api
```

The instance pulls from ECR using its IAM role — no registry credentials are stored on the box. The `backend/.env` on the instance is populated from Secrets Manager and is gitignored, so a `git pull` never touches it.

The production compose file differs from the local one in two ways: it runs the API from the ECR image rather than building from source, and it adds nginx with the TLS config and cert mounts. It does **not** run a Postgres container — the database is RDS, selected purely through `DATABASE_URL`.

---

## Observability

The live instance is instrumented with **Prometheus** metrics — HTTP request rate, error rate, and latency histograms via `prometheus-fastapi-instrumentator`, plus custom domain counters (login success/failure, registrations, vault operations, version conflicts). Metrics expose at `/metrics`, access-controlled at nginx: reachable over the private network for scraping, blocked from the public internet.

**Grafana** dashboards are provisioned as code (committed datasource and dashboard JSON), covering the HTTP overview and the domain metrics.

The monitoring stack runs on a **dedicated on-demand instance**, provisioned by `terraform/monitoring/` and scraping the app over the private VPC. It is spun up when needed and destroyed when idle, so monitoring is decoupled from the workload and costs nothing at rest. See the [README load-testing section](../README.md#load-testing--capacity) for capacity results gathered through this stack.

---

## TLS

Two TLS hops:

- **Browser → Cloudflare:** Cloudflare's edge certificate (Universal SSL) for the API subdomain.
- **Cloudflare → origin:** a Cloudflare Origin Certificate installed in nginx on the instance. Cloudflare's SSL mode is Full (Strict), so the edge validates the origin certificate.

The origin certificate and key live only on the instance, mounted read-only into the nginx container, and are gitignored. They are never committed and never placed in Terraform state.

---

## Operational notes

- **Backups.** Automated RDS backups with point-in-time recovery are on. Retention is free-tier limited and set via a Terraform variable; production-grade retention is a one-line change.
- **Cost.** The always-on stack is designed to sit within AWS free tier — t3.micro EC2, db.t3.micro RDS, one Elastic IP attached to a running instance, minimal Secrets Manager usage. On-demand monitoring and load-generation instances are billed only while running (pennies per session) and destroyed after. A free-tier-compatible budget and billing alerts are configured.
- **Teardown.** `terraform destroy` removes the core stack; the on-demand stacks are destroyed from their own directories. RDS deletion protection must be disabled first when intentionally tearing down.

---

## What this demonstrates

Existing self-hosted password managers rarely cover deployment at all; Glasshouse treats it as a first-class part of the project. It shows a security-critical service operated with: infrastructure as code, least-privilege IAM scoped to specific resource ARNs, secrets in a managed store rather than in code, defense-in-depth networking (edge → proxy → private-subnet database), TLS at every hop, a security-gated CI/CD pipeline with keyless (OIDC) auth and no-SSH (SSM) deploys, reproducible observability, and a clean separation between provisioning infrastructure and deploying the application.