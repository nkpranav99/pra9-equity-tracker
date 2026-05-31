import logger from '../utils/logger.js';

/**
 * Default column mapping for Chartink screener response rows.
 * Chartink returns rows as arrays — the column order matches the screener
 * table headers. This is the typical default order; screener-specific
 * overrides can be passed to `parseChartinkRow`.
 */
const DEFAULT_COLUMNS = [
  'sr',           // 0 — serial number
  'symbol',       // 1 — NSE/BSE trading symbol
  'name',         // 2 — company name
  'exchange',     // 3 — NSE / BSE
  'price',        // 4 — close / LTP
  'volume',       // 5 — volume
  'change',       // 6 — price change (absolute)
  'changePercent', // 7 — price change (%)
];

/**
 * Clean up and normalise a raw symbol string coming from Chartink.
 *
 * - Trims whitespace
 * - Converts to uppercase
 * - Strips exchange prefixes like "NSE:" or "BSE:"
 * - Removes any non-alphanumeric trailing characters (e.g. "*" annotations)
 *
 * @param {string} rawSymbol - The raw symbol from Chartink.
 * @returns {string} Normalised symbol (e.g. "RELIANCE").
 */
export function normalizeSymbol(rawSymbol) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    return '';
  }

  let symbol = rawSymbol.trim().toUpperCase();

  // Remove exchange prefixes (NSE:, BSE:, etc.)
  symbol = symbol.replace(/^(NSE|BSE)\s*[:\-]\s*/i, '');

  // Remove trailing non-alphanumeric chars (annotations like *, #, etc.)
  symbol = symbol.replace(/[^A-Z0-9&\-]+$/g, '');

  return symbol;
}

/**
 * Convert a raw Chartink data row (array) into a structured stock object.
 *
 * @param {Array<string>} row     - Raw row from Chartink JSON response.
 * @param {string[]}      [columns] - Column name mapping (positional).
 *                                     Defaults to {@link DEFAULT_COLUMNS}.
 * @returns {{ symbol: string, name: string, price: number, volume: number,
 *             change: number, changePercent: number, exchange: string,
 *             [key: string]: any } | null}
 *   Normalised stock object, or `null` if the row is invalid / unparseable.
 */
export function parseChartinkRow(row, columns = DEFAULT_COLUMNS) {
  if (!row) {
    logger.warn({ row }, 'Skipping empty Chartink row');
    return null;
  }

  let raw = {};
  let extra = {};

  if (Array.isArray(row)) {
    if (row.length < 2) {
      logger.warn({ row }, 'Skipping invalid Chartink row (array too short)');
      return null;
    }
    // Build a raw key→value map from the positional arrays
    columns.forEach((col, idx) => {
      raw[col] = idx < row.length ? row[idx] : null;
    });

    // Also capture any extra columns beyond the known mapping
    for (let i = columns.length; i < row.length; i++) {
      extra[`col_${i}`] = row[i];
    }
  } else if (typeof row === 'object') {
    // New Vue.js Chartink API format returns objects
    raw = {
      symbol: row.nsecode || row.bsecode,
      name: row.name,
      exchange: row.nsecode ? 'NSE' : 'BSE',
      price: row.close,
      changePercent: row.per_chg,
      volume: row.volume,
    };
    // Include all other keys as extra
    extra = { ...row };
  } else {
    logger.warn({ row }, 'Skipping invalid Chartink row (unknown format)');
    return null;
  }

  const symbol = normalizeSymbol(raw.symbol);
  if (!symbol) {
    logger.warn({ row }, 'Skipping Chartink row with empty symbol');
    return null;
  }

  return {
    symbol,
    name: raw.name ? String(raw.name).trim() : symbol,
    exchange: raw.exchange ? String(raw.exchange).trim().toUpperCase() : 'NSE',
    price: parseFloat(raw.price) || 0,
    volume: parseInt(raw.volume, 10) || 0,
    change: parseFloat(raw.change) || 0,
    changePercent: parseFloat(raw.changePercent) || 0,
    ...extra,
    // Timestamp for when this row was parsed
    scannedAt: new Date().toISOString(),
  };
}

/**
 * De-duplicate an array of stock objects by symbol, keeping the most
 * recently scanned entry (latest `scannedAt`) for each symbol.
 *
 * @param {Array<{ symbol: string, scannedAt: string }>} results
 * @returns {Array<{ symbol: string, scannedAt: string }>} Deduplicated array.
 */
export function deduplicateResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  /** @type {Map<string, object>} */
  const seen = new Map();

  for (const stock of results) {
    if (!stock || !stock.symbol) continue;

    const key = stock.symbol.toUpperCase();
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, stock);
    } else {
      // Keep the one with the latest scannedAt timestamp
      const existingTime = new Date(existing.scannedAt || 0).getTime();
      const currentTime = new Date(stock.scannedAt || 0).getTime();
      if (currentTime > existingTime) {
        seen.set(key, stock);
      }
    }
  }

  const deduplicated = Array.from(seen.values());
  const removed = results.length - deduplicated.length;

  if (removed > 0) {
    logger.info(
      { total: results.length, deduplicated: deduplicated.length, removed },
      'Deduplicated screener results'
    );
  }

  return deduplicated;
}
