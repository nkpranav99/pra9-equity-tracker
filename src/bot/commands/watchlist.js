import logger from '../../utils/logger.js';
import { formatWatchlist, formatError } from '../formatters.js';
import { escapeHtml } from '../../utils/error-handler.js';

/**
 * Handle the /watchlist command.
 * Supports sub-commands:
 *   /watchlist         — Show current watchlist
 *   /watchlist add SYM — Add a symbol to the watchlist
 *   /watchlist remove SYM — Remove a symbol from the watchlist
 *
 * Uses the db queries module for persistence.
 *
 * @param {import('grammy').Context} ctx
 */
export default async function watchlistCommand(ctx) {
  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  const subCommand = parts[1]?.toLowerCase();
  const symbol = parts[2]?.toUpperCase();

  // Import db lazily — it may not be initialized yet at module load time
  let db;
  try {
    db = (await import('../../db/queries.js')).default;
  } catch {
    // db module may not exist yet; handle gracefully
    db = null;
  }

  if (!db) {
    await ctx.reply(formatError('Database is not configured. Watchlist requires the DB module.'), {
      parse_mode: 'HTML',
    });
    return;
  }

  try {
    // --- ADD ---
    if (subCommand === 'add') {
      if (!symbol) {
        await ctx.reply(
          `⭐ <b>Add to Watchlist</b>\n\nUsage: <code>/watchlist add SYMBOL</code>\nExample: <code>/watchlist add RELIANCE</code>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      await db.addToWatchlist(symbol);
      await ctx.reply(
        `✅ <code>${escapeHtml(symbol)}</code> added to watchlist.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // --- REMOVE ---
    if (subCommand === 'remove' || subCommand === 'rm' || subCommand === 'delete') {
      if (!symbol) {
        await ctx.reply(
          `⭐ <b>Remove from Watchlist</b>\n\nUsage: <code>/watchlist remove SYMBOL</code>\nExample: <code>/watchlist remove RELIANCE</code>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      await db.removeFromWatchlist(symbol);
      await ctx.reply(
        `🗑 <code>${escapeHtml(symbol)}</code> removed from watchlist.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // --- VIEW (default) ---
    const items = await db.getWatchlist();
    await ctx.reply(formatWatchlist(items), { parse_mode: 'HTML' });
  } catch (error) {
    logger.error({ err: error }, 'Watchlist command failed');
    await ctx.reply(formatError(`Watchlist error: ${error.message}`), {
      parse_mode: 'HTML',
    });
  }
}
