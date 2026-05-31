import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';
import logger from '../utils/logger.js';
import { retry } from '../utils/error-handler.js';
import { parseChartinkRow, deduplicateResults } from './parser.js';

/**
 * Chartink screener scraper.
 *
 * Handles session cookies, CSRF token extraction, and the two-step flow
 * required to pull screener results from Chartink:
 *   1. GET the screener page → extract CSRF token + scan_clause
 *   2. POST to /screener/process with the token + clause → get JSON results
 *
 * @example
 * ```js
 * const scraper = new ChartinkScraper();
 * const results = await scraper.scanScreener('my-breakout-scanner');
 * console.log(results);
 * ```
 */
class ChartinkScraper {
  constructor() {
    /**
     * Shared cookie jar stored as raw Set-Cookie strings.
     * We forward them on every subsequent request so the Chartink
     * session stays alive across GET→POST flows.
     * @type {string[]}
     */
    this._cookies = [];

    /**
     * Pre-configured axios instance with browser-like default headers.
     */
    this.http = axios.create({
      baseURL: config.chartink.baseUrl,
      timeout: 30_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,' +
          'image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Connection: 'keep-alive',
      },
      // Don't follow redirects automatically — we may need to inspect 302s
      maxRedirects: 5,
      // We manage cookies ourselves
      withCredentials: false,
    });

    // Intercept responses to capture Set-Cookie headers
    this.http.interceptors.response.use((response) => {
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        this._mergeCookies(setCookies);
      }
      return response;
    });

    // Intercept requests to attach stored cookies
    this.http.interceptors.request.use((reqConfig) => {
      if (this._cookies.length > 0) {
        const cookieHeader = this._cookies
          .map((c) => c.split(';')[0]) // take only name=value
          .join('; ');
        reqConfig.headers.Cookie = cookieHeader;
      }
      return reqConfig;
    });
  }

  // ─── Private Helpers ───────────────────────────────────────────

  /**
   * Merge incoming Set-Cookie values into the stored jar,
   * replacing any cookies that share the same name.
   * @param {string[]} incoming
   */
  _mergeCookies(incoming) {
    const cookieMap = new Map();

    // Parse existing cookies into map
    for (const c of this._cookies) {
      const name = c.split('=')[0].trim();
      cookieMap.set(name, c);
    }

    // Overwrite / add incoming
    for (const c of incoming) {
      const name = c.split('=')[0].trim();
      cookieMap.set(name, c);
    }

    this._cookies = Array.from(cookieMap.values());
  }

  // ─── CSRF Token ────────────────────────────────────────────────

  /**
   * Fetch the main screener page and extract the CSRF token
   * from the `<meta name="csrf-token">` tag.
   *
   * This also primes the cookie jar with session cookies that are
   * required for the POST to `/screener/process` to succeed.
   *
   * @returns {Promise<string>} CSRF token string.
   * @throws {Error} If the page cannot be fetched or the token is not found.
   */
  async _getCSRFToken() {
    logger.debug('Fetching Chartink screener page for CSRF token');

    const response = await retry(
      () => this.http.get('/screener'),
      { maxAttempts: 3, delayMs: 2000 }
    );

    const $ = cheerio.load(response.data);

    // Chartink puts the token in <meta name="csrf-token" content="...">
    const token = $('meta[name="csrf-token"]').attr('content');
    if (!token) {
      throw new Error('Could not extract CSRF token from Chartink screener page');
    }

    logger.debug({ tokenLength: token.length }, 'CSRF token obtained');
    return token;
  }

  // ─── Scan Clause Extraction ────────────────────────────────────

  /**
   * Fetch a specific screener page and extract its `scan_clause`.
   *
   * The clause is the Chartink query DSL stored in the page, typically
   * found in one of these locations (checked in order):
   *   1. `<textarea>` or `<input>` with id/name containing "scan_clause"
   *   2. A `<script>` block setting a JS variable containing the clause
   *
   * @param {string} slug - Screener slug (URL path component).
   * @returns {Promise<string>} The raw scan clause string.
   * @throws {Error} If the page cannot be fetched or the clause is missing.
   */
  async _getScanClause(slug) {
    logger.debug({ slug }, 'Fetching scan clause for screener');

    const response = await retry(
      () => this.http.get(`/screener/${encodeURIComponent(slug)}`),
      { maxAttempts: 3, delayMs: 2000 }
    );

    const $ = cheerio.load(response.data);
    let scanClause = '';

    // Strategy 1: Look for a form element with id/name containing "scan_clause"
    const formTargets = [
      '#scan_clause',
      '[name="scan_clause"]',
      'textarea[id*="scan_clause"]',
      'input[id*="scan_clause"]',
      'textarea[name*="scan_clause"]',
      'input[name*="scan_clause"]',
    ];

    for (const selector of formTargets) {
      const el = $(selector).first();
      if (el.length) {
        // Textareas hold value as inner text; inputs as "value" attribute
        scanClause = el.is('textarea') ? el.text() : el.val();
        if (scanClause && scanClause.trim()) {
          scanClause = scanClause.trim();
          break;
        }
      }
    }

    // Strategy 2: Look in <script> tags for the clause assignment
    if (!scanClause) {
      $('script').each((_i, el) => {
        const scriptContent = $(el).html() || '';

        // Common patterns:
        //   var scan_clause = "...";
        //   scan_clause = '...';
        //   window.scan_clause = `...`;
        const patterns = [
          /scan_clause\s*=\s*["'`]([^"'`]+)["'`]/,
          /scan_clause\s*:\s*["'`]([^"'`]+)["'`]/,
          /"scan_clause"\s*:\s*"([^"]+)"/,
        ];

        for (const pattern of patterns) {
          const match = scriptContent.match(pattern);
          if (match && match[1]) {
            scanClause = match[1].trim();
            return false; // break $.each
          }
        }
      });
    }

    if (!scanClause) {
      throw new Error(`Could not extract scan_clause from screener page: ${slug}`);
    }

    logger.debug(
      { slug, clauseLength: scanClause.length },
      'Scan clause extracted'
    );
    return scanClause;
  }

  // ─── Single Screener Scan ─────────────────────────────────────

  /**
   * Run a single Chartink screener and return the normalised results.
   *
   * Flow:
   *  1. Obtain a fresh CSRF token (also primes cookies).
   *  2. Fetch the scan_clause for the given screener slug.
   *  3. POST to `/screener/process` with the clause.
   *  4. Normalise the response rows into stock objects.
   *
   * @param {string} slug - Chartink screener slug (e.g. "my-breakout-scanner").
   * @returns {Promise<Array<{
   *   symbol: string,
   *   name: string,
   *   price: number,
   *   volume: number,
   *   change: number,
   *   changePercent: number,
   *   exchange: string,
   *   scannedAt: string
   * }>>} Array of normalised stock objects.
   */
  async scanScreener(slug) {
    logger.info({ slug }, 'Scanning Chartink screener');

    try {
      // Step 1 — CSRF token (also refreshes session cookies)
      const csrfToken = await this._getCSRFToken();

      // Step 2 — scan clause
      const scanClause = await this._getScanClause(slug);

      // Step 3 — POST to /screener/process
      const response = await retry(
        () =>
          this.http.post(
            '/screener/process',
            new URLSearchParams({ scan_clause: scanClause }).toString(),
            {
              headers: {
                'X-CSRF-TOKEN': csrfToken,
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: `${config.chartink.baseUrl}/screener/${slug}`,
                'X-Requested-With': 'XMLHttpRequest',
              },
            }
          ),
        { maxAttempts: 3, delayMs: 3000 }
      );

      // Step 4 — Normalise
      const json = response.data;
      if (!json || !Array.isArray(json.data)) {
        logger.warn({ slug, responseData: json }, 'Chartink response has no data array');
        return [];
      }

      const stocks = json.data
        .map((row) => parseChartinkRow(row))
        .filter(Boolean);

      logger.info(
        { slug, matchCount: stocks.length },
        `Chartink screener "${slug}" returned ${stocks.length} result(s)`
      );

      return stocks;
    } catch (error) {
      logger.error(
        { err: error, slug },
        `Failed to scan Chartink screener: ${slug}`
      );
      throw error;
    }
  }

  // ─── Batch Scan ────────────────────────────────────────────────

  /**
   * Scan **all** screeners listed in `config.chartink.screenerSlugs`.
   *
   * Runs each screener sequentially with a configurable delay between
   * requests (`config.chartink.requestDelayMs`) to avoid rate-limiting.
   * Results from all screeners are merged and de-duplicated by symbol,
   * keeping the most recent entry.
   *
   * @returns {Promise<Array<{
   *   symbol: string,
   *   name: string,
   *   price: number,
   *   volume: number,
   *   change: number,
   *   changePercent: number,
   *   exchange: string,
   *   scannedAt: string
   * }>>} Combined, de-duplicated array of stock objects.
   */
  async scanAll() {
    const slugs = config.chartink.screenerSlugs;

    if (!slugs || slugs.length === 0) {
      logger.warn('No Chartink screener slugs configured — nothing to scan');
      return [];
    }

    logger.info(
      { slugCount: slugs.length, slugs },
      'Starting batch scan of all configured screeners'
    );

    /** @type {Array<object>} */
    const allResults = [];
    const delayMs = config.chartink.requestDelayMs || 2000;

    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i];
      try {
        const results = await this.scanScreener(slug);
        allResults.push(...results);
      } catch (error) {
        // Log and continue — don't let one screener failure stop the batch
        logger.error(
          { err: error, slug },
          `Skipping screener "${slug}" due to error`
        );
      }

      // Rate-limit delay between requests (skip after the last one)
      if (i < slugs.length - 1) {
        logger.debug({ delayMs }, 'Waiting before next screener request');
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const deduplicated = deduplicateResults(allResults);

    logger.info(
      { rawCount: allResults.length, deduplicatedCount: deduplicated.length },
      'Batch scan complete'
    );

    return deduplicated;
  }
}

export default ChartinkScraper;
