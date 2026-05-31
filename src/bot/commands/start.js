import { isMarketOpen } from '../../utils/market-hours.js';
import { formatMarketStatus } from '../formatters.js';
import { InlineKeyboard } from 'grammy';

/**
 * Handle the /start command.
 * Shows welcome message with bot description, market status, and quick actions.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function startCommand(ctx) {
  const marketStatus = formatMarketStatus();

  const keyboard = new InlineKeyboard()
    .text('📊 Portfolio', 'refresh_portfolio')
    .text('🔍 Scan', 'refresh_scan')
    .text('❓ Help', 'show_help');

  const message = [
    `🤖 <b>Equity Trading Bot</b>`,
    `━━━━━━━━━━━━━━━━`,
    ``,
    `Your personal Indian equity trading assistant.`,
    `I monitor Chartink screeners, evaluate technical indicators,`,
    `and manage your Kite Connect portfolio — all from Telegram.`,
    ``,
    marketStatus,
    ``,
    `<b>Quick Commands</b>`,
    `/portfolio — View holdings`,
    `/positions — Open positions`,
    `/orders    — Today's orders`,
    `/scan      — Run screener scan`,
    `/check     — Check a stock`,
    `/watchlist  — Manage watchlist`,
    `/help      — All commands`,
  ].join('\n');

  await ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}
