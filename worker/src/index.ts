interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_TTL_SECONDS = 2;

// Cloudflare's test secret key — always passes validation.
// Used when running locally via `wrangler dev`.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

async function hashIP(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
): Promise<boolean> {
  const resp = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    },
  );
  const data = (await resp.json()) as { success: boolean };
  return data.success;
}

async function handleCount(env: Env, request: Request): Promise<Response> {
  // Try edge cache (only works in production, not wrangler dev)
  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL("/count", request.url).toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    // Cache API not available in local dev — skip
  }

  const result = await env.DB.prepare(
    "SELECT total FROM counter WHERE id = 1",
  ).first<{ total: number }>();

  const response = new Response(JSON.stringify({ total: result?.total ?? 0 }), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });

  // Store in edge cache (production only)
  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL("/count", request.url).toString());
    await cache.put(cacheKey, response.clone());
  } catch {
    // Cache API not available in local dev — skip
  }

  return response;
}

async function handleClick(
  env: Env,
  request: Request,
): Promise<Response> {
  const body = (await request.json()) as { count?: number; token?: string };

  // Validate count
  const count = body.count;
  if (typeof count !== "number" || count < 1 || count > 200 || !Number.isInteger(count)) {
    return new Response(JSON.stringify({ error: "count must be integer 1-200" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  // Validate turnstile token (skip in local dev)
  const token = body.token;
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "unknown";
  if (!isLocal) {
    if (typeof token !== "string" || !token) {
      return new Response(JSON.stringify({ error: "missing turnstile token" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const turnstileOk = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip);
    if (!turnstileOk) {
      return new Response(JSON.stringify({ error: "bot detected" }), {
        status: 403,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  const ipHash = await hashIP(ip);
  const country = request.headers.get("CF-IPCountry") ?? "unknown";

  // Rate limit: max 10 batches per 5 seconds per IP
  const rateCheck = await env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM click_batches WHERE ip_hash = ? AND created_at > datetime('now', '-5 seconds')",
  ).bind(ipHash).first<{ cnt: number }>();

  if (rateCheck && rateCheck.cnt >= 10) {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Insert batch + increment counter atomically
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO click_batches (count, ip_hash, country) VALUES (?, ?, ?)",
    ).bind(count, ipHash, country),
    env.DB.prepare(
      "UPDATE counter SET total = total + ? WHERE id = 1",
    ).bind(count),
    env.DB.prepare("SELECT total FROM counter WHERE id = 1"),
  ]);

  const newTotal = (results[2].results[0] as { total: number }).total;

  // Invalidate edge cache (production only)
  try {
    const cache = caches.default;
    const cacheKey = new Request(new URL("/count", request.url).toString());
    await cache.delete(cacheKey);
  } catch {
    // Cache API not available in local dev
  }

  return new Response(JSON.stringify({ ok: true, total: newTotal }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/count" && request.method === "GET") {
      return handleCount(env, request);
    }

    if (url.pathname === "/click" && request.method === "POST") {
      return handleClick(env, request);
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
