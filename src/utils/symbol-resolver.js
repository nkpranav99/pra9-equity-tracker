import axios from 'axios';
import logger from './logger.js';

/**
 * Tries to resolve a fuzzy company name or partial symbol into an exact NSE symbol
 * using the Yahoo Finance autocomplete API.
 *
 * @param {string} query - The search query (e.g., "CANARA BANK")
 * @returns {Promise<string>} - The resolved NSE symbol (e.g., "CANBK") or the original query if not found
 */
export async function resolveSymbol(query) {
  if (!query || typeof query !== 'string') return query;

  const cleanQuery = query.trim().toUpperCase();
  
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanQuery)}&quotesCount=5&newsCount=0`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 5000,
    });

    const quotes = response.data?.quotes || [];
    
    // Look for the first NSE equity quote
    const nseQuote = quotes.find(q => 
      q.quoteType === 'EQUITY' && 
      (q.exchange === 'NSI' || q.exchDisp === 'NSE' || (q.symbol && q.symbol.endsWith('.NS')))
    );

    if (nseQuote && nseQuote.symbol) {
      // Return symbol without the .NS suffix
      const resolved = nseQuote.symbol.replace(/\.NS$/, '');
      logger.debug({ query, resolved }, 'Symbol resolved via Yahoo Finance');
      return resolved;
    }
  } catch (err) {
    logger.warn({ err: err.message, query }, 'Symbol resolution failed, falling back to original query');
  }

  // Fallback to original query
  return cleanQuery;
}
