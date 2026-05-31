import logger from '../../utils/logger.js';
import { formatOrders, formatError } from '../formatters.js';

/**
 * Handle the /orders command.
 * Fetches today's orders from Kite Connect and displays them.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function ordersCommand(ctx) {
  const { kiteClient } = ctx.services;

  if (!kiteClient) {
    await ctx.reply(formatError('Kite Connect is not configured. Set your API credentials in .env to view orders.'), {
      parse_mode: 'HTML',
    });
    return;
  }

  const loadingMsg = await ctx.reply('⏳ Fetching orders…', {
    parse_mode: 'HTML',
  });

  try {
    const orders = await kiteClient.getOrders();

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatOrders(orders),
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch orders');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to fetch orders: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
