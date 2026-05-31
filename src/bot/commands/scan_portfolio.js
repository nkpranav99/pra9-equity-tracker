import logger from '../../utils/logger.js';
import { formatScanResults, formatError } from '../formatters.js';

export default async function scanPortfolioCommand(ctx) {
  const { kiteClient, indicatorEngine } = ctx.services;

  if (!kiteClient || !kiteClient.isAuthenticated) {
    await ctx.reply(formatError('Kite Connect is not configured. Cannot scan portfolio.'), { parse_mode: 'HTML' });
    return;
  }

  if (!indicatorEngine) {
    await ctx.reply(formatError('Indicator engine is not running.'), { parse_mode: 'HTML' });
    return;
  }

  const loadingMsg = await ctx.reply('🔍 Scanning your portfolio...', { parse_mode: 'HTML' });

  try {
    const holdings = await kiteClient.getHoldings();
    if (!holdings || holdings.length === 0) {
      await ctx.api.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        `🔍 <b>Portfolio Scan</b>\n━━━━━━━━━━━━━━━━\n<i>No holdings found in portfolio.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    let enrichedResults = [];
    for (const holding of holdings) {
      try {
        const indicatorResults = await indicatorEngine.evaluate(holding.tradingsymbol);
        enrichedResults.push({
          symbol: holding.tradingsymbol,
          price: holding.last_price,
          changePercent: holding.day_change_percentage,
          indicatorResults
        });
      } catch (err) {
        logger.warn({ err, symbol: holding.tradingsymbol }, 'Indicator evaluation failed for portfolio stock');
      }
    }

    // Sort by confidence score descending
    enrichedResults.sort((a, b) => {
      const scoreA = a.indicatorResults?.score || 0;
      const scoreB = b.indicatorResults?.score || 0;
      if (scoreB === scoreA) {
        return (b.changePercent || 0) - (a.changePercent || 0);
      }
      return scoreB - scoreA;
    });

    const totalScanned = holdings.length;

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatScanResults(enrichedResults, { totalScanned }),
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to scan portfolio');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Failed to scan portfolio: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
