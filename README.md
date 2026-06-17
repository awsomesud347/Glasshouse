# Glasshouse

Glasshouse is a zero-knowledge password manager with a production grade, infrastructure-as-code based deployment — built with a personal motivaton to tackle and solve DevSecOps workflows and Secure Coding/SWE challenges. One cloud-agnostic codebase runs identically via `docker compose up` or on the hardened, Terraform-provisioned AWS stack that powers the live instance, with least-privilege IAM and managed secrets.

This is a portfolio showcase of how to design, code, deploy, and operate a security-critical service — **not an audited product yet.** The live instance is the fastest way to get a feel for the deliberately minimal UI, and it works as a vault for throwaway or alt-account credentials.

**Live demo:** https://passmanager.sudarshankaushik.com
**API:** https://vault-api.sudarshankaushik.com

## Why it's built this way

The product itself is intentionally modest. The point of the project is the **operational envelope around it**: a zero-knowledge password manager is an unforgiving thing to deploy and operate safely, which makes it a good workload for demonstrating secure cloud operations. The interesting parts are the infrastructure-as-code, the least-privilege IAM, the secrets management, the defense-in-depth network design, and the clean separation that lets one codebase be both self-hosted and cloud-deployed.

## How the zero-knowledge model works

The server never sees your master password or any plaintext credential.

1. Your master password is run through **Argon2id** (64 MB memory, 3 iterations) in the browser, using a per-user salt.
2. The derived key material is split via **HKDF** into two keys:
   - an **encryption key** that never leaves the browser (non-extractable), used to encrypt your vault with **AES-256-GCM**, and
   - an **auth key** sent to the server only to prove identity.
3. The server never stores the auth key — it stores a **verifier** produced by peppering and hashing the auth key with Argon2 (`argon2-cffi`).
4. Your vault is stored as a single **encrypted blob** plus an IV and a version number. To the server it is opaque bytes.

A consequence stated plainly: if you forget your master password, your vault is unrecoverable by design. There is no reset, because the server has nothing to reset to.

## Architecture

```
Browser (all crypto processed and stored here only in memory.)
   │  HTTPS
   ▼
Cloudflare  ── DDoS protection, TLS, origin hidden
   │  HTTPS (origin cert; EC2 security group locked to Cloudflare IP ranges)
   ▼
nginx (reverse proxy)  ── TLS termination, rate limiting, /metrics blocked externally
   │  Docker network
   ▼
FastAPI (API container)  ── reads secrets from env; never published to the host directly
   │  SSL
   ▼
PostgreSQL
   ├─ self-host: containerized Postgres (docker compose)
   └─ production: AWS RDS in a private subnet, reachable only from the API security group
```

Secrets (pepper, JWT secret, database URL) live in **AWS Secrets Manager** and are fetched via an **EC2 IAM role** scoped to exactly those secret ARNs, then injected as environment variables at deploy time. The application itself is cloud-agnostic and makes no cloud API calls — for a self-hoster, those same values are just environment variables they set.

See [`docs/architecture.md`](docs/architecture.md) for the full design and decision rationale, and [`THREAT_MODEL.md`](THREAT_MODEL.md) for what this does and does not protect against.

## Tech stack

**Application:** Python, FastAPI (async), Pydantic, SQLAlchemy (async), asyncpg, React + Vite, WebCrypto, Argon2id (hash-wasm client-side, argon2-cffi server-side), AES-256-GCM.

**Infrastructure:** Docker, AWS (EC2, RDS, ECR, Secrets Manager, IAM, VPC), Terraform, nginx, Cloudflare, Vercel.

## Quickstart (self-hosting)

The application runs anywhere with Docker. No AWS account or cloud services required — this brings up the API and a PostgreSQL container together.

```bash
git clone https://github.com/awsomesud347/PasswordManager.git
cd PasswordManager
cp backend/.env.example backend/.env   # then edit the values (see below)
docker compose up
```

The API will be available on `http://localhost:8000`. Run the frontend separately (see [`docs/self-hosting.md`](docs/self-hosting.md)).

You must supply these environment variables in `backend/.env`:

| Variable        | Purpose                                              |
|-----------------|------------------------------------------------------|
| `DATABASE_URL`  | PostgreSQL connection string                         |
| `PEPPER`        | Server-side pepper for hashing the auth-key verifier |
| `JWT_SECRET`    | Secret for signing session JWTs                      |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins   |

How those variables get populated is deployment-specific: a self-hoster sets them by hand (or via their orchestrator's secret mechanism); the maintained production instance injects them from AWS Secrets Manager. The application is identical in both cases.

> **Note on HTTPS:** the browser's WebCrypto API requires a secure context. `localhost` is treated as secure for development, but any real self-hosted deployment must serve the frontend over HTTPS. See the self-hosting guide.

## Deployment targets

This one codebase has two documented deployment targets:

- **Run anywhere (Docker Compose):** API plus a containerized Postgres, no cloud dependency. Covered in [`docs/self-hosting.md`](docs/self-hosting.md).
- **AWS reference deployment:** the maintained live instance — Terraform-provisioned, managed RDS, Secrets Manager, Cloudflare. Covered in [`docs/deployment.md`](docs/deployment.md).

The only difference between them is where the database and secrets come from — controlled entirely by environment variables. The production instance swaps the Postgres container for managed RDS by changing `DATABASE_URL`; the application code does not change.

## API

| Method | Path                      | Purpose                                          |
|--------|---------------------------|--------------------------------------------------|
| POST   | `/auth/register/init`     | Begin registration; returns salt and KDF params  |
| POST   | `/auth/register/complete` | Complete registration; stores verifier and vault |
| GET    | `/auth/salt`              | Fetch salt + KDF params for login                |
| POST   | `/auth/login`             | Authenticate; returns JWT and encrypted vault    |
| GET    | `/vault/`                 | Fetch the encrypted vault blob                    |
| PUT    | `/vault/`                 | Update the vault (optimistic-locked by version)  |
| GET    | `/vault/export`           | Export encrypted vault for portability           |
| DELETE | `/vault/account`          | Delete the account and all stored data           |
| GET    | `/health`                 | Health check                                      |

Vault writes use **optimistic concurrency control**: the client sends the version it edited, and the server rejects the write with `409 Conflict` if its version has moved on. The system is conflict-*detecting*, not conflict-*merging* — see the threat model for the multi-device implications.

---

## What this is (and isn't)

**Today:**
- A cloud-agnostic application — the backend is a container reading all configuration from environment variables, so it runs anywhere a container can: any VPS, bare-metal box, homelab, or cloud VM.
- A secure AWS + Vercel reference deployment, reproducible from code: Cloudflare → nginx → containerized API → private-subnet RDS, provisioned entirely through Terraform with least-privilege IAM and AWS Secrets Manager.
- Genuine zero-knowledge cryptography: all key derivation and encryption happen client-side in the browser. The server only ever stores an opaque encrypted blob.

**Planned / in progress:**
- A CI/CD pipeline (GitHub Actions) with security gates — dependency scanning, container image scanning, IaC scanning — before any deploy.
- Observability: Prometheus metrics and a public, read-only Grafana dashboard exposing latency and uptime for the live instance.
- First-class Terraform provisioning for additional cloud providers, and a documented, smooth self-hosting path for bare-metal and homelab setups.

The cloud-agnostic core — secrets and storage behind clean seams, no cloud SDK calls in the application logic — is what makes adding those deployment targets a provisioning-layer change rather than an application rewrite.

## Known limitations

These are deliberate scope decisions, documented rather than hidden. Each is covered in detail in [`THREAT_MODEL.md`](THREAT_MODEL.md).

- **No MFA yet.** MFA interacts non-trivially with the zero-knowledge login flow; it is scoped to future work rather than half-implemented.
- **No third-party security audit.**
- **Single-blob vault, conflict-detecting not merging.** Concurrent edits from two devices are detected (409) but not merged.
- **In-memory rate limiting.** Resets on container restart and is not shared across instances. A production fix is a shared (e.g. Redis-backed) limiter.
- **Deploy-time secret injection.** Secrets are injected as environment variables at deploy time rather than fetched at runtime. Runtime fetch with caching is noted as an enhancement.
- **Free-tier backup retention.** Automated RDS backups are enabled but retention is constrained by the account's free-tier plan; production would extend this.

## License

MIT — see [`LICENSE`](LICENSE).