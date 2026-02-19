interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
}

const ALLOWED_ORIGINS = [
  "https://theglobalcounter.com",
  "https://www.theglobalcounter.com",
  "http://localhost:5173",
  "http://localhost:4173",
];

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const CACHE_TTL_SECONDS = 2;

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
  try {
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
  } catch {
    return false;
  }
}

async function handleCount(env: Env, request: Request): Promise<Response> {
  const origin = request.headers.get("Origin") ?? "none";
  const cacheUrl = new URL(`/count?origin=${encodeURIComponent(origin)}`, request.url).toString();

  // Try edge cache (only works in production, not wrangler dev)
  try {
    const cache = caches.default;
    const cached = await cache.match(new Request(cacheUrl));
    if (cached) return cached;
  } catch {
    // Cache API not available in local dev — skip
  }

  const result = await env.DB.prepare(
    "SELECT total FROM counter WHERE id = 1",
  ).first<{ total: number }>();

  const response = new Response(JSON.stringify({ total: result?.total ?? 0 }), {
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=0`,
    },
  });

  // Store in edge cache (production only)
  try {
    const cache = caches.default;
    await cache.put(new Request(cacheUrl), response.clone());
  } catch {
    // Cache API not available in local dev — skip
  }

  return response;
}

async function handleClick(
  env: Env,
  request: Request,
): Promise<Response> {
  let body: { count?: number; token?: string };
  try {
    body = (await request.json()) as { count?: number; token?: string };
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders(request), "Content-Type": "application/json" },
    });
  }

  // Validate count
  const count = body.count;
  if (typeof count !== "number" || count < 1 || count > 200 || !Number.isInteger(count)) {
    return new Response(JSON.stringify({ error: "count must be integer 1-200" }), {
      status: 400,
      headers: { ...corsHeaders(request), "Content-Type": "application/json" },
    });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hashIP(ip);

  // Validate turnstile token (skip in local dev)
  const token = body.token;
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "unknown";
  if (!isLocal) {
    // Check if this IP was verified recently (within 60 seconds)
    const recentVerify = await env.DB.prepare(
      "SELECT 1 FROM turnstile_verified WHERE ip_hash = ? AND verified_at > datetime('now', '-60 seconds')",
    ).bind(ipHash).first();

    if (!recentVerify) {
      // Need a fresh Turnstile token
      if (typeof token !== "string" || !token) {
        return new Response(JSON.stringify({ error: "missing turnstile token" }), {
          status: 400,
          headers: { ...corsHeaders(request), "Content-Type": "application/json" },
        });
      }
      const turnstileOk = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip);
      if (!turnstileOk) {
        return new Response(JSON.stringify({ error: "bot detected" }), {
          status: 403,
          headers: { ...corsHeaders(request), "Content-Type": "application/json" },
        });
      }
      // Mark IP as verified
      await env.DB.prepare(
        "INSERT OR REPLACE INTO turnstile_verified (ip_hash, verified_at) VALUES (?, datetime('now'))",
      ).bind(ipHash).run();
    }
  }
  const country = request.headers.get("CF-IPCountry") ?? "unknown";

  // Rate limit + insert atomically via conditional INSERT
  // Only inserts if IP is under 200 clicks in the last 5 seconds
  const insertResult = await env.DB.prepare(
    `INSERT INTO click_batches (count, ip_hash, country)
     SELECT ?, ?, ?
     WHERE (SELECT COALESCE(SUM(count), 0) FROM click_batches WHERE ip_hash = ? AND created_at > datetime('now', '-5 seconds')) + ? <= 200`,
  ).bind(count, ipHash, country, ipHash, count).run();

  if (!insertResult.meta.changes) {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { ...corsHeaders(request), "Content-Type": "application/json" },
    });
  }

  // Increment counter and read new total
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE counter SET total = total + ? WHERE id = 1",
    ).bind(count),
    env.DB.prepare("SELECT total FROM counter WHERE id = 1"),
  ]);

  const newTotal = (results[1].results[0] as { total: number }).total;

  // Invalidate edge cache for all origins (production only)
  try {
    const cache = caches.default;
    for (const o of [...ALLOWED_ORIGINS, "none"]) {
      const cacheUrl = new URL(`/count?origin=${encodeURIComponent(o)}`, request.url).toString();
      await cache.delete(new Request(cacheUrl));
    }
  } catch {
    // Cache API not available in local dev
  }

  return new Response(JSON.stringify({ ok: true, total: newTotal }), {
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === "/count" && request.method === "GET") {
      return handleCount(env, request);
    }

    if (url.pathname === "/click" && request.method === "POST") {
      return handleClick(env, request);
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(request) });
  },
};
