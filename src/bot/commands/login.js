import logger from '../../utils/logger.js';

/**
 * Handle the /login command.
 * Provides the manual login URL for Kite Connect.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function loginCommand(ctx) {
  try {
    const { kiteAuth } = ctx.services;
    
    if (!kiteAuth) {
      await ctx.reply('⚠️ Kite Authentication service is not configured.');
      return;
    }

    const loginUrl = kiteAuth.getLoginUrl();
    
    const message = [
      `🔐 <b>Kite Manual Login</b>`,
      ``,
      `Please log into Zerodha using the link below:`,
      `${loginUrl}`,
      ``,
      `After logging in, you will be automatically redirected to your secure bot server and authenticated. You can then close your browser tab!`
    ].join('\n');

    await ctx.reply(message, { parse_mode: 'HTML', disable_web_page_preview: true });
    logger.info({ userId: ctx.from.id }, '/login command executed');
  } catch (err) {
    logger.error({ err }, 'Error in /login command');
    await ctx.reply('❌ Failed to generate login URL.');
  }
}
