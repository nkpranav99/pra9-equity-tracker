/**
 * Handle the /help command.
 * Shows all available commands with descriptions.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function helpCommand(ctx) {
  const message = [
    `❓ <b>Available Commands</b>`,
    `━━━━━━━━━━━━━━━━`,
    ``,
    `<b>📊 Portfolio &amp; Trading</b>`,
    `/portfolio  — View your holdings &amp; P&amp;L`,
    `/positions  — View open positions`,
    `/orders     — Today's order book`,
    ``,
    `<b>🔍 Screening &amp; Analysis</b>`,
    `/scan       — Run all Chartink screeners + indicator evaluation`,
    `/check <code>SYMBOL</code> — Run indicator check on a specific stock`,
    `  <i>Example: /check RELIANCE</i>`,
    ``,
    `<b>⭐ Watchlist</b>`,
    `/watchlist           — View your watchlist`,
    `/watchlist add <code>SYM</code>  — Add a stock to watchlist`,
    `/watchlist remove <code>SYM</code> — Remove a stock`,
    ``,
    `<b>ℹ️ General</b>`,
    `/start — Welcome message &amp; market status`,
    `/help  — This help message`,
    ``,
    `━━━━━━━━━━━━━━━━`,
    `<i>💡 The bot also sends automatic alerts when screener scans find qualifying stocks during market hours.</i>`,
  ].join('\n');

  await ctx.reply(message, { parse_mode: 'HTML' });
}
