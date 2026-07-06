# Architecture

This document describes the design of Glasshouse and the rationale behind the major decisions. It assumes you have read the [README](../README.md) for the high-level summary.

The guiding principle throughout: **the application is cloud-agnostic, and the deployment is infrastructure-as-code.** These are kept strictly separate so that one codebase runs identically whether self-hosted on a single box or deployed on a hardened AWS stack. Neither half is an afterthought — the cryptographic core and the async application are engineered to the same standard as the infrastructure around them.

---

## 1. The zero-knowledge model

The server is designed to be useless to an attacker who fully compromises it. It never sees the master password, the encryption key, or any plaintext credential. It stores only ciphertext and a verifier.

### Key derivation and split

All cryptography runs in the browser via the WebCrypto API and a WASM Argon2 implementation (`hash-wasm`).

1. The master password and a per-user salt are fed to **Argon2id** (64 MB memory, 3 iterations, parallelism 1).
2. The resulting key material is passed through **HKDF** to derive two independent keys via domain separation:
   - **Encryption key** — used with **AES-256-GCM** to encrypt the vault. Imported as a non-extractable `CryptoKey`, so the browser will not export its raw bytes even to the page's own JavaScript. It never leaves the device.
   - **Auth key** — sent to the server exactly once per session to prove identity.

Deriving two keys from one master secret, rather than asking the user for two secrets, is a **domain-separation** problem, and it is the central cryptographic decision in the system. The key that proves identity to the server and the key that decrypts the vault must never be the same value, or the server would receive material related to the decryption key. HKDF with distinct `info` parameters (`"enc"`, `"auth"`) gives two cryptographically independent keys from the single high-entropy Argon2 output — possession of one reveals nothing about the other.

### What the server stores

The auth key is **not** stored. On registration the server peppers the auth key and hashes it with Argon2 (`argon2-cffi`), producing a **verifier**. On login the server repeats the operation and compares. This means a database compromise yields verifiers, not auth keys — and even the auth key, if it leaked, cannot decrypt the vault, because the encryption key never left the browser.

The vault is stored as a single opaque **encrypted blob** plus its IV and a version counter.

### Consequence: no recovery

If the master password is lost, the vault is unrecoverable. The server has no key escrow and no reset path, because it has nothing capable of decrypting the blob. This is an intentional property of a zero-knowledge design, not an omission.

---

## 2. Data model

A single `users` table holds everything. The vault is one encrypted blob per user rather than per-entry rows, because the server must not be able to distinguish or count individual credentials.

| Column          | Type      | Notes                                                        |
|-----------------|-----------|-------------------------------------------------------------|
| `id`            | String    | UUID primary key                                            |
| `email`         | String    | Unique, indexed — the login identifier                      |
| `salt`          | String    | Per-user KDF salt                                           |
| `kdf_params`    | Text      | JSON of the Argon2 parameters used, stored for forward-compat |
| `verifier`      | String    | Peppered Argon2 hash of the auth key — never the auth key   |
| `vault_blob`    | Text      | AES-256-GCM ciphertext of the entire vault                 |
| `iv`            | String    | Initialization vector for the blob                          |
| `vault_version` | Integer   | Monotonic counter for optimistic concurrency control       |
| `created_at`    | DateTime  | Server timestamp                                            |

Storing `kdf_params` per user matters for the future: if the Argon2 parameters are ever strengthened, existing users can still be derived with the parameters their vault was created under, and migrated on next login.

---

## 3. The application: async from front to back

The backend is a fully asynchronous FastAPI application, and this is a deliberate engineering choice, not a default. Every layer in the request path is async: FastAPI's async route handlers, async SQLAlchemy, and `asyncpg` as the driver. There are no blocking database calls in the hot path.

This matters because the expensive work in this system is I/O, not compute — a vault read is a single indexed query and a blob return; a login is an Argon2 verification plus a lookup. An async stack lets one worker interleave many in-flight requests while they wait on the database, rather than blocking a thread per request. The load-testing results bear this out: on DB-backed reads the database sits near-idle (peak ~8 of ~80 connections) while the web tier is the limiting factor — exactly the profile of an I/O-bound service where the async design is doing its job. (See the [README load-testing section](../README.md#load-testing--capacity).)

The route surface is deliberately small and each route does one thing: the auth routes handle the register/salt/login handshake around the verifier; the vault routes are a straight CRUD surface over the single encrypted blob, guarded by JWT verification and, on writes, the version check below.

---

## 4. Concurrency

Vault writes use **optimistic concurrency control**. A client reads the vault at version *N*. When it writes back, it sends *N*. The server increments to *N+1* only if its stored version still equals *N*; otherwise it returns `409 Conflict`.

This makes the system **conflict-detecting, not conflict-merging**. Two devices editing concurrently will not silently clobber each other — the second writer is told its base is stale and must re-read. What the system does *not* do is merge the two sets of changes; that would require per-entry structure the server deliberately cannot see, since the vault is an opaque blob. The design tension is real and intentional: the same property that makes the server blind to your data (single encrypted blob) is the property that makes server-side merge impossible. Compare-and-set on a version counter is the correct primitive here precisely because it needs to understand nothing about *what* changed — only *that* the base moved. The multi-device implications are covered in the [threat model](../THREAT_MODEL.md).

---

## 5. Request and trust flow

```
Browser (all crypto; keys in memory only)
   │  HTTPS
   ▼
Cloudflare  ── DDoS protection, TLS at the edge, origin IP hidden
   │  HTTPS — origin certificate; EC2 security group admits 443 only from Cloudflare IP ranges
   ▼
nginx (reverse proxy, same host as API)
   │  ── terminates origin TLS, rate limits, access-controls /metrics
   │  Docker bridge network
   ▼
FastAPI (API container)  ── bound to the Docker network only, never published to the host
   │  PostgreSQL wire protocol over SSL
   ▼
PostgreSQL
   ├─ self-host: containerized Postgres on the same compose network
   └─ production: AWS RDS in a private subnet, no public address, reachable only from the API's security group
```

Each hop narrows what is reachable:

- **Cloudflare** is the only thing the public internet talks to. The origin IP is hidden, and DDoS/TLS are handled at the edge.
- The **EC2 security group** admits port 443 only from Cloudflare's published IP ranges, so even though the origin IP exists, traffic from anywhere else is dropped. SSH (22) is admitted only from the operator's address.
- **nginx** is the only process bound to a host port. The API container is published only to the internal Docker network (`expose`, not `ports`), so nothing outside the host can reach the API directly — it is always behind the proxy.
- **RDS** has no public address and lives in a private subnet. Its security group admits 5432 only from the API's security group — an **identity-based** rule, not an IP range, so it keeps working regardless of the API instance's address.

This is defense in depth: an attacker has to defeat several independent controls, not one.

---

## 6. Secrets

Three secrets exist: the server-side `PEPPER`, the `JWT_SECRET`, and the `DATABASE_URL` (which embeds the DB password).

The application reads all three from **environment variables** through a single `get_secret()` function. The application makes **no cloud API calls** — it does not know or care where the values came from. This is the seam that keeps it cloud-agnostic.

How the environment is populated differs by deployment:

- **Self-host:** the operator sets the variables directly — a `.env` file, Docker secrets, or their orchestrator's mechanism.
- **Production (AWS):** the three secrets live in **AWS Secrets Manager**. The EC2 instance has an **IAM role** whose policy grants `secretsmanager:GetSecretValue` on **exactly the three secret ARNs** and nothing else (least privilege). At deploy time the values are fetched via that role and written into the container's environment.

This is a deliberate **deploy-time injection** model rather than a runtime fetch. The tradeoff is discussed in the [threat model](../THREAT_MODEL.md); a runtime fetch with caching is noted as a future enhancement.

---

## 7. Infrastructure as code

The entire AWS deployment is provisioned by **Terraform**, organized into modules with explicit dependencies so Terraform builds them in the correct order. Outputs from one module feed the inputs of the next.

- **networking** — VPC, one public subnet (for the API host), two private subnets across two availability zones (RDS requires a subnet group spanning two AZs), internet gateway, route table, and the two security groups (API and RDS). Outputs the subnet and security-group IDs.
- **database** — the RDS subnet group and the PostgreSQL instance, placed in the private subnets with the RDS security group. Automated backups are enabled; retention is set via a variable (free-tier constrained at present). Consumes networking's outputs.
- **secrets** — the three Secrets Manager secrets. The database URL secret is assembled from the RDS endpoint output, so it is always consistent with the actual database.
- **compute** — the IAM role, least-privilege policy, instance profile, the EC2 instance (with user-data that installs Docker), and an Elastic IP for a stable origin address. Consumes the subnet, security group, and secret ARNs.
- **cicd** — the GitHub OIDC identity provider and the IAM role the pipeline assumes, scoped by trust policy to this repository, with permissions limited to ECR push and SSM deploy.

The core dependency chain (networking → database → secrets → compute) is expressed through Terraform variable passing, so a single `terraform apply` brings up the whole stack in order, and `terraform destroy` tears it down.

**On-demand infrastructure** — the monitoring and load-generation stacks — lives in **separate standalone Terraform configurations with their own state**, deliberately isolated from the core. This lets them be spun up and destroyed independently (`terraform apply`/`destroy` in their own directories) without ever touching the production stack's state. It is the correct pattern for ephemeral, cost-sensitive infrastructure: monitoring should never be able to disturb the thing it monitors.

State is currently local. Moving it to an S3 backend with locking is the next step, required before the pipeline manages infrastructure (as opposed to only deploying the application, which it does today).

---

## 8. Delivery pipeline

The application is delivered by a security-gated **GitHub Actions** pipeline, split into CI and CD.

**CI** runs on every push and pull request: secret scanning (gitleaks), Python dependency-vulnerability audit (pip-audit), a Docker image build, and container-image vulnerability scanning (Trivy). A finding blocks the merge.

**CD** runs on a green CI result on `main`. It authenticates to AWS via **GitHub OIDC** — the workflow assumes an IAM role directly, so no long-lived AWS keys are stored in GitHub. It builds a **commit-SHA-tagged** image, pushes it to ECR, and deploys to the instance over **AWS Systems Manager** — the deploy runs as a remote command via SSM, so no inbound SSH port and no runner-IP allowlisting is needed. A post-deploy health check confirms the live service came up.

Two design decisions are load-bearing here. **OIDC** means the pipeline holds no standing cloud credentials — the alternative (an access key in GitHub secrets) is a long-lived credential that can leak. **SSM-based deploys** mean the deploy path needs no open SSH port for GitHub's runner IP ranges — the alternative (SSH from the runner) either pokes a hole for a large, rotating IP range or stores a key on the runner. Both choices remove standing attack surface rather than adding it. **SHA-based image tags** make every deployed container traceable to its exact commit and make deploys deterministic — the running image reference changes on every deploy, so there is no ambiguity about whether new code actually shipped.

---

## 9. Observability

The API is instrumented with **Prometheus** metrics via `prometheus-fastapi-instrumentator` (HTTP request rate, error rate, latency histograms) plus **custom domain counters** defined in the application: login success and failure, registrations, vault operations by type, and vault version-conflict events. These expose at an access-controlled `/metrics` endpoint — reachable over the private network for scraping, blocked from the public internet at nginx.

**Grafana** dashboards are **provisioned as code** — the datasource and dashboard JSON are committed and loaded on startup, so the monitoring setup is reproducible rather than click-configured. Two dashboards exist: an HTTP overview (status, request rate, error rate, latency percentiles) and a domain view (login success rate, registrations, failed logins, vault operations, version conflicts).

The monitoring stack does **not** run on the application instance. It lives on a **dedicated, on-demand EC2 instance** provisioned by its own standalone Terraform config, scraping the app's `/metrics` over the private VPC network via an identity-based security-group rule. This keeps monitoring decoupled from the workload — it is spun up when needed (load tests, demos, investigation) and torn down after, at near-zero cost, and it cannot compete with the application for resources on the same box.

---

## 10. The two deployment targets

The same application image serves both targets. The only thing that changes is where the database and secrets come from, and both are controlled entirely by environment variables.

| Concern   | Self-host (Docker Compose)            | Production (AWS)                                  |
|-----------|----------------------------------------|--------------------------------------------------|
| Database  | Containerized Postgres on the compose network | Managed RDS in a private subnet           |
| Secrets   | Operator-supplied env vars             | Secrets Manager via EC2 IAM role, injected at deploy |
| TLS       | Operator's responsibility              | Cloudflare edge + nginx origin cert              |
| Selected via | `DATABASE_URL` and local `.env`     | `DATABASE_URL` pointing at RDS, env from Secrets Manager |

There is no application code difference between them. Swapping the containerized Postgres for managed RDS is a change to one environment variable. This is what makes the "runs anywhere" claim real rather than aspirational, and it is the property that makes adding new deployment targets (other clouds, bare metal) a provisioning-layer change rather than an application rewrite.

---

## 11. Known architectural limitations

These are consequences of deliberate scope decisions, each expanded in the [threat model](../THREAT_MODEL.md):

- **Single-blob vault** — the price of the server being unable to see entry structure is that there is no server-side per-entry merge, search, or sharing.
- **In-memory rate limiting** — resets on restart, not shared across instances; a shared store (e.g. Redis) is the production fix.
- **Deploy-time secret injection** — simpler than runtime fetch, but secrets are present in the process environment.
- **Stateless JWT** — sessions cannot be revoked before expiry; mitigated by short token lifetime and in-memory-only client storage.
- **No MFA** — interacts non-trivially with the zero-knowledge login flow; scoped to future work.
- **Local Terraform state** — gitignored and containing sensitive values; an encrypted S3 backend with locking is the next step and the prerequisite for the pipeline managing infrastructure.