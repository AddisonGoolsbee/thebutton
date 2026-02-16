# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**click** — A global click counter website. One button, shared by everyone on the internet. Click it and the number goes up. Designed to handle ~1M users over a couple weeks.

## Tech Stack

All Cloudflare:
- **Pages** — React + TypeScript + Tailwind CSS v4 frontend (Vite build)
- **Workers** — API endpoint for click batches ($5/mo for 10M req/month)
- **D1** — SQLite database for counter + click log
- **Turnstile** — Invisible bot protection (free)

## Commands

```bash
# Frontend
npm run dev        # Local Vite dev server
npm run build      # Type-check + production build (output: dist/)
npm run preview    # Preview production build

# Worker (run from worker/ directory)
cd worker
npx wrangler dev                                          # Local Worker dev
npx wrangler deploy                                       # Deploy Worker
npx wrangler d1 execute thebutton --local --file=../schema.sql  # Apply schema locally
npx wrangler d1 execute thebutton --file=../schema.sql          # Apply schema to prod
npx wrangler secret put TURNSTILE_SECRET_KEY              # Set Turnstile secret

# Deploy frontend
npx wrangler pages deploy dist --project-name=click
```

## Architecture

### Request Flow

1. User clicks button → client accumulates clicks locally (capped at 100/sec)
2. Every ~1 second, client sends batch `{ count, token }` to Worker
3. Worker validates Turnstile token, checks IP rate limit via D1, inserts into `click_batches`
4. D1 batch atomically increments `counter` table
5. Worker returns new total immediately
6. Client also polls `GET /count` every 2 seconds (edge-cached) for other users' clicks
7. Animated counter smoothly interpolates between polled values (no visible jumps)

### Key Design Decisions

- **Client-side batching**: Turns millions of clicks/sec into thousands of requests/sec
- **Edge-cached polling**: `GET /count` cached with 2-sec TTL at Cloudflare edge. 10k users polling = 1 D1 query per 2 seconds, not 5k/sec
- **Animated count interpolation**: When poll shows +500, spread those increments randomly across next 2 seconds. Looks real-time. Your own clicks are instant via `addImmediate()`
- **`localDeltaRef` reconciliation**: Tracks your unsynced clicks so server polls never cause the counter to jump backward
- **Three-layer rate limiting**: Client cap (100 clicks/sec) → Cloudflare WAF (IP rate limit) → Worker (per-IP batch rate limit via D1 query)
- **Turnstile, not CAPTCHA**: Invisible to real users, blocks bots

## Environment Variables / Secrets

- `TURNSTILE_SECRET_KEY` — Worker secret (set via `wrangler secret put`)
- `VITE_WORKER_URL` — Worker API URL (in frontend `.env`)
- `VITE_TURNSTILE_SITE_KEY` — Turnstile site key (in frontend `.env`)

## D1 Schema

See `schema.sql`. Key tables:
- `counter` — single row with the global count
- `click_batches` — append-only log of batched clicks (ip_hash, country, timestamp)
