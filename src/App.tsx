import { useState, useCallback, useRef, useEffect } from "react";
import { useAnimatedCount } from "./useAnimatedCount";

const CLICK_CAP_PER_SECOND = 40;
const BATCH_INTERVAL_MS = 1000;
const POLL_INTERVAL_MS = 2000;

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function App() {
  const { displayCount, setTarget, addImmediate } = useAnimatedCount(POLL_INTERVAL_MS);
  const [clicksPerSecond, setClicksPerSecond] = useState(0);
  const [isPressed, setIsPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateLimitedUntilRef = useRef(0);
  const pendingRef = useRef(0);
  const clickTimestampsRef = useRef<number[]>([]);
  const turnstileTokenRef = useRef<string>("");
  const localDeltaRef = useRef(0);

  // Load Turnstile script and get token
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    const containerId = "turnstile-container";

    const renderWidget = () => {
      const container = document.getElementById(containerId);
      // Don't render if container already has a widget
      if (!container || container.childElementCount > 0) return;
      (window as any).turnstile.render(`#${containerId}`, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => {
          turnstileTokenRef.current = token;
        },
        "refresh-expired": "auto",
        size: "flexible",
      });
    };

    // If Turnstile script is already loaded, just render
    if ((window as any).turnstile) {
      renderWidget();
      return;
    }

    // Avoid loading the script twice
    if (!document.querySelector('script[src*="turnstile"]')) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      script.async = true;
      document.head.appendChild(script);
    }

    (window as any).onTurnstileLoad = renderWidget;
  }, []);

  // Track clicks/sec for display
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => now - t < 1000);
      setClicksPerSecond(clickTimestampsRef.current.length);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Poll server for global count
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const resp = await fetch(`${WORKER_URL}/count`, { cache: "no-store" });
        if (resp.ok) {
          const data = (await resp.json()) as { total: number };
          setTarget(data.total + localDeltaRef.current);
        }
      } catch {
        // Silently ignore poll failures
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [setTarget]);

  // Batch sender
  useEffect(() => {
    const interval = setInterval(async () => {
      if (pendingRef.current <= 0) return;
      if (Date.now() < rateLimitedUntilRef.current) return;

      const batch = Math.min(pendingRef.current, 200);
      pendingRef.current -= batch;

      try {
        const resp = await fetch(`${WORKER_URL}/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            count: batch,
            token: turnstileTokenRef.current,
          }),
        });

        if (resp.ok) {
          const data = (await resp.json()) as { ok: boolean; total: number };
          localDeltaRef.current = Math.max(0, localDeltaRef.current - batch);
          setTarget(data.total + localDeltaRef.current);
          setError(null);
        } else if (resp.status === 429) {
          pendingRef.current += batch;
          rateLimitedUntilRef.current = Date.now() + 5000;
          setError("slow down!");
          if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
          errorTimerRef.current = setTimeout(() => setError(null), 3000);
        } else {
          // 400/403 — don't retry, clicks are lost (bad token, invalid request)
          localDeltaRef.current = Math.max(0, localDeltaRef.current - batch);
        }
      } catch {
        pendingRef.current += batch;
        setError("connection lost");
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setError(null), 3000);
      }
    }, BATCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [setTarget]);

  // Flush pending clicks on page close/navigation
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current <= 0) return;
      const batch = Math.min(pendingRef.current, 200);
      pendingRef.current -= batch;
      fetch(`${WORKER_URL}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: batch, token: turnstileTokenRef.current }),
        keepalive: true,
      }).catch(() => {});
    };
    const onVisChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  const handleClick = useCallback(() => {
    const now = Date.now();
    const recentClicks = clickTimestampsRef.current.filter((t) => now - t < 1000);
    if (recentClicks.length >= CLICK_CAP_PER_SECOND) return;

    clickTimestampsRef.current.push(now);
    pendingRef.current += 1;
    localDeltaRef.current += 1;
    addImmediate(1);

    // Brief press flash
    setIsPressed(true);
    setTimeout(() => setIsPressed(false), 100);
  }, [addImmediate]);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-void select-none">
      {/* Radial background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--color-ember-deep)_0%,_transparent_70%)]" />

      {/* Subtle noise texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-12">
        {/* Counter */}
        <div
          className={`font-mono text-[clamp(3rem,15vw,10rem)] leading-none font-black tracking-tighter${displayCount !== null ? " counter-reveal" : ""}`}
          style={{ color: "var(--color-warm-white)" }}
        >
          {displayCount !== null ? formatNumber(displayCount) : "\u00A0"}
        </div>

        {/* Button assembly */}
        <div className="relative">
          {/* Breathing glow ring */}
          <div className="glow-ring absolute -inset-6 rounded-full bg-ember/20 blur-2xl" />

          {/* The dome button */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClick}
            className={`btn-dome relative h-44 w-44 cursor-pointer rounded-full border-0 outline-none${isPressed ? " pressed" : ""}`}
            aria-label="Click the button"
            tabIndex={-1}
          >
            {/* Specular highlight */}
            <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,_rgba(255,255,255,0.25)_0%,_transparent_50%)]" />
          </button>
        </div>

        {/* Stats */}
        <div className="h-5 font-mono text-xs tracking-widest uppercase">
          {error ? (
            <span className="text-ember animate-pulse">{error}</span>
          ) : clicksPerSecond > 0 ? (
            <span className="text-warm-muted">
              {clicksPerSecond} click{clicksPerSecond !== 1 && "s"}/sec
            </span>
          ) : null}
        </div>
      </div>

      {/* Hidden Turnstile container */}
      <div id="turnstile-container" className="hidden" />
    </div>
  );
}
