-- The global counter (single row)
CREATE TABLE IF NOT EXISTS counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counter (id, total) VALUES (1, 0);

-- Append-only click batch log
CREATE TABLE IF NOT EXISTS click_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count INTEGER NOT NULL CHECK (count > 0 AND count <= 200),
  ip_hash TEXT NOT NULL,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for rate limiting lookups
CREATE INDEX IF NOT EXISTS idx_batches_ip_time
  ON click_batches (ip_hash, created_at DESC);

-- Turnstile verification cache (so tokens don't need to be single-use per batch)
CREATE TABLE IF NOT EXISTS turnstile_verified (
  ip_hash TEXT PRIMARY KEY,
  verified_at TEXT NOT NULL
);
