import logger from '../utils/logger.js';
import { retry } from '../utils/error-handler.js';

/**
 * In-memory instrument cache with Chartink↔Kite symbol mapping.
 *
 * On first call to {@link loadInstruments}, the full NSE instrument list is
 * fetched from Kite and indexed by `tradingsymbol`.  Subsequent lookups are
 * O(1) from the map.  The cache can be refreshed manually by calling
 * `loadInstruments()` again.
 *
 * @example
 * ```js
 * const mapper = new InstrumentMapper(kiteClient);
 * await mapper.loadInstruments();
 *
 * const info = mapper.getInstrument('RELIANCE');
 * // → { instrument_token: 738561, exchange: 'NSE', name: 'RELIANCE IND', lot_size: 1, ... }
 *
 * const ltpKey = mapper.formatForKiteLTP('RELIANCE');
 * // → 'NSE:RELIANCE'
 * ```
 */
class InstrumentMapper {
  /**
   * @param {import('./client.js').default} kiteClient - An authenticated KiteClient instance.
   */
  constructor(kiteClient) {
    /** @private */
    this.kiteClient = kiteClient;

    /**
     * Primary lookup: tradingsymbol → instrument details.
     * @type {Map<string, {
     *   instrument_token: number,
     *   exchange_token: number,
     *   tradingsymbol: string,
     *   name: string,
     *   exchange: string,
     *   lot_size: number,
     *   instrument_type: string,
     *   segment: string,
     *   tick_size: number,
     *   expiry?: string,
     *   strike?: number
     * }>}
     */
    this.instruments = new Map();

    /**
     * Timestamp of the last successful instrument fetch.
     * @type {Date | null}
     */
    this.lastFetch = null;
  }

  // ─── Loading ───────────────────────────────────────────────────

  /**
   * Fetch the full NSE instrument list from Kite and build the lookup map.
   *
   * The Kite instruments API returns ~8000+ rows for NSE.  We index them
   * by upper-cased `tradingsymbol` for O(1) lookups.
   *
   * @param {string} [exchange='NSE'] - Exchange to fetch instruments for.
   * @returns {Promise<number>} Count of instruments loaded.
   */
  async loadInstruments(exchange = 'NSE') {
    logger.info({ exchange }, 'Loading instruments from Kite');

    try {
      const rawInstruments = await retry(
        () => this.kiteClient.kc.getInstruments(exchange),
        { maxAttempts: 3, delayMs: 2000 }
      );

      // Rebuild the map from scratch
      this.instruments.clear();

      for (const inst of rawInstruments) {
        const key = String(inst.tradingsymbol).toUpperCase().trim();
        this.instruments.set(key, {
          instrument_token: inst.instrument_token,
          exchange_token: inst.exchange_token,
          tradingsymbol: inst.tradingsymbol,
          name: inst.name || '',
          exchange: inst.exchange || exchange,
          lot_size: inst.lot_size || 1,
          instrument_type: inst.instrument_type || '',
          segment: inst.segment || '',
          tick_size: inst.tick_size || 0.05,
          expiry: inst.expiry || null,
          strike: inst.strike || null,
        });
      }

      this.lastFetch = new Date();

      logger.info(
        { count: this.instruments.size, exchange, fetchedAt: this.lastFetch.toISOString() },
        `Loaded ${this.instruments.size} instruments`
      );

      return this.instruments.size;
    } catch (error) {
      logger.error({ err: error, exchange }, 'Failed to load instruments from Kite');
      throw error;
    }
  }

  // ─── Lookups ───────────────────────────────────────────────────

  /**
   * Map a Chartink symbol to a Kite trading symbol.
   *
   * Chartink typically uses the bare NSE symbol (e.g. `"RELIANCE"`),
   * which matches Kite's `tradingsymbol` directly.  This method
   * normalises casing and trims whitespace.
   *
   * @param {string} chartinkSymbol - Symbol as it appears on Chartink.
   * @returns {string} Kite-compatible trading symbol.
   */
  getKiteSymbol(chartinkSymbol) {
    return chartinkSymbol.toUpperCase().trim();
  }

  /**
   * Look up full instrument details by symbol.
   *
   * @param {string} symbol - Trading symbol (case-insensitive).
   * @returns {{
   *   instrument_token: number,
   *   exchange_token: number,
   *   tradingsymbol: string,
   *   name: string,
   *   exchange: string,
   *   lot_size: number,
   *   instrument_type: string,
   *   segment: string,
   *   tick_size: number,
   *   expiry?: string,
   *   strike?: number
   * } | undefined} Instrument details, or `undefined` if not found.
   */
  getInstrument(symbol) {
    return this.instruments.get(symbol.toUpperCase().trim());
  }

  /**
   * Format a symbol for Kite LTP / Quote API calls.
   *
   * Kite expects the `"EXCHANGE:SYMBOL"` format, e.g. `"NSE:RELIANCE"`.
   *
   * @param {string} symbol    - Trading symbol.
   * @param {string} [exchange='NSE'] - Exchange prefix.
   * @returns {string} Formatted string like `"NSE:RELIANCE"`.
   */
  formatForKiteLTP(symbol, exchange = 'NSE') {
    return `${exchange}:${symbol.toUpperCase().trim()}`;
  }

  /**
   * Format multiple symbols for a batch LTP / Quote call.
   *
   * @param {string[]} symbols - Array of trading symbols.
   * @param {string}   [exchange='NSE'] - Exchange prefix applied to all.
   * @returns {string[]} Array of `"EXCHANGE:SYMBOL"` strings.
   */
  formatManyForKiteLTP(symbols, exchange = 'NSE') {
    return symbols.map((s) => this.formatForKiteLTP(s, exchange));
  }

  /**
   * Check whether the instrument cache has been loaded.
   *
   * @returns {boolean}
   */
  isLoaded() {
    return this.instruments.size > 0 && this.lastFetch !== null;
  }

  /**
   * Check whether the cache is stale (older than a given threshold).
   *
   * @param {number} [maxAgeMs=86400000] - Max age in ms (default: 24 h).
   * @returns {boolean} `true` if the cache is missing or older than `maxAgeMs`.
   */
  isStale(maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!this.lastFetch) return true;
    return Date.now() - this.lastFetch.getTime() > maxAgeMs;
  }

  /**
   * Ensure the instrument cache is loaded; reload if stale.
   *
   * Safe to call repeatedly — will only hit the API when needed.
   *
   * @param {string} [exchange='NSE'] - Exchange to load.
   * @returns {Promise<void>}
   */
  async ensureLoaded(exchange = 'NSE') {
    if (this.isStale()) {
      await this.loadInstruments(exchange);
    }
  }
}

export default InstrumentMapper;
