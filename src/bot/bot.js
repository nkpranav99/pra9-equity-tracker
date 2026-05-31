import { Bot } from 'grammy';
import config from '../config.js';
import logger from '../utils/logger.js';
import { handleError } from '../utils/error-handler.js';

// Import commands
import startCommand from './commands/start.js';
import portfolioCommand from './commands/portfolio.js';
import positionsCommand from './commands/positions.js';
import ordersCommand from './commands/orders.js';
import scanCommand from './commands/scan.js';
import checkCommand from './commands/check.js';
import watchlistCommand from './commands/watchlist.js';
import helpCommand from './commands/help.js';
import loginCommand from './commands/login.js';

// Import callback handler
import callbackHandler from './callbacks/handler.js';

/**
 * Initialize and configure the grammY bot.
 *
 * @param {object} services - App services to inject into context
 * @returns {Bot} The configured grammY bot instance
 */
export function setupBot(services) {
  const bot = new Bot(config.telegram.botToken);

  // Global Error Handler
  bot.catch((err) => {
    const e = err.error || err;
    logger.error({ err: e }, 'Unhandled bot error');
    // We try to notify owner via services.notifyOwner if available
    if (services.notifyOwner) {
      handleError(e, 'Bot core', services.notifyOwner).catch(() => {});
    }
  });

  // Global Middleware: Auth check & Service injection
  bot.use(async (ctx, next) => {
    // Only allow the owner to interact with the bot
    if (ctx.from?.id !== config.telegram.ownerId) {
      logger.warn({ userId: ctx.from?.id }, 'Unauthorized access attempt');
      return;
    }

    // Inject services into context
    ctx.services = services;

    await next();
  });

  // Register commands
  bot.command('start', startCommand);
  bot.command('portfolio', portfolioCommand);
  bot.command('positions', positionsCommand);
  bot.command('orders', ordersCommand);
  bot.command('scan', scanCommand);
  bot.command('check', checkCommand);
  bot.command('watchlist', watchlistCommand);
  bot.command('help', helpCommand);
  bot.command('login', loginCommand);

  // Set up the autocomplete menu in Telegram
  bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'portfolio', description: 'View current holdings' },
    { command: 'positions', description: 'View today\'s positions' },
    { command: 'orders', description: 'View today\'s orders' },
    { command: 'scan', description: 'Run Chartink screener & indicators' },
    { command: 'check', description: 'Check a specific stock symbol' },
    { command: 'watchlist', description: 'Manage your watchlist' },
    { command: 'login', description: 'Get the manual Kite login link' },
    { command: 'help', description: 'Show all available commands' },
  ]).catch(err => logger.error({ err }, 'Failed to set Telegram commands menu'));

  // Register callback queries (inline keyboards)
  bot.on('callback_query:data', callbackHandler);

  // Handle unknown commands gracefully
  bot.on('message', async (ctx) => {
    if (ctx.message?.text?.startsWith('/')) {
      await ctx.reply('Unrecognized command. Send /help to see available commands.');
    }
  });

  return bot;
}
