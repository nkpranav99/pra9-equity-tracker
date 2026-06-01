import { InlineKeyboard } from 'grammy';
import logger from '../../utils/logger.js';
import { formatScanResults, formatError } from '../formatters.js';

/**
 * Handle the /discover command.
 * Runs only the market depth scanner directly without Chartink.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function discoverCommand(ctx) {
  const { marketDepthScreener, indicatorEngine } = ctx.services;

  if (!marketDepthScreener) {
    await ctx.reply(formatError('Market depth scanner is not configured.'), { parse_mode: 'HTML' });
    return;
  }

  const loadingMsg = await ctx.reply('🔭 <b>Starting Discovery Scan</b>\nScanning NIFTY Midcap 150 & Smallcap 250...', { parse_mode: 'HTML' });

  try {
    const scanResults = await marketDepthScreener.scan();

    if (!scanResults || scanResults.length === 0) {
      await ctx.api.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        `🔭 <b>Discovery Scan Complete</b>\n━━━━━━━━━━━━━━━━\n<i>No stocks passed the pre-filter criteria.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const totalScanned = scanResults.length; // Actually pre-filtered passed count

    // Cap at 30 to avoid API rate limits when evaluating indicators
    scanResults.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
    const evalCandidates = scanResults.slice(0, 30);

    // Evaluate indicators for each result
    let enrichedResults = [];
    for (const stock of evalCandidates) {
      let indicatorResults = null;
      if (indicatorEngine) {
        try {
          indicatorResults = await indicatorEngine.evaluate(stock.symbol);
        } catch (err) {
          logger.warn({ err, symbol: stock.symbol }, 'Indicator evaluation failed for stock');
        }
      }
      stock.source = 'discovery';
      enrichedResults.push({ ...stock, indicatorResults });
    }

    // Sort enriched results by confidence score descending
    enrichedResults.sort((a, b) => {
      const scoreA = a.indicatorResults?.score || 0;
      const scoreB = b.indicatorResults?.score || 0;
      if (scoreB === scoreA) {
        return (b.changePercent || 0) - (a.changePercent || 0);
      }
      return scoreB - scoreA;
    });

    // Take top 10 qualifying and up to 5 partial
    let qualifying = enrichedResults.filter((r) => r.indicatorResults?.passed);
    let partial = enrichedResults.filter((r) => !r.indicatorResults?.passed);

    qualifying = qualifying.slice(0, 10);
    partial = partial.slice(0, Math.max(0, 15 - qualifying.length));

    // Recombine for UI
    enrichedResults = [...qualifying, ...partial];

    // Build inline keyboard with check buttons
    const keyboard = new InlineKeyboard();

    if (qualifying.length > 0) {
      qualifying.slice(0, 5).forEach((s) => {
        keyboard.text(`🔍 ${s.symbol}`, `check_${s.symbol}`);
      });
      keyboard.row();
    } else if (partial.length > 0) {
      partial.slice(0, 5).forEach((s) => {
        keyboard.text(`🔍 ${s.symbol} (Fallback)`, `check_${s.symbol}`);
      });
      keyboard.row();
    }
    
    keyboard.text('🔄 Rescan Discovery', `scan_discover`);

    // Override the header title via the formatter options (we need to inject custom header text)
    // Actually, formatScanResults takes { totalScanned } and builds its own header.
    // Let's just pass custom text into the formatter by modifying it later.

    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatScanResults(enrichedResults, { 
        totalScanned, 
        title: '🔭 Market Discovery Scan',
        subtitle: 'MIDCAP + SMALLCAP universe'
      }),
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    logger.error({ err: error }, 'Discovery scan failed');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Discovery failed: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
