import logger from '../../utils/logger.js';
import { formatStockCheck, formatError } from '../formatters.js';
import { InlineKeyboard } from 'grammy';
import { resolveSymbol } from '../../utils/symbol-resolver.js';

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

  // The bot.js regex match captures the rest of the text into ctx.message.text
  // E.g., "/check CANARA BANK"
  let query = '';
  const text = ctx.message?.text || '';
  if (text.startsWith('/check ')) {
    query = text.substring(7).trim();
  } else {
    const parts = text.trim().split(/\s+/);
    query = parts.slice(1).join(' ').trim();
  }

  if (!query) {
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

  const loadingMsg = await ctx.reply(`📈 Resolving <code>${query}</code>…`, {
    parse_mode: 'HTML',
  });

  try {
    const symbol = await resolveSymbol(query);
    
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      `📈 Checking <code>${symbol}</code>…`,
      { parse_mode: 'HTML' }
    );

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
    logger.error({ err: error, query }, 'Check command failed');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to check ${query}: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
