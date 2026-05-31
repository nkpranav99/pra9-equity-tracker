import { fileURLToPath } from 'url';
import path from 'path';

/**
 * All schema migration SQL statements.
 * Each table uses IF NOT EXISTS so migrations are safe to re-run.
 * @type {string[]}
 */
const MIGRATIONS = [
  // ── auth_tokens ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    id            INTEGER PRIMARY KEY,
    access_token  TEXT    NOT NULL,
    refresh_token TEXT,
    created_at    TEXT    DEFAULT (datetime('now')),
    expires_at    TEXT,
    is_valid      INTEGER DEFAULT 1
  )`,

  // ── screener_configs ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS screener_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,
    scan_clause TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now'))
  )`,

  // ── scan_results ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS scan_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    screener_id    INTEGER REFERENCES screener_configs(id),
    symbol         TEXT    NOT NULL,
    name           TEXT,
    price          REAL,
    volume         REAL,
    change_percent REAL,
    raw_data       TEXT,
    scanned_at     TEXT    DEFAULT (datetime('now'))
  )`,

  // ── watchlist ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS watchlist (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol   TEXT    NOT NULL UNIQUE,
    name     TEXT,
    added_at TEXT    DEFAULT (datetime('now')),
    notes    TEXT
  )`,

  // ── alert_log ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS alert_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    message    TEXT,
    sent_at    TEXT DEFAULT (datetime('now'))
  )`,

  // Index on alert_log for fast duplicate-check queries
  `CREATE INDEX IF NOT EXISTS idx_alert_log_symbol_type_sent
    ON alert_log (symbol, alert_type, sent_at)`,

  // ── indicator_cache ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS indicator_cache (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT NOT NULL,
    timeframe  TEXT NOT NULL,
    data       TEXT NOT NULL,
    indicators TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(symbol, timeframe)
  )`,
];

/**
 * Run all schema migrations against the given database instance.
 * Uses a transaction so either all migrations succeed or none do.
 * @param {import('better-sqlite3').Database} db - The better-sqlite3 database instance.
 */
export function runMigrations(db) {
  const migrate = db.transaction(() => {
    for (const sql of MIGRATIONS) {
      db.exec(sql);
    }
  });

  migrate();
}

// ── Standalone execution ───────────────────────────────────────
// Run migrations directly:  node src/db/migrations.js
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  // Dynamic import to avoid circular-dependency issues at module level
  const { initializeDb, closeDb } = await import('./database.js');
  const logger = (await import('../utils/logger.js')).default;

  try {
    logger.info('Running database migrations (standalone)…');
    initializeDb();
    logger.info('Migrations completed successfully ✓');
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
