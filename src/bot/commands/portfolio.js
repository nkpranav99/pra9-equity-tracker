import logger from '../../utils/logger.js';
import { formatPortfolio, formatError } from '../formatters.js';
import { InlineKeyboard } from 'grammy';

/**
 * Handle the /portfolio command.
 * Fetches holdings from Kite Connect and displays a formatted portfolio view.
 * Shows a loading indicator while fetching.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function portfolioCommand(ctx) {
  const { kiteClient } = ctx.services;

  if (!kiteClient) {
    await ctx.reply(formatError('Kite Connect is not configured. Set your API credentials in .env to use portfolio features.'), {
      parse_mode: 'HTML',
    });
    return;
  }

  // Send loading message
  const loadingMsg = await ctx.reply('⏳ Fetching portfolio…', {
    parse_mode: 'HTML',
  });

  try {
    const holdings = await kiteClient.getHoldings();

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', 'refresh_portfolio');

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatPortfolio(holdings),
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch portfolio');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to fetch portfolio: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
