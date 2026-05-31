import { validateConfig } from './config.js';
import config from './config.js';
import logger from './utils/logger.js';
import { initializeDb, closeDb } from './db/database.js';
import { setupBot } from './bot/bot.js';
import { setupCronJobs } from './scheduler/cron.js';

import KiteClient from './kite/client.js';
import KiteAuth from './kite/auth.js';
import ChartinkScraper from './screener/chartink.js';
import IndicatorEngine from './indicator/engine.js';

import { startWebhookServer } from './server/webhook.js';

async function main() {
  try {
    // 1. Validate Config
    validateConfig();
    logger.info('Configuration validated successfully');

    // 2. Initialize Database
    initializeDb();
    logger.info('Database initialized and migrations applied');

    // 3. Initialize Services
    const kiteClient = new KiteClient();
    const kiteAuth = new KiteAuth(kiteClient, config.kite);
    const screener = new ChartinkScraper();
    const indicatorEngine = new IndicatorEngine();

    const services = {
      kiteClient,
      kiteAuth,
      screener,
      indicatorEngine,
      notifyOwner: null // Will be set after bot initialization
    };

    // 4. Initialize Telegram Bot
    const bot = setupBot(services);

    // Store notifyOwner in services for scheduled jobs
    services.notifyOwner = async (message) => {
      try {
        await bot.api.sendMessage(config.telegram.ownerId, message, { parse_mode: 'HTML' });
      } catch (err) {
        logger.error({ err }, 'Failed to send notification to owner');
      }
    };

    // 5. Setup Cron Jobs
    setupCronJobs(services);
    logger.info('Cron jobs scheduled');

    // 6. Start the Bot
    bot.start({
      onStart: (botInfo) => {
        logger.info(`🤖 Bot @${botInfo.username} started successfully`);
        services.notifyOwner(`🤖 <b>Bot Started</b>\n\nI am now online and ready to trade.`);
      }
    });

    // 7. Handle Graceful Shutdown
    const shutdown = () => {
      logger.info('Shutting down gracefully...');
      bot.stop();
      closeDb();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start application');
    process.exit(1);
  }
}

main();
