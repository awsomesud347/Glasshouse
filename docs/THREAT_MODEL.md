# Threat Model

What Glasshouse protects against, what it does not, and why.

This is a portfolio project demonstrating secure cloud operations. It has not been independently audited. It is built for low-stakes, throwaway credentials — not for secrets you cannot afford to lose or have exposed.

---

## 1. What the server can and cannot see

The server stores, per user: email, KDF salt, KDF parameters, a verifier, an encrypted vault blob, an IV, and a version number.

The server never receives the master password, the encryption key, or any plaintext credential. The encryption key is derived in-browser, imported as a non-extractable key, and never exported.

An attacker with full read access to the database obtains ciphertext and verifiers. They decrypt nothing. The encryption key requires the master password, which the server never holds. This property holds under total compromise of data at rest.

---

## 2. Cryptographic design

### Key derivation
Argon2id (64 MB, 3 iterations, parallelism 1) runs in-browser on the master password and a per-user random salt. Its output is the input keying material for HKDF.

### Fixed HKDF salt
The HKDF step uses a fixed zero salt. RFC 5869 §3.1 permits this when the input keying material is already a high-entropy, uniformly random key. The IKM here is the Argon2id output, and per-user uniqueness comes from the per-user Argon2 salt. A random HKDF salt would add nothing and require storage and transmission.

### Domain separation
The encryption key and auth key derive from one root key using distinct HKDF `info` parameters (`"enc"`, `"auth"`). They are cryptographically independent. Possessing one yields nothing about the other. Sending the auth key to the server does not endanger the encryption key.

### Server-side verifier
The auth key is never stored. It is peppered and hashed with Argon2id (`argon2-cffi`, 64 MB, 3 iterations) into a verifier. The verifier does not reverse to the auth key. A recovered auth key decrypts nothing.

### Auth-key transmission vs. PAKE
An augmented PAKE (SRP, OPAQUE) never transmits any password-derived secret. Glasshouse transmits the auth key over TLS, peppers it, and Argon2-hashes it at rest. This is a weaker construction than a PAKE and a deliberate scope decision. The auth key is protected in transit by TLS, protected at rest by pepper + Argon2, and useless for decryption regardless.

---

## 3. Network and infrastructure

### Defended
- **Direct attack on the API host.** The origin IP is hidden behind Cloudflare. The EC2 security group admits 443 only from Cloudflare's IP ranges. The API container is never published to the host — only nginx is — so the API is reachable only through the proxy.
- **Database exposure.** RDS has no public address, sits in a private subnet, and admits 5432 only from the API's security group (identity-based). Connections require SSL.
- **Volumetric DDoS.** Absorbed at the Cloudflare edge.
- **Over-broad credentials.** The EC2 IAM role reads `GetSecretValue` on exactly three secret ARNs. Instance compromise yields three secrets, not the account.
- **Metrics info-leak.** `/metrics` is blocked at nginx externally and reachable only over the internal Docker network.

### Gaps
- **In-memory rate limiting.** The login limiter (10/min) is in-process. It resets on restart and is not shared across instances, so it weakens under a forced restart or horizontal scaling. The fix is a shared store (Redis-backed limiter).
- **Salt-endpoint enumeration.** `GET /auth/salt` returns a salt for any email to avoid confirming registration. It currently returns a *random* salt for unknown emails, so querying the same unknown email twice yields different salts while a registered email yields a stable one — distinguishing the two. The fix is a deterministic fake salt derived from the email via an HMAC keyed by a server secret. Registration also returns `409` on duplicate email — a separate enumeration surface accepted for usability.
- **Stateless JWT.** HS256 tokens carry a 1-hour expiry and a unique `jti`. They cannot be revoked before expiry. The token lives in browser memory only — never `localStorage` or `sessionStorage` — so it does not survive a tab close. The `jti` supports a future deny-list without a token-format change.

---

## 4. Client-side

- **XSS.** The encryption key and token live in JavaScript memory, so XSS against the frontend can read them while the page is open. This is inherent to browser-based zero-knowledge crypto — the keys must exist in memory to function. Keys are never persisted, limiting the window to an active session.
- **Malicious server / supply chain.** Zero-knowledge assumes honest client code. A server serving malicious frontend JavaScript could capture the master password before encryption. This is the trust assumption of every web-delivered zero-knowledge tool. A self-hosted or native client is stronger against it — a motivation for the self-hosting path.
- **Lost master password.** Unrecoverable. No escrow, no reset.

---

## 5. Operational

- **Backups.** Automated RDS backups with point-in-time recovery are enabled. Retention is free-tier constrained; production extends it via one Terraform variable.
- **Pepper blast radius.** The pepper lives in Secrets Manager, separate from the database. Offline attacks on verifiers require both the database and the pepper. A recovered auth key still decrypts nothing. One store alone is insufficient.
- **Deploy-time secret injection.** Secrets are injected as environment variables at deploy time, making them visible in the process environment. Runtime fetch with caching is the stronger alternative.
- **Terraform state.** Currently local, gitignored, contains sensitive values. An encrypted S3 backend with locking is required before CI/CD.

---

## 6. Out of scope

Not attempted, not claimed:

- Multi-factor authentication.
- Sharing, organizations, multi-user vaults.
- Per-entry server-side structure, search, or merge.
- A third-party security audit.
- High-value or irreplaceable secrets.

---

## 7. Self Evaluator summary

**Strong:** the zero-knowledge property holds under full data-at-rest compromise. Primitives are used correctly — Argon2id, HKDF domain separation, AES-256-GCM with per-message IVs, non-extractable keys. Infrastructure is defense-in-depth with least-privilege IAM and IaC.

**Weaker than a mature product:** no PAKE, no MFA, single-blob multi-device handling, in-memory rate limiting, a residual enumeration vector, no audit.

Every item in the second list is a stated decision with a known fix where one applies.