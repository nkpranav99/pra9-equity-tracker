import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { retry } from '../utils/error-handler.js';
import { getUniverseCache, setUniverseCache } from '../db/queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_FILE = path.join(__dirname, '..', 'data', 'nse-universe.json');

/**
 * Market Depth Scanner
 * Fetches data directly from NSE indices (Midcap 150 & Smallcap 250)
 * Applies lightweight pre-filtering before sending to indicator engine.
 */
class MarketDepthScreener {
  constructor() {
    this._cookies = [];
    
    this.http = axios.create({
      baseURL: 'https://www.nseindia.com',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
      },
      withCredentials: true,
    });

    this.http.interceptors.response.use((response) => {
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        this._mergeCookies(setCookies);
      }
      return response;
    });

    this.http.interceptors.request.use((reqConfig) => {
      if (this._cookies.length > 0) {
        reqConfig.headers.Cookie = this._cookies.map(c => c.split(';')[0]).join('; ');
      }
      return reqConfig;
    });
  }

  _mergeCookies(incoming) {
    const cookieMap = new Map();
    for (const c of this._cookies) cookieMap.set(c.split('=')[0].trim(), c);
    for (const c of incoming) cookieMap.set(c.split('=')[0].trim(), c);
    this._cookies = Array.from(cookieMap.values());
  }

  /**
   * Prime cookies by visiting the homepage
   */
  async _primeCookies() {
    try {
      await this.http.get('/');
      logger.debug('NSE cookies primed successfully');
    } catch (err) {
      logger.debug('Failed to prime NSE cookies (might still work)');
    }
  }

  /**
   * Fetch stocks for a given NSE index
   * @param {string} indexName 
   */
  async _fetchIndex(indexName) {
    // Check DB cache first
    const cached = getUniverseCache(indexName);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      logger.info({ indexName, count: cached.length }, 'Loaded index from DB cache');
      return cached;
    }

    try {
      if (this._cookies.length === 0) {
        await this._primeCookies();
      }

      const response = await retry(
        () => this.http.get(`/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`),
        { maxAttempts: 3, delayMs: 2000 }
      );

      const data = response.data?.data || [];
      // Filter out the index itself (usually the first item has no symbol or matches index name)
      const stocks = data.filter(s => s.symbol !== indexName && s.symbol !== 'NIFTY MIDCAP 150' && s.symbol !== 'NIFTY SMALLCAP 250');
      
      if (stocks.length > 0) {
        // Only cache the minimum required fields to save DB space
        const mapped = stocks.map(s => ({
          symbol: s.symbol,
          lastPrice: s.lastPrice,
          change: s.change,
          pChange: s.pChange,
          previousClose: s.previousClose,
          totalTradedVolume: s.totalTradedVolume,
          yearHigh: s.yearHigh
        }));
        setUniverseCache(indexName, mapped);
        logger.info({ indexName, count: mapped.length }, 'Fetched and cached index from NSE API');
        return mapped;
      }
      throw new Error('NSE API returned empty data array');
    } catch (err) {
      logger.warn({ indexName, err: err.message }, 'Failed to fetch index from NSE API');
      throw err;
    }
  }

  /**
   * Load fallback data from static JSON
   */
  _loadFallback() {
    try {
      if (fs.existsSync(FALLBACK_FILE)) {
        const raw = fs.readFileSync(FALLBACK_FILE, 'utf8');
        const data = JSON.parse(raw);
        logger.info({ count: data.length }, 'Loaded universe from static fallback JSON');
        
        // Since static JSON might not have live prices, return minimal stub objects
        // We will just bypass pre-filter for these since they lack live data
        return data.map(symbol => ({
          symbol,
          lastPrice: 999,
          totalTradedVolume: 999999, // pass liquidity check
          previousClose: 100, // stub
          yearHigh: 1000, // stub
          pChange: 3.0 // force pass pre-filter
        }));
      }
      logger.warn('Fallback JSON file not found');
      return [];
    } catch (err) {
      logger.error({ err }, 'Failed to load fallback JSON');
      return [];
    }
  }

  /**
   * Scan the combined Midcap and Smallcap universe
   * @returns {Promise<Array<{symbol: string}>>} Array of symbols passing pre-filter
   */
  async scan() {
    let midcap = [];
    let smallcap = [];
    
    try {
      midcap = await this._fetchIndex('NIFTY MIDCAP 150');
      // small delay to prevent rate limit
      await new Promise(r => setTimeout(r, 1000));
      smallcap = await this._fetchIndex('NIFTY SMALLCAP 250');
    } catch (err) {
      logger.warn('NSE API blocked or failed, falling back to static universe JSON');
      const fallbackData = this._loadFallback();
      midcap = fallbackData; // Just assign all to midcap to pass through
    }

    const allStocks = [...midcap, ...smallcap];
    
    // Deduplicate just in case
    const uniqueMap = new Map();
    for (const s of allStocks) {
      if (s.symbol && !uniqueMap.has(s.symbol)) {
        uniqueMap.set(s.symbol, s);
      }
    }
    const universe = Array.from(uniqueMap.values());

    if (universe.length === 0) {
      return [];
    }

    // Apply pre-filter logic
    const candidates = [];
    
    for (const stock of universe) {
      // 1. Hard Exclusions (before scoring)
      if (stock.totalTradedVolume < 50000) continue; // Illiquid
      if (stock.lastPrice < 20) continue; // Penny stock
      
      // 2. Pre-filter Conditions (Needs ANY TWO)
      let passCount = 0;
      
      // Cond 1: Momentum (pChange > 2%)
      if (stock.pChange > 2.0) {
        passCount++;
      }
      
      // Cond 2: Volume/Price confirmation (Up and trading, not gap trap)
      if (stock.totalTradedVolume > 0 && stock.lastPrice > (stock.previousClose * 1.005)) {
        passCount++;
      }
      
      // Cond 3: Structure (Within 15% of 52W High)
      if (stock.lastPrice >= (stock.yearHigh * 0.85)) {
        passCount++;
      }
      
      if (passCount >= 2) {
        // Return object structure matches Chartink output: { symbol: 'RELIANCE', changePercent: ... }
        candidates.push({
          symbol: stock.symbol,
          price: stock.lastPrice,
          changePercent: stock.pChange,
          volume: stock.totalTradedVolume
        });
      }
    }

    logger.info({ 
      total: universe.length, 
      passed: candidates.length 
    }, 'Market Depth Scan Pre-filter complete');

    // Safety net: if fewer than 20 survive, bypass filter and return the whole universe
    if (candidates.length < 20) {
      logger.warn('Fewer than 20 candidates passed pre-filter. Bypassing filter (safety net).');
      return universe.map(s => ({
        symbol: s.symbol,
        price: s.lastPrice,
        changePercent: s.pChange,
        volume: s.totalTradedVolume
      }));
    }

    return candidates;
  }
}

export default MarketDepthScreener;
