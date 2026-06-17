# Self-Hosting

Glasshouse runs anywhere Docker runs: a VPS, a home server, bare metal, or a cloud VM. No AWS account or managed services required. This guide brings up the backend (API + PostgreSQL) and the frontend on your own infrastructure.

For how the maintained AWS instance is operated, see [deployment.md](deployment.md).

---

## What needs running

- **Backend:** the API container plus a PostgreSQL container, brought up together by `docker-compose.yml`. The database schema is created automatically on first startup — there is no separate migration step.
- **Frontend:** a static React/Vite app you build and serve, pointed at your backend's URL.

The application is identical to the production deployment. The only differences are that you supply your own Postgres (a container, rather than managed RDS) and your own secret values (set by hand, rather than pulled from a secrets manager).

---

## Prerequisites

- Docker and Docker Compose
- Node.js (to build the frontend)
- A way to serve the frontend over **HTTPS** in any real deployment (see the security note below)

---

## 1. Backend

Clone and configure:

```bash
git clone https://github.com/awsomesud347/PasswordManager.git
cd PasswordManager
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set:

| Variable          | What to set it to                                                        |
|-------------------|--------------------------------------------------------------------------|
| `DATABASE_URL`    | Connection string for the bundled Postgres (the compose default works as-is) |
| `PEPPER`          | A long random string. Generate one and keep it stable — changing it invalidates all existing verifiers |
| `JWT_SECRET`      | A long random string for signing session tokens                          |
| `ALLOWED_ORIGINS` | The origin your frontend is served from, e.g. `https://vault.example.com` |

Generate strong random values however you prefer, for example:

```bash
openssl rand -hex 32
```

Bring up the backend:

```bash
docker compose up -d
```

This starts the API and a PostgreSQL container on a shared network. The API listens on port 8000. The schema is created on startup. Confirm it's healthy:

```bash
curl http://localhost:8000/health
```

You should get `{"status":"healthy"}`.

---

## 2. Frontend

The frontend is a static app that must know where your API lives. Set `VITE_API_URL` to your **backend API's URL** (not the frontend's own address).

For local development:

```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

For a real deployment, build static files and serve them from any static host or web server:

```bash
cd frontend
VITE_API_URL=https://api.your-domain.com npm run build
# serve the contents of frontend/dist with your web server of choice
```

Make sure the origin you serve the frontend from is listed in the backend's `ALLOWED_ORIGINS`, or the browser will block API calls with a CORS error.

---

## Security notes

These are not optional for any deployment handling real logins.

**HTTPS is required.** The browser's WebCrypto API only runs in a secure context. `localhost` counts as secure for development, but any networked deployment must serve **both** the frontend and the API over HTTPS, or key derivation and encryption will not run. Terminate TLS with your own reverse proxy (nginx, Caddy, Traefik) or a tunnel/edge provider. The production instance uses nginx plus Cloudflare; you can use whatever you prefer.

**You own your secrets and your backups.** `PEPPER` and `JWT_SECRET` are yours to generate, store securely, and keep stable. There is no managed secrets store and no managed backup in a self-hosted setup — configure database backups yourself. Losing the database loses every vault; losing or changing the pepper invalidates every login.

**The master password is unrecoverable by design.** There is no reset path. This is a property of the zero-knowledge model, not a missing feature.

**A self-hosted or native deployment is the stronger trust model.** In any web-delivered zero-knowledge tool, you trust the server to serve honest frontend code. Self-hosting means you control that code and the server serving it, which is the strongest answer to the malicious-server concern in the [threat model](../THREAT_MODEL.md).

---

## Production hardening (optional, recommended)

If you run this as more than a local experiment:

- Put a reverse proxy in front of the API; do not expose the API container's port directly.
- Rate-limit at the proxy (the app's built-in limiter is in-memory and resets on restart).
- Block `/metrics` from public access at the proxy.
- Use a managed or properly backed-up PostgreSQL rather than an ephemeral container if the data matters.
- Set a restrictive `ALLOWED_ORIGINS` — only the exact origin your frontend is served from.