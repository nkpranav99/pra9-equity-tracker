import { getDb } from './database.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════
//  Auth Tokens
// ═══════════════════════════════════════════════════════════════

/**
 * Insert or replace the auth token.
 * Invalidates all previous tokens before inserting the new one.
 * @param {string} token   - Kite access token.
 * @param {string} [expiresAt] - ISO-8601 expiry timestamp (optional).
 */
export function saveAuthToken(token, expiresAt = null) {
  const db = getDb();
  const upsert = db.transaction(() => {
    db.prepare('UPDATE auth_tokens SET is_valid = 0 WHERE is_valid = 1').run();
    db.prepare(
      `INSERT INTO auth_tokens (access_token, expires_at, is_valid)
       VALUES (?, ?, 1)`
    ).run(token, expiresAt);
  });
  upsert();
  logger.debug('Auth token saved');
}

/**
 * Retrieve the latest valid (non-expired) auth token.
 * @returns {{ access_token: string, created_at: string, expires_at: string | null } | undefined}
 */
export function getValidAuthToken() {
  const db = getDb();
  return db
    .prepare(
      `SELECT access_token, created_at, expires_at
       FROM auth_tokens
       WHERE is_valid = 1
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get();
}

/**
 * Mark every token as invalid (e.g. on logout or forced refresh).
 */
export function invalidateTokens() {
  const db = getDb();
  const info = db.prepare('UPDATE auth_tokens SET is_valid = 0 WHERE is_valid = 1').run();
  logger.info({ count: info.changes }, 'Auth tokens invalidated');
}

// ═══════════════════════════════════════════════════════════════
//  Screener Configs
// ═══════════════════════════════════════════════════════════════

/**
 * Add a new screener configuration.
 * @param {string} name       - Human-readable screener name.
 * @param {string} slug       - Chartink screener slug (unique).
 * @param {string} [scanClause] - Optional scan clause / filter text.
 * @returns {{ id: number }} The inserted row id.
 */
export function addScreenerConfig(name, slug, scanClause = null) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO screener_configs (name, slug, scan_clause)
       VALUES (?, ?, ?)`
    )
    .run(name, slug, scanClause);
  logger.debug({ id: info.lastInsertRowid, slug }, 'Screener config added');
  return { id: info.lastInsertRowid };
}

/**
 * Get all active screener configurations.
 * @returns {Array<{ id: number, name: string, slug: string, scan_clause: string | null, created_at: string }>}
 */
export function getActiveScreeners() {
  const db = getDb();
  return db
    .prepare('SELECT * FROM screener_configs WHERE is_active = 1 ORDER BY name')
    .all();
}

// ═══════════════════════════════════════════════════════════════
//  Scan Results
// ═══════════════════════════════════════════════════════════════

/**
 * Save a single scan result row from a screener run.
 * @param {number} screenerId - Foreign key to screener_configs.id.
 * @param {{ symbol: string, name?: string, price?: number, volume?: number, change_percent?: number, [key: string]: any }} stock
 */
export function saveScanResult(screenerId, stock) {
  const db = getDb();
  const rawData = JSON.stringify(stock);
  db.prepare(
    `INSERT INTO scan_results (screener_id, symbol, name, price, volume, change_percent, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    screenerId,
    stock.symbol,
    stock.name ?? null,
    stock.price ?? null,
    stock.volume ?? null,
    stock.change_percent ?? null,
    rawData
  );
}

/**
 * Get scan results from the last N hours.
 * @param {number} [hours=1] - Lookback window in hours.
 * @returns {Array<Object>}
 */
export function getRecentScanResults(hours = 1) {
  const db = getDb();
  return db
    .prepare(
      `SELECT sr.*, sc.name AS screener_name, sc.slug AS screener_slug
       FROM scan_results sr
       LEFT JOIN screener_configs sc ON sr.screener_id = sc.id
       WHERE sr.scanned_at >= datetime('now', ? || ' hours')
       ORDER BY sr.scanned_at DESC`
    )
    .all(`-${hours}`);
}

// ═══════════════════════════════════════════════════════════════
//  Alert Log
// ═══════════════════════════════════════════════════════════════

/**
 * Check whether an alert of the given type was already sent for a symbol today.
 * "Today" is defined as the current UTC date.
 * @param {string} symbol    - e.g. 'RELIANCE'.
 * @param {string} alertType - e.g. 'indicator_match', 'price_alert'.
 * @returns {boolean}
 */
export function wasAlertedToday(symbol, alertType) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM alert_log
       WHERE symbol = ?
         AND alert_type = ?
         AND sent_at >= date('now')
       LIMIT 1`
    )
    .get(symbol, alertType);
  return !!row;
}

/**
 * Log a sent alert so it can be de-duplicated later.
 * @param {string} symbol    - e.g. 'RELIANCE'.
 * @param {string} alertType - e.g. 'indicator_match'.
 * @param {string} [message] - The message text that was sent.
 */
export function logAlert(symbol, alertType, message = null) {
  const db = getDb();
  db.prepare(
    `INSERT INTO alert_log (symbol, alert_type, message)
     VALUES (?, ?, ?)`
  ).run(symbol, alertType, message);
  logger.debug({ symbol, alertType }, 'Alert logged');
}

// ═══════════════════════════════════════════════════════════════
//  Watchlist
// ═══════════════════════════════════════════════════════════════

/**
 * Add a symbol to the watchlist (upsert — updates name/notes if it already exists).
 * @param {string} symbol - e.g. 'INFY'.
 * @param {string} [name] - Company / display name.
 * @param {string} [notes] - Free-form user notes.
 */
export function addToWatchlist(symbol, name = null, notes = null) {
  const db = getDb();
  db.prepare(
    `INSERT INTO watchlist (symbol, name, notes)
     VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       name  = COALESCE(excluded.name, name),
       notes = COALESCE(excluded.notes, notes)`
  ).run(symbol, name, notes);
  logger.debug({ symbol }, 'Added to watchlist');
}

/**
 * Remove a symbol from the watchlist.
 * @param {string} symbol
 * @returns {boolean} True if a row was deleted.
 */
export function removeFromWatchlist(symbol) {
  const db = getDb();
  const info = db.prepare('DELETE FROM watchlist WHERE symbol = ?').run(symbol);
  return info.changes > 0;
}

/**
 * Get every item on the watchlist, ordered by most-recently added first.
 * @returns {Array<{ id: number, symbol: string, name: string | null, added_at: string, notes: string | null }>}
 */
export function getWatchlist() {
  const db = getDb();
  return db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC').all();
}

// ═══════════════════════════════════════════════════════════════
//  Indicator Cache
// ═══════════════════════════════════════════════════════════════

/**
 * Cache OHLCV candle data and calculated indicator values for a symbol/timeframe.
 * Uses upsert so stale data is automatically replaced.
 * @param {string} symbol     - e.g. 'RELIANCE'.
 * @param {string} timeframe  - e.g. 'daily', '15m'.
 * @param {Array}  data       - Array of OHLCV candle objects.
 * @param {Object} [indicators] - Calculated indicator values (RSI, MACD, etc.).
 */
export function cacheIndicatorData(symbol, timeframe, data, indicators = null) {
  const db = getDb();
  db.prepare(
    `INSERT INTO indicator_cache (symbol, timeframe, data, indicators, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(symbol, timeframe) DO UPDATE SET
       data       = excluded.data,
       indicators = excluded.indicators,
       updated_at = datetime('now')`
  ).run(symbol, timeframe, JSON.stringify(data), indicators ? JSON.stringify(indicators) : null);
  logger.debug({ symbol, timeframe }, 'Indicator data cached');
}

/**
 * Retrieve cached indicator data if it's fresher than maxAgeMinutes.
 * Returns null when there is no cache hit or the cache is stale.
 * @param {string} symbol         - e.g. 'RELIANCE'.
 * @param {string} timeframe      - e.g. 'daily', '15m'.
 * @param {number} [maxAgeMinutes=30] - Maximum acceptable cache age in minutes.
 * @returns {{ data: Array, indicators: Object | null, updated_at: string } | null}
 */
export function getCachedIndicators(symbol, timeframe, maxAgeMinutes = 30) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT data, indicators, updated_at
       FROM indicator_cache
       WHERE symbol = ?
         AND timeframe = ?
         AND updated_at >= datetime('now', ? || ' minutes')
       LIMIT 1`
    )
    .get(symbol, timeframe, `-${maxAgeMinutes}`);

  if (!row) return null;

  return {
    data: JSON.parse(row.data),
    indicators: row.indicators ? JSON.parse(row.indicators) : null,
    updated_at: row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════
//  NSE Universe Cache
// ═══════════════════════════════════════════════════════════════

/**
 * Get cached symbols for a specific index if fetched within the last 24 hours.
 * @param {string} indexName - 'MIDCAP150' or 'SMALLCAP250'
 * @returns {Array<string>|null} Array of symbols or null if missing/expired
 */
export function getUniverseCache(indexName) {
  const db = getDb();
  // 24 hours in milliseconds = 86400000
  const row = db
    .prepare(
      `SELECT symbols, fetched_at 
       FROM nse_universe_cache 
       WHERE index_name = ?`
    )
    .get(indexName);

  if (!row) return null;

  const now = Date.now();
  if (now - row.fetched_at > 86400000) {
    return null; // Expired
  }

  try {
    return JSON.parse(row.symbols);
  } catch (err) {
    logger.error({ err, indexName }, 'Failed to parse cached symbols');
    return null;
  }
}

/**
 * Cache symbols for a specific index.
 * @param {string} indexName - 'MIDCAP150' or 'SMALLCAP250'
 * @param {Array<string>} symbols - Array of stock symbols
 */
export function setUniverseCache(indexName, symbols) {
  const db = getDb();
  db.prepare(
    `INSERT INTO nse_universe_cache (symbols, fetched_at, index_name)
     VALUES (?, ?, ?)
     ON CONFLICT(index_name) DO UPDATE SET
       symbols = excluded.symbols,
       fetched_at = excluded.fetched_at`
  ).run(JSON.stringify(symbols), Date.now(), indexName);
  logger.debug({ indexName, count: symbols.length }, 'NSE universe cached');
}
