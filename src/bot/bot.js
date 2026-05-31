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
import summaryCommand from './commands/summary.js';
import scanPortfolioCommand from './commands/scan_portfolio.js';

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
  bot.command('summary', summaryCommand);
  bot.command('scan_portfolio', scanPortfolioCommand);

  // Set up the autocomplete menu in Telegram
  bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'portfolio', description: 'View current holdings' },
    { command: 'positions', description: 'View today\'s positions' },
    { command: 'orders', description: 'View today\'s orders' },
    { command: 'scan', description: 'Run Chartink screener & indicators' },
    { command: 'scan_portfolio', description: 'Run indicators on all holdings' },
    { command: 'summary', description: 'Get an instant portfolio/P&L summary' },
    { command: 'check', description: 'Check a specific stock symbol' },
    { command: 'watchlist', description: 'Manage your watchlist' },
    { command: 'login', description: 'Get the manual Kite login link' },
    { command: 'help', description: 'Show all available commands' },
  ]).catch(err => logger.error({ err }, 'Failed to set Telegram commands menu'));

  // Register callback queries (inline keyboards)
  callbackHandler(bot, services);

  // Handle plain text natural language commands
  bot.on('message', async (ctx) => {
    const text = ctx.message?.text?.trim()?.toLowerCase();
    if (!text) return;

    if (text.startsWith('/')) {
      await ctx.reply('Unrecognized command. Send /help to see available commands.');
      return;
    }

    if (text === 'hi' || text === 'hello') {
      await ctx.reply('Hello there! 👋 I am running and ready. Send /help to see what I can do!');
      return;
    }

    // -- NLP Intent Matchers --
    
    // Watchlist: Add
    let match = text.match(/(?:add|put|keep)\s+([a-z0-9_-]+)(?:\s+to\s+(?:my\s+)?watchlist)?/);
    if (match) {
      ctx.message.text = `/watchlist add ${match[1].toUpperCase()}`;
      return watchlistCommand(ctx);
    }

    // Watchlist: Remove
    match = text.match(/(?:remove|delete|rm)\s+([a-z0-9_-]+)(?:\s+from\s+(?:my\s+)?watchlist)?/);
    if (match) {
      ctx.message.text = `/watchlist remove ${match[1].toUpperCase()}`;
      return watchlistCommand(ctx);
    }

    // Check / Analyze
    match = text.match(/(?:check|analyze|eval|evaluate)\s+([a-z0-9_-]+)/);
    if (match) {
      ctx.message.text = `/check ${match[1].toUpperCase()}`;
      return checkCommand(ctx);
    }

    // Scan Portfolio
    if (text.includes('scan portfolio') || text.includes('scan my portfolio')) {
      return scanPortfolioCommand(ctx);
    }

    // General Scan
    if (text === 'scan' || text.includes('run scan')) {
      return scanCommand(ctx);
    }

    // Summary
    if (text.includes('summary') || text.includes('eod') || text.includes('pnl')) {
      return summaryCommand(ctx);
    }

    // Portfolio
    if (text.includes('portfolio') || text.includes('holdings')) {
      return portfolioCommand(ctx);
    }

    // Login / Authenticate
    if (text.includes('login') || text.includes('auth') || text.includes('connect kite') || text.includes('zerodha')) {
      return loginCommand(ctx);
    }

    // Positions
    if (text.includes('positions')) {
      return positionsCommand(ctx);
    }

    // Orders
    if (text.includes('orders')) {
      return ordersCommand(ctx);
    }

    // Fallback
    await ctx.reply('I am not sure what you mean. Try using commands from the menu or type /help.');
  });

  return bot;
}
