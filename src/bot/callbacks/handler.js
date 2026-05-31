import logger from '../../utils/logger.js';
import { escapeHtml } from '../../utils/error-handler.js';
import {
  formatPortfolio,
  formatScanResults,
  formatStockCheck,
  formatWatchlist,
  formatError,
} from '../formatters.js';
import helpCommand from '../commands/help.js';

/**
 * Register callback query handlers on the bot.
 * Handles inline keyboard button presses.
 *
 * @param {import('grammy').Bot} bot
 * @param {object} services - The shared services object { kiteClient, screener, indicatorEngine }
 */
export default function registerCallbackHandlers(bot, services) {
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    logger.info({ callback: data }, 'Callback query received');

    try {
      // --- Refresh Portfolio ---
      if (data === 'refresh_portfolio') {
        await handleRefreshPortfolio(ctx, services);
        return;
      }

      // --- Scan All ---
      if (data === 'scan_all') {
        const { executeScan } = await import('../commands/scan.js');
        await executeScan(ctx, services, 'all', ctx.callbackQuery.message.message_id);
        await ctx.answerCallbackQuery();
        return;
      }

      // --- Scan Specific Screener ---
      if (data.startsWith('scan_slug_')) {
        const slug = data.replace('scan_slug_', '');
        const { executeScan } = await import('../commands/scan.js');
        await executeScan(ctx, services, slug, ctx.callbackQuery.message.message_id);
        await ctx.answerCallbackQuery();
        return;
      }

      // --- Show Help ---
      if (data === 'show_help') {
        await helpCommand(ctx);
        await ctx.answerCallbackQuery();
        return;
      }

      // --- Watchlist Add ---
      if (data.startsWith('watchlist_add_')) {
        const symbol = data.replace('watchlist_add_', '');
        await handleWatchlistAdd(ctx, symbol);
        return;
      }

      // --- Watchlist Remove ---
      if (data.startsWith('watchlist_remove_')) {
        const symbol = data.replace('watchlist_remove_', '');
        await handleWatchlistRemove(ctx, symbol);
        return;
      }

      // --- Check Symbol ---
      if (data.startsWith('check_')) {
        const symbol = data.replace('check_', '');
        await handleCheckSymbol(ctx, services, symbol);
        return;
      }

      // Unknown callback
      await ctx.answerCallbackQuery({ text: '❓ Unknown action' });
    } catch (error) {
      logger.error({ err: error, callback: data }, 'Callback handler error');
      await ctx.answerCallbackQuery({ text: '❌ An error occurred' });
    }
  });
}

/**
 * Re-fetch and update the portfolio message.
 *
 * @param {import('grammy').Context} ctx
 * @param {object} services
 */
async function handleRefreshPortfolio(ctx, services) {
  const { kiteClient } = services;

  if (!kiteClient) {
    await ctx.answerCallbackQuery({ text: '⚠️ Kite not configured' });
    return;
  }

  await ctx.answerCallbackQuery({ text: '🔄 Refreshing…' });

  try {
    const holdings = await kiteClient.getHoldings();
    const { InlineKeyboard } = await import('grammy');
    const keyboard = new InlineKeyboard().text('🔄 Refresh', 'refresh_portfolio');

    await ctx.editMessageText(formatPortfolio(holdings), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to refresh portfolio');
    await ctx.editMessageText(formatError(`Refresh failed: ${error.message}`), {
      parse_mode: 'HTML',
    });
  }
}

// handleRefreshScan removed in favour of executeScan in scan.js
/**
 * Add a symbol to the watchlist.
 *
 * @param {import('grammy').Context} ctx
 * @param {string} symbol
 */
async function handleWatchlistAdd(ctx, symbol) {
  let db;
  try {
    db = (await import('../../db/queries.js')).default;
  } catch {
    db = null;
  }

  if (!db) {
    await ctx.answerCallbackQuery({ text: '⚠️ Database not configured' });
    return;
  }

  try {
    await db.addToWatchlist(symbol);
    await ctx.answerCallbackQuery({ text: `✅ ${symbol} added to watchlist` });
  } catch (error) {
    logger.error({ err: error, symbol }, 'Failed to add to watchlist');
    await ctx.answerCallbackQuery({ text: `❌ Failed to add ${symbol}` });
  }
}

/**
 * Remove a symbol from the watchlist.
 *
 * @param {import('grammy').Context} ctx
 * @param {string} symbol
 */
async function handleWatchlistRemove(ctx, symbol) {
  let db;
  try {
    db = (await import('../../db/queries.js')).default;
  } catch {
    db = null;
  }

  if (!db) {
    await ctx.answerCallbackQuery({ text: '⚠️ Database not configured' });
    return;
  }

  try {
    await db.removeFromWatchlist(symbol);
    await ctx.answerCallbackQuery({ text: `🗑 ${symbol} removed from watchlist` });
  } catch (error) {
    logger.error({ err: error, symbol }, 'Failed to remove from watchlist');
    await ctx.answerCallbackQuery({ text: `❌ Failed to remove ${symbol}` });
  }
}

/**
 * Run indicator check for a symbol and reply.
 *
 * @param {import('grammy').Context} ctx
 * @param {object} services
 * @param {string} symbol
 */
async function handleCheckSymbol(ctx, services, symbol) {
  const { indicatorEngine } = services;

  if (!indicatorEngine) {
    await ctx.answerCallbackQuery({ text: '⚠️ Indicator engine not configured' });
    return;
  }

  await ctx.answerCallbackQuery({ text: `📈 Checking ${symbol}…` });

  try {
    const indicatorResults = await indicatorEngine.evaluate({ symbol });
    const { InlineKeyboard } = await import('grammy');
    const keyboard = new InlineKeyboard()
      .text('⭐ Add to Watchlist', `watchlist_add_${symbol}`)
      .text('🔄 Refresh', `check_${symbol}`);

    // Reply with a new message instead of editing (callback source may not be relevant)
    await ctx.reply(formatStockCheck(symbol, indicatorResults), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error({ err: error, symbol }, 'Check callback failed');
    await ctx.reply(formatError(`Failed to check ${symbol}: ${error.message}`), {
      parse_mode: 'HTML',
    });
  }
}
