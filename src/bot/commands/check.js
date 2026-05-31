import logger from '../../utils/logger.js';
import { formatStockCheck, formatError } from '../formatters.js';
import { InlineKeyboard } from 'grammy';

/**
 * Handle the /check command.
 * Takes a symbol argument, fetches data, runs indicator engine,
 * and shows a detailed indicator breakdown.
 *
 * Usage: /check RELIANCE
 *
 * @param {import('grammy').Context} ctx
 */
export default async function checkCommand(ctx) {
  const { indicatorEngine } = ctx.services;

  // Parse symbol from message text
  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  const symbol = parts[1]?.toUpperCase();

  if (!symbol) {
    await ctx.reply(
      `📈 <b>Check Stock Indicators</b>\n\nUsage: <code>/check SYMBOL</code>\nExample: <code>/check RELIANCE</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (!indicatorEngine) {
    await ctx.reply(formatError('Indicator engine is not configured.'), {
      parse_mode: 'HTML',
    });
    return;
  }

  const loadingMsg = await ctx.reply(`📈 Checking <code>${symbol}</code>…`, {
    parse_mode: 'HTML',
  });

  try {
    const indicatorResults = await indicatorEngine.evaluate({ symbol });

    const keyboard = new InlineKeyboard()
      .text('⭐ Add to Watchlist', `watchlist_add_${symbol}`)
      .text('🔄 Refresh', `check_${symbol}`);

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatStockCheck(symbol, indicatorResults),
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    logger.error({ err: error, symbol }, 'Check command failed');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to check ${symbol}: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
