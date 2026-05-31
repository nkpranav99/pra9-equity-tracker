import 'dotenv/config';

const config = {
  // --- Telegram ---
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    ownerId: Number(process.env.TELEGRAM_OWNER_ID),
  },

  // --- Kite Connect ---
  kite: {
    apiKey: process.env.KITE_API_KEY,
    apiSecret: process.env.KITE_API_SECRET,
  },

  // --- Webhook ---
  domain: process.env.BOT_DOMAIN,

  // --- Chartink ---
  chartink: {
    baseUrl: 'https://chartink.com',
    processUrl: 'https://chartink.com/screener/process',
    screenerSlugs: (process.env.CHARTINK_SCREENER_SLUGS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Delay between screener requests (ms) to avoid rate limiting
    requestDelayMs: 2000,
  },

  // --- Market Hours (IST) ---
  market: {
    openHour: Number(process.env.MARKET_OPEN_HOUR || 9),
    openMinute: Number(process.env.MARKET_OPEN_MINUTE || 15),
    closeHour: Number(process.env.MARKET_CLOSE_HOUR || 15),
    closeMinute: Number(process.env.MARKET_CLOSE_MINUTE || 30),
    timezone: 'Asia/Kolkata',
  },

  // --- Scan Settings ---
  scan: {
    intervalMinutes: Number(process.env.SCAN_INTERVAL_MINUTES || 15),
  },

  // --- Database ---
  db: {
    path: process.env.DB_PATH || './data/equity-bot.db',
  },

  // --- Logging ---
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

/**
 * Validate that all required environment variables are set.
 * Throws with a clear message if anything critical is missing.
 */
export function validateConfig() {
  const required = [
    ['TELEGRAM_BOT_TOKEN', config.telegram.botToken],
    ['TELEGRAM_OWNER_ID', config.telegram.ownerId],
    ['KITE_API_KEY', config.kite.apiKey],
    ['KITE_API_SECRET', config.kite.apiSecret],
  ];

  // BOT_DOMAIN is optional, but print a warning if missing
  if (!config.domain) {
    console.warn('⚠️ BOT_DOMAIN not set. Seamless webhook login via HTTPS will be disabled.');
  }

  const missing = required.filter(([, val]) => !val);
  if (missing.length > 0) {
    const names = missing.map(([name]) => name).join(', ');
    throw new Error(`Missing required environment variables: ${names}. See .env.example`);
  }
}

export default config;
