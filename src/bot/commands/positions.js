import logger from '../../utils/logger.js';
import { formatPositions, formatError } from '../formatters.js';
import { InlineKeyboard } from 'grammy';

/**
 * Handle the /positions command.
 * Fetches open positions from Kite Connect and displays them.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function positionsCommand(ctx) {
  const { kiteClient } = ctx.services;

  if (!kiteClient) {
    await ctx.reply(formatError('Kite Connect is not configured. Set your API credentials in .env to use position tracking.'), {
      parse_mode: 'HTML',
    });
    return;
  }

  const loadingMsg = await ctx.reply('⏳ Fetching positions…', {
    parse_mode: 'HTML',
  });

  try {
    const positionsData = await kiteClient.getPositions();
    // Kite returns { net: [...], day: [...] } — we show net positions
    const netPositions = positionsData?.net || positionsData || [];

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatPositions(netPositions),
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch positions');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to fetch positions: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
