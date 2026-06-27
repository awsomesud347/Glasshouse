import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Glasshouse load test — three tiers, each characterizing a different
// endpoint class. Run against the live instance behind Cloudflare/nginx.
//
//   API_BASE   : API base URL (default: the live API)
//   VAULT_JWT  : a valid bearer token (grabbed from a browser login) for the
//                authenticated-read tier. Without it, that tier is skipped.
//
// Example:
//   k6 run -e VAULT_JWT="eyJ..." glasshouse-loadtest.js
// ---------------------------------------------------------------------------

const API_BASE = __ENV.API_BASE || 'https://vault-api.sudarshankaushik.com';
const VAULT_JWT = __ENV.VAULT_JWT || '';

// Custom metrics for clearer reporting
const healthLatency = new Trend('health_latency', true);
const vaultLatency = new Trend('vault_latency', true);
const rateLimited = new Counter('rate_limited_429');
const authRejected = new Counter('auth_rejected_401');

export const options = {
  scenarios: {
    // TIER 1 — throughput. /health does minimal work: measures raw
    // request-handling ceiling through Cloudflare -> nginx -> FastAPI.
    // Gradual ramp so status can be monitored on grafana and aborted if needed
    health_throughput: {
      executor: 'ramping-vus',
      exec: 'healthTier',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },

    // TIER 2 — authenticated read. Reuses one JWT to fetch the vault.
    // Characterizes realistic logged-in read capacity (DB read on each call).
    // Starts after tier 1 to keep the metrics separable.
    vault_reads: {
      executor: 'ramping-vus',
      exec: 'vaultTier',
      startTime: '3m30s',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 30 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },

    // TIER 3 — auth limiter characterization. Deliberately low rate.
    // Sends invalid login attempts to (a) exercise Argon2 cost and
    // (b) demonstrate the nginx 10/min limiter returning 429s.
    // 429s and 401s here are EXPECTED and recorded as such, not failures.
    auth_limiter: {
      executor: 'constant-arrival-rate',
      exec: 'authTier',
      startTime: '6m',
      rate: 30,           // 30 attempts per minute — above the 10/min limit
      timeUnit: '1m',
      duration: '2m',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },

  // Thresholds define pass/fail for the run. Note we do NOT fail on the
  // auth tier's 401/429 — those are expected. We fail only on real problems:
  // server errors and excessive health-endpoint latency.
  thresholds: {
    'health_latency': ['p(95)<1000'],          // health p95 under 1s
    'http_req_failed{tier:health}': ['rate<0.01'], // <1% true failures on health
  },
};

// ---- Tier 1: health throughput ----
export function healthTier() {
  const res = http.get(`${API_BASE}/health`, { tags: { tier: 'health' } });
  healthLatency.add(res.timings.duration);
  check(res, { 'health 200': (r) => r.status === 200 });
  sleep(0.1);
}

// ---- Tier 2: authenticated vault reads ----
export function vaultTier() {
  if (!VAULT_JWT) return; // skip if no token supplied
  const res = http.get(`${API_BASE}/vault/`, {
    headers: { Authorization: `Bearer ${VAULT_JWT}` },
    tags: { tier: 'vault' },
  });
  vaultLatency.add(res.timings.duration);
  check(res, { 'vault 200': (r) => r.status === 200 });
  sleep(0.2);
}

// ---- Tier 3: auth limiter characterization ----
export function authTier() {
  // Invalid credentials on purpose — we are testing the limiter and Argon2
  // cost, not a real login. The KDF-derived auth_key is faked.
  const payload = JSON.stringify({
    email: 'loadtest@example.com',
    auth_key: 'invalid-load-test-auth-key-not-a-real-derivation',
  });
  const res = http.post(`${API_BASE}/auth/login`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { tier: 'auth' },
  });
  if (res.status === 429) rateLimited.add(1);
  if (res.status === 401) authRejected.add(1);
  // Expected outcomes only: 401 (bad creds) or 429 (rate limited).
  check(res, {
    'auth expected (401/429)': (r) => r.status === 401 || r.status === 429,
  });
}