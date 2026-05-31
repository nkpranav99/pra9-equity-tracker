import cron from 'node-cron';
import config from '../config.js';
import logger from '../utils/logger.js';
import { isTradingDay, isMarketOpen, getNowIST } from '../utils/market-hours.js';

/**
 * Set up all cron jobs for the equity bot.
 *
 * @param {object} services - Service instances
 * @param {object} services.screener - ChartinkScraper instance
 * @param {object} services.indicatorEngine - IndicatorEngine instance
 * @param {object} services.kiteAuth - KiteAuth instance
 * @param {object} services.kiteClient - KiteClient instance
 * @param {Function} services.notifyOwner - Function to send Telegram message to owner
 */
export function setupCronJobs(services) {
  const { screener, indicatorEngine, kiteAuth, kiteClient, notifyOwner } = services;

  // ─── Daily Manual Login Reminder (8:30 AM IST, Mon-Fri) ───
  cron.schedule(
    '30 8 * * 1-5',
    async () => {
      logger.info('⏰ Cron: Daily login reminder triggered');
      if (!isTradingDay()) {
        logger.info('Not a trading day, skipping login reminder');
        return;
      }
      try {
        await notifyOwner(`⏰ <b>Good Morning!</b>\n\nIt is time to authenticate Kite Connect for today's trading session.\n\nPlease run /login to get started.`);
      } catch (err) {
        logger.error({ err }, 'Cron: Login reminder failed');
      }
    },
    { timezone: config.market.timezone }
  );

  // ─── Screener Scan (every N minutes during market hours, Mon-Fri) ───
  const scanInterval = config.scan.intervalMinutes;
  cron.schedule(
    `*/${scanInterval} ${config.market.openHour}-${config.market.closeHour} * * 1-5`,
    async () => {
      if (!isMarketOpen()) return;
      logger.info('⏰ Cron: Screener scan triggered');
      try {
        await runScreenerScan(services);
      } catch (err) {
        logger.error({ err }, 'Cron: Screener scan failed');
      }
    },
    { timezone: config.market.timezone }
  );

  // ─── Morning Briefing (9:00 AM IST, Mon-Fri) ───
  cron.schedule(
    '0 9 * * 1-5',
    async () => {
      if (!isTradingDay()) return;
      logger.info('⏰ Cron: Morning briefing triggered');
      try {
        await runMorningBriefing(services);
      } catch (err) {
        logger.error({ err }, 'Cron: Morning briefing failed');
      }
    },
    { timezone: config.market.timezone }
  );

  // ─── End-of-Day Summary (3:35 PM IST, Mon-Fri) ───
  cron.schedule(
    '35 15 * * 1-5',
    async () => {
      if (!isTradingDay()) return;
      logger.info('⏰ Cron: EOD summary triggered');
      try {
        await runEodSummary(services);
      } catch (err) {
        logger.error({ err }, 'Cron: EOD summary failed');
      }
    },
    { timezone: config.market.timezone }
  );

  logger.info(
    {
      scanInterval: `${scanInterval} min`,
      marketHours: `${config.market.openHour}:${String(config.market.openMinute).padStart(2, '0')}-${config.market.closeHour}:${String(config.market.closeMinute).padStart(2, '0')}`,
    },
    '✅ All cron jobs scheduled'
  );
}

// runAuthRefresh has been removed in favour of manual /login command

/**
 * Run screener scan → indicator evaluation → alert pipeline.
 */
async function runScreenerScan(services) {
  const { screener, indicatorEngine, notifyOwner } = services;

  if (!screener) {
    logger.warn('Screener not configured, skipping scan');
    return;
  }

  // 1. Fetch screener results
  const candidates = await screener.scanAll();
  logger.info({ count: candidates.length }, 'Screener returned candidates');

  if (candidates.length === 0) return;

  // 2. Evaluate each candidate against indicator rules
  const qualifying = [];
  const { wasAlertedToday, logAlert } = await import('../db/queries.js');

  for (const stock of candidates) {
    try {
      // Skip if already alerted today
      if (wasAlertedToday(stock.symbol, 'indicator_match')) {
        logger.debug({ symbol: stock.symbol }, 'Already alerted today, skipping');
        continue;
      }

      // Run indicator engine
      if (indicatorEngine) {
        const result = await indicatorEngine.evaluate(stock.symbol);
        if (result.passed) {
          qualifying.push({ stock, indicatorResult: result });
        }
      } else {
        // If no indicator engine, treat all screener results as qualifying
        qualifying.push({ stock, indicatorResult: null });
      }
    } catch (err) {
      logger.error({ symbol: stock.symbol, err: err.message }, 'Failed to evaluate stock');
    }
  }

  // 3. Send alerts for qualifying stocks
  if (qualifying.length > 0) {
    logger.info({ count: qualifying.length }, '🚨 Qualifying stocks found!');

    for (const { stock, indicatorResult } of qualifying) {
      const message = formatAlertMessage(stock, indicatorResult);
      await notifyOwner(message);
      logAlert(stock.symbol, 'indicator_match', message);

      // Small delay between messages to respect Telegram rate limits
      await new Promise((r) => setTimeout(r, 500));
    }
  } else {
    logger.info('No qualifying stocks in this scan');
  }
}

/**
 * Send morning briefing with portfolio summary.
 */
async function runMorningBriefing(services) {
  const { kiteClient, notifyOwner } = services;

  const now = getNowIST();
  const dateStr = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let portfolioSection = '';
  if (kiteClient?.isAuthenticated) {
    try {
      const holdings = await kiteClient.getHoldings();
      const totalValue = holdings.reduce((sum, h) => sum + (h.last_price * h.quantity), 0);
      const totalInvested = holdings.reduce((sum, h) => sum + (h.average_price * h.quantity), 0);
      const totalPnl = totalValue - totalInvested;
      const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested * 100) : 0;
      const emoji = totalPnl >= 0 ? '🟢' : '🔴';

      portfolioSection =
        `\n<b>📊 Portfolio Snapshot</b>\n` +
        `Invested: ₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `Current: ₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `P&amp;L: ${totalPnl >= 0 ? '+' : ''}₹${totalPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${pnlPercent.toFixed(2)}%) ${emoji}\n` +
        `Holdings: ${holdings.length} stocks\n`;
    } catch (err) {
      portfolioSection = '\n<i>⚠️ Could not fetch portfolio data</i>\n';
    }
  }

  const message =
    `☀️ <b>Good Morning! Market Briefing</b>\n` +
    `${dateStr}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${portfolioSection}\n` +
    `🕘 Market opens at 9:15 AM IST\n` +
    `📡 Screener scans every ${config.scan.intervalMinutes} min\n` +
    `\n<i>Use /scan to check screeners now</i>`;

  await notifyOwner(message);
}

/**
 * Send end-of-day summary.
 */
async function runEodSummary(services) {
  const { kiteClient, notifyOwner } = services;

  let positionsSection = '';
  let ordersSection = '';

  if (kiteClient?.isAuthenticated) {
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
  }

  const message =
    `🌙 <b>End of Day Summary</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${positionsSection}` +
    `${ordersSection}\n` +
    `Market closed. See you tomorrow! 👋`;

  await notifyOwner(message);
}

/**
 * Format a stock alert message.
 */
function formatAlertMessage(stock, indicatorResult) {
  let message =
    `🚨 <b>ALERT: ${stock.symbol}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>Price:</b> ₹${stock.price}\n`;

  if (stock.changePercent != null) {
    const emoji = stock.changePercent >= 0 ? '🟢' : '🔴';
    message += `<b>Change:</b> ${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent}% ${emoji}\n`;
  }

  if (stock.volume) {
    message += `<b>Volume:</b> ${stock.volume.toLocaleString?.('en-IN') || stock.volume}\n`;
  }

  if (indicatorResult?.results) {
    message += `\n<b>✅ ALL CONDITIONS MET</b>\n`;
    for (const r of indicatorResult.results) {
      const icon = r.passed ? '✅' : '❌';
      message += `${icon} ${r.name}: ${r.currentValue ?? 'N/A'}`;
      if (r.threshold) message += ` (${r.threshold})`;
      message += '\n';
    }
  } else {
    message += `\n<i>Appeared in screener scan</i>\n`;
  }

  message += `\n<i>Scanned at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</i>`;
  return message;
}
