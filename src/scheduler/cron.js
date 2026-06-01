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

  // ─── Pre-Market Screener Scan (9:05 AM IST, Mon-Fri) ───
  cron.schedule(
    '5 9 * * 1-5',
    async () => {
      if (!isTradingDay()) return;
      logger.info('⏰ Cron: Pre-market screener scan triggered');
      try {
        await runScreenerScan(services);
      } catch (err) {
        logger.error({ err }, 'Cron: Pre-market screener scan failed');
      }
    },
    { timezone: config.market.timezone }
  );

  // ─── Post-Market Screener Scan (3:45 PM IST, Mon-Fri) ───
  cron.schedule(
    '45 15 * * 1-5',
    async () => {
      if (!isTradingDay()) return;
      logger.info('⏰ Cron: Post-market screener scan triggered');
      try {
        await runScreenerScan(services);
      } catch (err) {
        logger.error({ err }, 'Cron: Post-market screener scan failed');
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

  // 3. Send alerts for top 5 qualifying stocks
  if (qualifying.length > 0) {
    // Sort by score descending, fallback to momentum
    qualifying.sort((a, b) => {
      const scoreA = a.indicatorResult?.score || 0;
      const scoreB = b.indicatorResult?.score || 0;
      if (scoreA === scoreB) {
        return (b.stock.changePercent || 0) - (a.stock.changePercent || 0);
      }
      return scoreB - scoreA;
    });

    const topQualifying = qualifying.slice(0, 5);
    logger.info({ count: topQualifying.length, total: qualifying.length }, '🚨 Top qualifying stocks found!');

    for (const { stock, indicatorResult } of topQualifying) {
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
  const { kiteClient, indicatorEngine, notifyOwner } = services;

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

      // Evaluate holdings for strong confidence
      let actionableStocks = [];
      if (indicatorEngine && holdings.length > 0) {
        for (const holding of holdings) {
          try {
            // Kite holdings use trading symbol (e.g., RELIANCE)
            const result = await indicatorEngine.evaluate(holding.tradingsymbol);
            // Alert if it still maintains a strong confidence or passes conditions
            if (result.passed || result.score >= 80) {
               actionableStocks.push(`${holding.tradingsymbol} (${result.score}/100)`);
            }
          } catch (err) {
            logger.warn({ symbol: holding.tradingsymbol }, 'Could not evaluate portfolio stock');
          }
        }
        if (actionableStocks.length > 0) {
           portfolioSection += `\n<b>👀 Keep an Eye On (High Confidence):</b>\n${actionableStocks.join(', ')}\n`;
        }
      }

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
    `\n<i>Use /scan to check screeners now</i>`;

  await notifyOwner(message);
}

/**
 * Send end-of-day summary.
 */
async function runEodSummary(services) {
  const { kiteClient, indicatorEngine, notifyOwner } = services;

  let positionsSection = '';
  let ordersSection = '';
  let portfolioActionSection = '';

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

    try {
      // Evaluate holdings for strong confidence
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
        }
      }
    } catch (err) {}
  }

  const message =
    `🌙 <b>End of Day Summary</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${positionsSection}` +
    `${ordersSection}` +
    `${portfolioActionSection}\n` +
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

  if (indicatorResult) {
    const scoreStr = indicatorResult.score !== undefined ? ` [${indicatorResult.score}/${indicatorResult.maxScore}]` : '';
    const label = indicatorResult.confidenceLabel || '';
    
    // If it passed all conditions, show a simple success message
    const allPassed = indicatorResult.results?.every(r => r.passed);
    if (allPassed) {
      message += `\n<b>✅ ALL CONDITIONS MET${scoreStr}</b>\n`;
    } else {
      message += `\n<b>✅ QUALIFIED SETUP${scoreStr}</b>\n`;
      if (label) {
        message += `<b>Confidence:</b> ${label}\n`;
      }
      
      // Optionally just list the ones that failed to keep it concise
      const failed = indicatorResult.results?.filter(r => !r.passed) || [];
      if (failed.length > 0) {
        message += `\n<i>Failed Conditions:</i>\n`;
        for (const r of failed) {
          message += `❌ ${r.name}\n`;
        }
      }
    }
  } else {
    message += `\n<i>Appeared in screener scan</i>\n`;
  }

  message += `\n<i>Scanned at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</i>`;
  return message;
}
