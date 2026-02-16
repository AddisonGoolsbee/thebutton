# Click — Implementation Plan

## Overview

Global click counter. One button. Everyone shares it. Number goes up.

## Frontend

React + TypeScript + Tailwind CSS v4, built with Vite.

**UI**: Minimal — giant number, giant button, subtle pulse animation on click. Show clicks/sec somewhere small.

**Client logic** (in `src/App.tsx`):
- Track clicks locally, cap at 100/sec (ignore excess)
- Every 1 second, if accumulated count > 0, POST batch to Worker
- Poll `GET /count` every 2 seconds to sync global total (edge-cached, cheap)
- Turnstile widget loads invisibly, token refreshed automatically
- Optimistic: your own clicks increment display instantly
- `localDeltaRef` tracks unsynced local clicks so we never jump backward when polling

**Animated counter** (`src/useAnimatedCount.ts`):
- When server poll returns a higher number, don't jump — spread the delta as random increments over the next 2 seconds
- For large deltas (>500), batch into ~200 scheduled increments to avoid timer spam
- `addImmediate()` for your own clicks (no animation delay)
- Result: the counter appears to tick up smoothly in real-time

## D1 Schema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counter (id, total) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS click_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count INTEGER NOT NULL CHECK (count > 0 AND count <= 200),
  ip_hash TEXT NOT NULL,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_ip_time
  ON click_batches (ip_hash, created_at DESC);
```

## Worker API (`worker/src/index.ts`)

### `GET /count`
- Check Cloudflare edge cache (2-second TTL)
- On miss: query D1, cache result, return
- All users hitting this in the same 2-sec window get the same cached response → D1 queried once every ~2 sec globally

### `POST /click`
Body: `{ "count": 47, "token": "<turnstile_token>" }`

1. Validate `count` is integer 1-200
2. Validate Turnstile token via siteverify API
3. SHA-256 hash the IP (from `CF-Connecting-IP` header)
4. Get country from `CF-IPCountry` header
5. Rate limit: max 10 batches per 5 seconds per `ip_hash` (queried from D1)
6. D1 batch: insert into `click_batches` + increment `counter` atomically
7. Invalidate edge cache for `/count`
8. Return `{ "ok": true, "total": <new_count> }`

### CORS
`Access-Control-Allow-Origin: *` (tighten to Pages domain in production).

## Cloudflare Setup

**Pages**: `wrangler pages deploy dist`. Build: `npm run build`, output: `dist`.

**Workers**: `cd worker && wrangler deploy`. Separate project in `worker/`.

**D1**: `wrangler d1 create click-db`. Bind to Worker in `worker/wrangler.toml`. Apply schema: `wrangler d1 execute click-db --file=../schema.sql`.

**Turnstile**:
- Create widget in dashboard (managed/invisible mode)
- Domains: `localhost`, `*.pages.dev`, custom domain if applicable
- Site key → `VITE_TURNSTILE_SITE_KEY` in frontend `.env`
- Secret key → `wrangler secret put TURNSTILE_SECRET_KEY` in worker

**WAF Rate Limiting** (free tier):
- Rule: max 30 requests/10 seconds per IP to the Worker URL

## Scaling Math

**Target**: ~1M unique users over 2 weeks

- ~70k users/day, average session ~1-2 min, ~30 batches/session
- Peak: ~2M requests/day → **Workers Paid ($5/mo)** required (10M req/month included)
- D1 writes: ~2M/day at peak × 2 writes/batch = ~4M row writes/day
  - Free tier: 100k writes/day (not enough)
  - Usage-based: $0.75/M writes → ~$3/day at peak
- D1 reads: `/count` cache misses + rate limit checks ≈ negligible
- **Total cost for 2-week viral run: ~$5-25**

## File Structure

```
click/
├── CLAUDE.md
├── PLAN.md
├── schema.sql              # D1 schema
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Button, counter, batching, polling, Turnstile
│   ├── useAnimatedCount.ts  # Smooth count animation hook
│   └── index.css            # Tailwind import
├── worker/
│   ├── src/
│   │   └── index.ts         # Worker: /count and /click endpoints
│   ├── wrangler.toml        # Worker config + D1 binding
│   └── package.json
└── dist/                    # Frontend build output (git-ignored)
```

## Implementation Order

1. ~~Scaffold React + Vite + Tailwind project~~ **DONE**
2. ~~Build basic UI (button + local counter)~~ **DONE**
3. ~~Create D1 schema~~ **DONE** (`schema.sql`)
4. ~~Build Worker with /count and /click endpoints~~ **DONE** (`worker/src/index.ts`)
5. ~~Wire frontend to Worker (batch sending + cached polling + animated count)~~ **DONE**
6. ~~Integrate Cloudflare Turnstile~~ **DONE** (frontend wired, needs site key)
7. Create Cloudflare resources (D1 database, Turnstile widget, Workers Paid)
8. Configure env vars and secrets, deploy Worker + Pages
9. Test end-to-end
10. Add WAF rate limiting rules
11. Polish UI (animations, mobile, etc.)
