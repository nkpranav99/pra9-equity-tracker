import logger from '../../utils/logger.js';

/**
 * Handle the /auth command.
 * Exchanges the request token for a Kite access token.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function authCommand(ctx) {
  try {
    const { kiteClient } = ctx.services;
    
    if (!kiteClient) {
      await ctx.reply('⚠️ Kite Client service is not configured.');
      return;
    }

    const match = ctx.message.text.match(/^\/auth\s+(.+)$/i);
    
    if (!match || !match[1]) {
      await ctx.reply('⚠️ Please provide the request token.\nUsage: <code>/auth YOUR_REQUEST_TOKEN</code>', { parse_mode: 'HTML' });
      return;
    }

    const requestToken = match[1].trim();

    await ctx.reply('🔄 Authenticating...');

    try {
      await kiteClient.generateSession(requestToken);
      logger.info({ userId: ctx.from.id }, 'Manual Kite authentication successful');
      await ctx.reply('✅ <b>Authentication Successful!</b>\n\nI am now connected to Kite Connect for the day. You can use /portfolio or /scan.', { parse_mode: 'HTML' });
    } catch (apiErr) {
      logger.error({ err: apiErr }, 'Kite authentication failed via /auth');
      await ctx.reply(`❌ <b>Authentication Failed</b>\n\n<code>${apiErr.message}</code>\n\nThe token might be expired or invalid. Try running /login again.`, { parse_mode: 'HTML' });
    }

  } catch (err) {
    logger.error({ err }, 'Error in /auth command');
    await ctx.reply('❌ An unexpected error occurred while authenticating.');
  }
}
