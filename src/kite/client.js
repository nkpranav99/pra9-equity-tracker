import { KiteConnect } from 'kiteconnect';
import config from '../config.js';
import logger from '../utils/logger.js';
import { retry } from '../utils/error-handler.js';

/**
 * Wrapper around the Kite Connect SDK that adds:
 * - Authentication guard (`_checkAuth`) on every market data / trading call
 * - Session generation + persistence via DB
 * - Retry logic on transient API failures
 * - Initialisation from a previously stored access token
 *
 * @example
 * ```js
 * const kc = new KiteClient(config.kite.apiKey, config.kite.apiSecret);
 * const ok = await kc.initFromStoredToken();
 * if (!ok) {
 *   // trigger login flow
 * }
 * const holdings = await kc.getHoldings();
 * ```
 */
class KiteClient {
  /**
   * @param {string} apiKey    - Kite Connect API key.
   * @param {string} apiSecret - Kite Connect API secret.
   */
  constructor(apiKey, apiSecret) {
    /** @type {KiteConnect} */
    this.kc = new KiteConnect({ api_key: apiKey });

    /** @private */
    this.apiSecret = apiSecret;

    /** Whether a valid access token has been set. */
    this.isAuthenticated = false;

    /** The current access token (if any). */
    this.accessToken = null;

    logger.debug('KiteClient initialised');
  }

  // ─── Authentication ────────────────────────────────────────────

  /**
   * Directly set an access token obtained from another source.
   *
   * @param {string} token - A valid Kite access token.
   */
  setAccessToken(token) {
    this.kc.setAccessToken(token);
    this.accessToken = token;
    this.isAuthenticated = true;
    logger.info('Kite access token set — client is authenticated');
  }

  /**
   * Exchange a one-time request token for a persistent access token.
   *
   * The request token is the value Kite appends to the redirect URL after
   * the user (or the auto-login flow) completes the Kite login.
   *
   * The resulting access token is persisted via the DB queries module
   * so the bot can restore the session on restart.
   *
   * @param {string} requestToken - One-time request token from Kite redirect.
   * @returns {Promise<{ accessToken: string, publicToken: string, userId: string }>}
   */
  async generateSession(requestToken) {
    try {
      logger.info('Generating Kite session from request token');

      const session = await retry(
        () => this.kc.generateSession(requestToken, this.apiSecret),
        { maxAttempts: 2, delayMs: 1000 }
      );

      this.setAccessToken(session.access_token);

      // Persist token to DB for session recovery on restart
      try {
        const { saveKiteToken } = await import('../db/queries.js');
        await saveKiteToken({
          accessToken: session.access_token,
          publicToken: session.public_token || '',
          userId: session.user_id || config.kite.userId,
          loginTime: new Date().toISOString(),
        });
        logger.info({ userId: session.user_id }, 'Kite token saved to database');
      } catch (dbError) {
        // DB persistence is best-effort — the token is still usable in memory
        logger.warn(
          { err: dbError },
          'Could not persist Kite token to database (non-fatal)'
        );
      }

      return {
        accessToken: session.access_token,
        publicToken: session.public_token,
        userId: session.user_id,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate Kite session');
      throw error;
    }
  }

  // ─── Market Data ───────────────────────────────────────────────

  /**
   * Get all holdings in the Demat account.
   *
   * @returns {Promise<Array<{
   *   tradingsymbol: string, exchange: string, quantity: number,
   *   average_price: number, last_price: number, pnl: number,
   *   day_change: number, day_change_percentage: number
   * }>>}
   */
  async getHoldings() {
    this._checkAuth();
    return await retry(() => this.kc.getHoldings(), { maxAttempts: 2 });
  }

  /**
   * Get current day positions (net + day).
   *
   * @returns {Promise<{ net: Array, day: Array }>}
   */
  async getPositions() {
    this._checkAuth();
    return await retry(() => this.kc.getPositions(), { maxAttempts: 2 });
  }

  /**
   * Get all orders placed today.
   *
   * @returns {Promise<Array<object>>}
   */
  async getOrders() {
    this._checkAuth();
    return await retry(() => this.kc.getOrders(), { maxAttempts: 2 });
  }

  /**
   * Get account margins (equity + commodity segments).
   *
   * @returns {Promise<{ equity: object, commodity: object }>}
   */
  async getMargins() {
    this._checkAuth();
    return await retry(() => this.kc.getMargins(), { maxAttempts: 2 });
  }

  // ─── Order Management ─────────────────────────────────────────

  /**
   * Place a regular order on Kite.
   *
   * @param {{
   *   exchange: string,
   *   tradingsymbol: string,
   *   transaction_type: 'BUY' | 'SELL',
   *   quantity: number,
   *   product: 'CNC' | 'MIS' | 'NRML',
   *   order_type: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M',
   *   price?: number,
   *   trigger_price?: number,
   *   validity?: 'DAY' | 'IOC',
   *   tag?: string
   * }} params - Order parameters.
   * @returns {Promise<{ order_id: string }>}
   */
  async placeOrder(params) {
    this._checkAuth();

    logger.info(
      {
        symbol: params.tradingsymbol,
        type: params.transaction_type,
        qty: params.quantity,
        orderType: params.order_type,
        price: params.price,
      },
      'Placing Kite order'
    );

    try {
      const result = await this.kc.placeOrder('regular', params);
      logger.info({ orderId: result.order_id, symbol: params.tradingsymbol }, 'Order placed');
      return result;
    } catch (error) {
      logger.error(
        { err: error, params },
        `Order placement failed for ${params.tradingsymbol}`
      );
      throw error;
    }
  }

  /**
   * Get last traded prices for an array of instruments.
   *
   * @param {string[]} symbols - Array of "EXCHANGE:SYMBOL" strings,
   *                             e.g. `['NSE:RELIANCE', 'NSE:TCS']`.
   * @returns {Promise<Record<string, { instrument_token: number, last_price: number }>>}
   */
  async getLTP(symbols) {
    this._checkAuth();
    return await retry(() => this.kc.getLTP(symbols), { maxAttempts: 2 });
  }

  /**
   * Get full quote data for an array of instruments.
   *
   * @param {string[]} symbols - Array of "EXCHANGE:SYMBOL" strings.
   * @returns {Promise<Record<string, object>>}
   */
  async getQuote(symbols) {
    this._checkAuth();
    return await retry(() => this.kc.getQuote(symbols), { maxAttempts: 2 });
  }

  // ─── Session Recovery ──────────────────────────────────────────

  /**
   * Attempt to restore authentication from a token stored in the database.
   *
   * Kite access tokens are valid for a single trading day (until ~06:00 the
   * next morning).  This method loads the most recent stored token, sets it
   * on the SDK instance, and makes a lightweight profile call to verify
   * that it is still valid.
   *
   * @returns {Promise<boolean>} `true` if the stored token is still valid
   *                             and the client is now authenticated.
   */
  async initFromStoredToken() {
    try {
      const { getLatestKiteToken } = await import('../db/queries.js');
      const stored = await getLatestKiteToken();

      if (!stored || !stored.accessToken) {
        logger.info('No stored Kite token found — login required');
        return false;
      }

      // Set the token optimistically
      this.kc.setAccessToken(stored.accessToken);

      // Validate with a lightweight API call
      try {
        const profile = await this.kc.getProfile();
        this.accessToken = stored.accessToken;
        this.isAuthenticated = true;
        logger.info(
          { userId: profile.user_id },
          'Kite session restored from stored token'
        );
        return true;
      } catch (validationError) {
        // Token expired or invalid — clear it
        logger.warn(
          { err: validationError },
          'Stored Kite token is invalid/expired — login required'
        );
        this.isAuthenticated = false;
        this.accessToken = null;
        return false;
      }
    } catch (error) {
      logger.warn(
        { err: error },
        'Could not load Kite token from database — login required'
      );
      return false;
    }
  }

  // ─── Internal ──────────────────────────────────────────────────

  /**
   * Guard: throws if the client is not authenticated.
   * @private
   */
  _checkAuth() {
    if (!this.isAuthenticated) {
      throw new Error(
        'Kite not authenticated. Run /login or wait for auto-login.'
      );
    }
  }
}

export default KiteClient;
