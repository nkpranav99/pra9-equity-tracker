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
    // 1. Run the scan
    let scanResults;
    if (slug === 'all') {
      scanResults = await screener.scanAll();
    } else {
      scanResults = await screener.scanScreener(slug);
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

    // 2. Evaluate indicators for each result
    const enrichedResults = [];
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

    // 3. Build inline keyboard with check buttons
    const qualifying = enrichedResults.filter((r) => r.indicatorResults?.passed);
    const partial = enrichedResults.filter((r) => !r.indicatorResults?.passed);
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
      formatScanResults(enrichedResults),
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
