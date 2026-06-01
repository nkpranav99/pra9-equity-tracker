/**
 * @fileoverview OHLCV data fetcher for Indian equities.
 *
 * Fetches historical candlestick data from free public sources:
 *   1. Yahoo Finance V8 API (primary — no API key required)
 *   2. Google Finance (fallback stub — unreliable, reserved for future)
 *
 * Caches results via the db/queries module to minimise API calls.
 * Uses retry() with exponential backoff for resilient network requests.
 *
 * NSE symbols are appended with `.NS` (e.g., RELIANCE → RELIANCE.NS).
 * BSE symbols would use `.BO` — extend _buildYahooSymbol if needed.
 */

import axios from 'axios';
import logger from '../utils/logger.js';
import { retry } from '../utils/error-handler.js';

// ── Cache helpers (graceful no-op if db module isn't built yet) ──────
let getCachedIndicators = () => null;
let cacheIndicatorData = () => {};

try {
  const dbQueries = await import('../db/queries.js');
  if (dbQueries.getCachedIndicators) getCachedIndicators = dbQueries.getCachedIndicators;
  if (dbQueries.cacheIndicatorData) cacheIndicatorData = dbQueries.cacheIndicatorData;
} catch {
  logger.warn('db/queries.js not available — indicator caching disabled');
}

/**
 * @typedef {Object} Candle
 * @property {string} date   - ISO date string
 * @property {number} open   - Open price
 * @property {number} high   - High price
 * @property {number} low    - Low price
 * @property {number} close  - Close price
 * @property {number} volume - Trade volume
 */

/**
 * Mapping from logical timeframe names to Yahoo Finance API interval params.
 * @type {Record<string, {interval: string, range: string}>}
 */
const TIMEFRAME_MAP = {
  daily:  { interval: '1d',  range: '2y'  },
  '1d':   { interval: '1d',  range: '2y'  },
  '15m':  { interval: '15m', range: '60d' },
  '1h':   { interval: '1h',  range: '6mo' },
  '5m':   { interval: '5m',  range: '60d' },
  weekly: { interval: '1wk', range: '2y'  },
  '1wk':  { interval: '1wk', range: '2y'  },
};

class DataFetcher {
  /**
   * @param {Object} [kiteClient] - Optional Kite Connect client (unused here,
   *                                 reserved for real-time data in future)
   */
  constructor(kiteClient) {
    this.kiteClient = kiteClient || null;
  }

  /**
   * Get OHLCV candle data for a symbol.
   * Tries multiple sources in order of preference and caches the result.
   *
   * @param {string} symbol       - NSE stock symbol (e.g., 'RELIANCE')
   * @param {string} [timeframe='daily'] - Candle timeframe
   * @param {number} [lookback=365]      - Approximate number of candles
   * @returns {Promise<Candle[]>}
   * @throws {Error} If all data sources fail
   */
  async getOHLCV(symbol, timeframe = 'daily', lookback = 365) {
    // ── 1. Check cache ──────────────────────────────────────────────
    try {
      const cached = getCachedIndicators(symbol, timeframe, 60); // 60-min TTL
      if (cached?.data) {
        logger.debug({ symbol, timeframe }, 'Returning cached OHLCV data');
        return JSON.parse(cached.data);
      }
    } catch (cacheErr) {
      logger.debug({ symbol, err: cacheErr.message }, 'Cache lookup skipped');
    }

    // ── 2. Yahoo Finance (primary source) ───────────────────────────
    try {
      const data = await this._fetchFromYahoo(symbol, timeframe, lookback);
      if (data && data.length > 0) {
        this._saveToCache(symbol, timeframe, data);
        logger.info({ symbol, timeframe, candles: data.length }, 'Fetched OHLCV from Yahoo Finance');
        return data;
      }
    } catch (err) {
      logger.warn({ symbol, err: err.message }, 'Yahoo Finance fetch failed, trying fallback');
    }

    // ── 3. Google Finance fallback (stub) ───────────────────────────
    try {
      const data = await this._fetchFromGoogle(symbol, timeframe, lookback);
      if (data && data.length > 0) {
        this._saveToCache(symbol, timeframe, data);
        logger.info({ symbol, timeframe, candles: data.length }, 'Fetched OHLCV from Google Finance');
        return data;
      }
    } catch (err) {
      logger.warn({ symbol, err: err.message }, 'Google Finance fetch failed');
    }

    throw new Error(`Could not fetch OHLCV data for ${symbol} from any source`);
  }

  // ─── Private: Yahoo Finance V8 ───────────────────────────────────

  /**
   * Fetch OHLCV data from Yahoo Finance V8 chart API.
   *
   * For NSE stocks the symbol is suffixed with `.NS` (e.g., RELIANCE.NS).
   * The API returns timestamps + parallel arrays for open/high/low/close/volume.
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @param {number} lookback
   * @returns {Promise<Candle[]>}
   * @private
   */
  async _fetchFromYahoo(symbol, timeframe, lookback) {
    const yahooSymbol = this._buildYahooSymbol(symbol);
    const { interval, range } = TIMEFRAME_MAP[timeframe] || TIMEFRAME_MAP.daily;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;

    const response = await retry(
      () =>
        axios.get(url, {
          params: { interval, range },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: 15000,
        }),
      { maxAttempts: 3, delayMs: 2000 }
    );

    const chart = response.data?.chart;
    if (!chart || chart.error) {
      throw new Error(chart?.error?.description || 'Empty chart response from Yahoo Finance');
    }

    const result = chart.result?.[0];
    if (!result) {
      throw new Error('No chart result returned from Yahoo Finance');
    }

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    if (!quote) {
      throw new Error('No quote data in Yahoo Finance response');
    }

    const { open, high, low, close, volume } = quote;

    // Build candle array, filtering out null/incomplete entries
    /** @type {Candle[]} */
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (
        open[i] != null &&
        high[i] != null &&
        low[i] != null &&
        close[i] != null &&
        volume[i] != null
      ) {
        candles.push({
          date: new Date(timestamps[i] * 1000).toISOString(),
          open: open[i],
          high: high[i],
          low: low[i],
          close: close[i],
          volume: volume[i],
        });
      }
    }

    return candles;
  }

  /**
   * Convert an NSE symbol to a Yahoo Finance ticker.
   * Appends `.NS` for National Stock Exchange.
   *
   * @param {string} symbol - e.g. 'RELIANCE', 'TCS'
   * @returns {string}      - e.g. 'RELIANCE.NS'
   * @private
   */
  _buildYahooSymbol(symbol) {
    // Already has a suffix (.NS, .BO) — leave it as-is
    if (symbol.includes('.')) return symbol;
    // Default to NSE
    return `${symbol}.NS`;
  }

  // ─── Private: Google Finance (Stub) ──────────────────────────────

  /**
   * Fallback fetcher using Google Finance.
   * Google doesn't expose a clean public JSON API, so this is a stub
   * that returns an empty array. Extend with scraping logic if needed.
   *
   * @param {string} symbol
   * @param {string} timeframe
   * @param {number} lookback
   * @returns {Promise<Candle[]>}
   * @private
   */
  async _fetchFromGoogle(symbol, timeframe, lookback) {
    // Google Finance doesn't have a reliable public API.
    // This stub exists so the fallback chain doesn't throw.
    // Implement web scraping here if you need a secondary source.
    logger.debug({ symbol }, 'Google Finance fallback is a stub — returning empty');
    return [];
  }

  // ─── Private: Cache ──────────────────────────────────────────────

  /**
   * Persist fetched OHLCV data to the local cache.
   *
   * @param {string}   symbol
   * @param {string}   timeframe
   * @param {Candle[]} data
   * @private
   */
  _saveToCache(symbol, timeframe, data) {
    try {
      cacheIndicatorData(symbol, timeframe, JSON.stringify(data), null);
    } catch (err) {
      logger.debug({ symbol, err: err.message }, 'Failed to cache OHLCV data (non-fatal)');
    }
  }
}

export default DataFetcher;
