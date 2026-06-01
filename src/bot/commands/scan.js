import config from '../../config.js';
import { InlineKeyboard } from 'grammy';
import logger from '../../utils/logger.js';
import { formatScanResults, formatError } from '../formatters.js';

/**
 * Handle the /scan command.
 * If multiple screeners are configured, shows a selection menu.
 * If only one screener is configured, runs it immediately.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function scanCommand(ctx) {
  const slugs = config.chartink.screenerSlugs;

  if (!slugs || slugs.length === 0 || (slugs.length === 1 && slugs[0] === '')) {
    await ctx.reply(formatError('No screeners configured. Please add CHARTINK_SCREENER_SLUGS to your .env file.'), { parse_mode: 'HTML' });
    return;
  }

  // If only 1 screener, just run it
  if (slugs.length === 1) {
    await executeScan(ctx, ctx.services, slugs[0]);
    return;
  }

  // If multiple screeners, show a menu
  const keyboard = new InlineKeyboard();
  slugs.forEach(slug => {
    keyboard.text(`📊 ${slug}`, `scan_slug_${slug}`).row();
  });
  keyboard.text('🚀 Scan All', 'scan_all').row();

  await ctx.reply('<b>Choose a Screener to Scan:</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

/**
 * Executes the actual scan logic for a given slug (or 'all').
 * 
 * @param {import('grammy').Context} ctx 
 * @param {object} services 
 * @param {string} slug - The screener slug to scan, or 'all'
 * @param {number} [editMessageId] - Message ID to edit if called from a callback query
 */
export async function executeScan(ctx, services, slug, editMessageId = null) {
  const { screener, indicatorEngine } = services;

  if (!screener) {
    const text = formatError('Screener is not configured.');
    if (editMessageId) {
      await ctx.api.editMessageText(ctx.chat.id, editMessageId, text, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML' });
    }
    return;
  }

  const loadingText = `🔍 Scanning ${slug === 'all' ? 'All Screeners' : slug}… This may take a moment.`;
  let loadingMsg;

  if (editMessageId) {
    loadingMsg = { chat: { id: ctx.chat.id }, message_id: editMessageId };
    await ctx.api.editMessageText(ctx.chat.id, editMessageId, loadingText, { parse_mode: 'HTML' });
  } else {
    loadingMsg = await ctx.reply(loadingText, { parse_mode: 'HTML' });
  }

  try {
    // 1. Run the scans concurrently
    let scanResults = [];
    
    // Create promises for both scanners
    const chartinkPromise = slug === 'all' ? screener.scanAll() : screener.scanScreener(slug);
    
    // Only run market depth if we are scanning all, to avoid doing discovery on narrow scans unless requested
    const depthPromise = (slug === 'all' && services.marketDepthScreener) 
      ? services.marketDepthScreener.scan() 
      : Promise.resolve([]);

    const [chartinkOutcome, depthOutcome] = await Promise.allSettled([chartinkPromise, depthPromise]);

    if (chartinkOutcome.status === 'fulfilled' && chartinkOutcome.value) {
      chartinkOutcome.value.forEach(stock => {
        stock.source = 'chartink';
        scanResults.push(stock);
      });
    } else {
      logger.error({ err: chartinkOutcome.reason }, 'Chartink scan failed');
    }

    if (depthOutcome.status === 'fulfilled' && depthOutcome.value) {
      depthOutcome.value.forEach(stock => {
        // Only add if not already found by Chartink
        if (!scanResults.some(s => s.symbol === stock.symbol)) {
          stock.source = 'discovery';
          scanResults.push(stock);
        }
      });
    } else {
      logger.error({ err: depthOutcome.reason }, 'Market Depth scan failed');
    }

    if (!scanResults || scanResults.length === 0) {
      await ctx.api.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        `🔍 <b>Scan Complete: ${slug}</b>\n━━━━━━━━━━━━━━━━\n<i>No stocks matched the screener criteria.</i>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const totalScanned = scanResults.length;

    // Determine dynamic limits
    const evalLimit = slug === 'all' ? 50 : 30;
    const displayLimit = slug === 'all' ? 25 : 10;
    const maxQualifiedLimit = slug === 'all' ? 10 : 5;

    // Sort by momentum (changePercent) and cap before evaluation to save API calls
    scanResults.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
    scanResults = scanResults.slice(0, evalLimit);

    // 2. Evaluate indicators for each result
    let enrichedResults = [];
    for (const stock of scanResults) {
      let indicatorResults = null;
      if (indicatorEngine) {
        try {
          indicatorResults = await indicatorEngine.evaluate(stock);
        } catch (err) {
          logger.warn({ err, symbol: stock.symbol }, 'Indicator evaluation failed for stock');
        }
      }
      enrichedResults.push({ ...stock, indicatorResults });
    }

    // Sort enriched results by confidence score descending
    enrichedResults.sort((a, b) => {
      const scoreA = a.indicatorResults?.score || 0;
      const scoreB = b.indicatorResults?.score || 0;
      // If scores are equal, fallback to momentum
      if (scoreB === scoreA) {
        return (b.changePercent || 0) - (a.changePercent || 0);
      }
      return scoreB - scoreA;
    });

    // 3. Apply custom limits for qualified vs partial
    let qualifying = enrichedResults.filter((r) => r.indicatorResults?.passed);
    let partial = enrichedResults.filter((r) => !r.indicatorResults?.passed);

    qualifying = qualifying.slice(0, maxQualifiedLimit);
    const remainingSlots = displayLimit - qualifying.length;
    partial = partial.slice(0, remainingSlots);

    // Recombine for UI
    enrichedResults = [...qualifying, ...partial];

    // 4. Build inline keyboard with check buttons
    const keyboard = new InlineKeyboard();

    if (qualifying.length > 0) {
      // Add buttons for qualifying stocks
      qualifying.slice(0, 5).forEach((s) => {
        keyboard.text(`🔍 ${s.symbol}`, `check_${s.symbol}`);
      });
      keyboard.row();
    } else if (partial.length > 0) {
      // FALLBACK: If NO stocks pass indicators, give buttons for the Top 5 partial matches (sorted by daily change %)
      partial.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
      partial.slice(0, 5).forEach((s) => {
        keyboard.text(`🔍 ${s.symbol} (Fallback)`, `check_${s.symbol}`);
      });
      keyboard.row();
    }
    
    // Add rescan button for this specific slug
    keyboard.text('🔄 Rescan', `scan_slug_${slug}`);

    // 4. Format and send
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatScanResults(enrichedResults, { totalScanned }),
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    logger.error({ err: error }, 'Scan execution failed');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Scan failed: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
