import logger from '../../utils/logger.js';
import { formatError } from '../formatters.js';

export default async function summaryCommand(ctx) {
  const { kiteClient, indicatorEngine } = ctx.services;

  if (!kiteClient || !kiteClient.isAuthenticated) {
    await ctx.reply(formatError('Kite Connect is not configured or authenticated. Cannot generate summary.'), { parse_mode: 'HTML' });
    return;
  }

  const loadingMsg = await ctx.reply('⏳ Generating summary...', { parse_mode: 'HTML' });

  try {
    let positionsSection = '';
    let ordersSection = '';
    let portfolioActionSection = '';

    try {
      const positions = await kiteClient.getPositions();
      const dayPositions = positions?.net || [];
      const dayPnl = dayPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
      const emoji = dayPnl >= 0 ? '🟢' : '🔴';

      positionsSection =
        `<b>Day P&amp;L:</b> ${dayPnl >= 0 ? '+' : ''}₹${dayPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${emoji}\n` +
        `<b>Active Positions:</b> ${dayPositions.filter((p) => p.quantity !== 0).length}\n`;
    } catch {
      positionsSection = '<i>⚠️ Could not fetch positions</i>\n';
    }

    try {
      const orders = await kiteClient.getOrders();
      const completed = orders?.filter((o) => o.status === 'COMPLETE') || [];
      const rejected = orders?.filter((o) => o.status === 'REJECTED') || [];
      ordersSection =
        `<b>Orders:</b> ${completed.length} completed, ${rejected.length} rejected\n`;
    } catch {
      ordersSection = '';
    }

    try {
      const holdings = await kiteClient.getHoldings();
      let actionableStocks = [];
      if (indicatorEngine && holdings.length > 0) {
        for (const holding of holdings) {
          try {
            const result = await indicatorEngine.evaluate(holding.tradingsymbol);
            if (result.passed || result.score >= 80) {
               actionableStocks.push(`${holding.tradingsymbol} (${result.score}/100)`);
            }
          } catch (err) {}
        }
        if (actionableStocks.length > 0) {
           portfolioActionSection = `\n<b>👀 Actionable Portfolio Stocks:</b>\n${actionableStocks.join(', ')}\n`;
        } else {
           portfolioActionSection = `\n<b>👀 Actionable Portfolio Stocks:</b>\n<i>None currently exhibiting strong momentum.</i>\n`;
        }
      }
    } catch (err) {}

    const message =
      `📋 <b>On-Demand Summary</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${positionsSection}` +
      `${ordersSection}` +
      `${portfolioActionSection}`;

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      message,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to generate summary');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to generate summary: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
