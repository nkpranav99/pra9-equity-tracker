import logger from '../../utils/logger.js';
import { formatScanResults, formatError } from '../formatters.js';
import { InlineKeyboard } from 'grammy';

/**
 * Handle the /scan command.
 * Triggers a manual screener scan, evaluates indicators for each result,
 * and sends formatted results grouped by qualifying vs partial matches.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function scanCommand(ctx) {
  const { screener, indicatorEngine } = ctx.services;

  if (!screener) {
    await ctx.reply(formatError('Screener is not configured. Ensure Chartink screener slugs are set in .env.'), {
      parse_mode: 'HTML',
    });
    return;
  }

  const loadingMsg = await ctx.reply('🔍 Scanning… This may take a moment.', {
    parse_mode: 'HTML',
  });

  try {
    // 1. Run all screener scans
    const scanResults = await screener.scanAll();

    if (!scanResults || scanResults.length === 0) {
      await ctx.api.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        '🔍 <b>Scan Complete</b>\n━━━━━━━━━━━━━━━━\n<i>No stocks matched any screener criteria.</i>',
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
      enrichedResults.push({
        ...stock,
        indicatorResults,
      });
    }

    // 3. Build inline keyboard with check buttons for qualifying stocks
    const qualifying = enrichedResults.filter((r) => r.indicatorResults?.passed);
    const keyboard = new InlineKeyboard();

    if (qualifying.length > 0) {
      // Add check buttons for first 5 qualifying stocks (Telegram button limit)
      qualifying.slice(0, 5).forEach((s) => {
        keyboard.text(`🔍 ${s.symbol}`, `check_${s.symbol}`);
      });
      keyboard.row();
    }
    keyboard.text('🔄 Rescan', 'refresh_scan');

    // 4. Format and send
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatScanResults(enrichedResults),
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error) {
    logger.error({ err: error }, 'Scan command failed');
    await ctx.api.editMessageText(
      loadingMsg.chat.id,
      loadingMsg.message_id,
      formatError(`Scan failed: ${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
}
