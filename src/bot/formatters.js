import { escapeHtml } from '../utils/error-handler.js';
import {
  formatINR,
  formatChange,
  formatVolume,
  isMarketOpen,
  msUntilMarketOpen,
  getNowIST,
} from '../utils/market-hours.js';

const LINE = '━━━━━━━━━━━━━━━━';

/**
 * Format holdings array into a rich portfolio view.
 *
 * @param {Array<{tradingsymbol: string, last_price: number, pnl: number,
 *   day_change: number, day_change_percentage: number, quantity: number,
 *   average_price: number}>} holdings
 * @returns {string} HTML-formatted message
 */
export function formatPortfolio(holdings) {
  if (!holdings || holdings.length === 0) {
    return `📊 <b>Your Portfolio</b>\n${LINE}\n<i>No holdings found.</i>`;
  }

  let totalInvestment = 0;
  let totalCurrent = 0;
  let dayPnl = 0;

  const rows = holdings.map((h) => {
    const symbol = escapeHtml(h.tradingsymbol);
    const price = formatINR(h.last_price);
    const changePct = h.day_change_percentage ?? 0;
    const emoji = changePct >= 0 ? '🟢' : '🔴';
    const sign = changePct >= 0 ? '+' : '';

    totalInvestment += (h.average_price ?? 0) * (h.quantity ?? 0);
    totalCurrent += (h.last_price ?? 0) * (h.quantity ?? 0);
    dayPnl += h.day_change ?? 0;

    return `<code>${symbol.padEnd(10)}</code> ${price}  ${sign}${changePct.toFixed(2)}% ${emoji}`;
  });

  const totalPnl = totalCurrent - totalInvestment;
  const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';
  const pnlSign = totalPnl >= 0 ? '+' : '';
  const dayPnlEmoji = dayPnl >= 0 ? '🟢' : '🔴';
  const dayPnlSign = dayPnl >= 0 ? '+' : '';

  return [
    `📊 <b>Your Portfolio</b>`,
    LINE,
    ...rows,
    LINE,
    `<b>Value:</b> ${formatINR(totalCurrent)}  |  <b>P&amp;L:</b> ${pnlSign}${formatINR(totalPnl)} ${pnlEmoji}`,
    `<b>Day P&amp;L:</b> ${dayPnlSign}${formatINR(dayPnl)} ${dayPnlEmoji}`,
  ].join('\n');
}

/**
 * Format open positions.
 *
 * @param {Array<{tradingsymbol: string, product: string, quantity: number,
 *   buy_price: number, sell_price: number, last_price: number, pnl: number,
 *   unrealised: number}>} positions
 * @returns {string} HTML-formatted message
 */
export function formatPositions(positions) {
  if (!positions || positions.length === 0) {
    return `📋 <b>Open Positions</b>\n${LINE}\n<i>No open positions.</i>`;
  }

  let totalPnl = 0;

  const rows = positions.map((p) => {
    const symbol = escapeHtml(p.tradingsymbol);
    const qty = p.quantity ?? 0;
    const pnl = p.pnl ?? p.unrealised ?? 0;
    totalPnl += pnl;
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    const sign = pnl >= 0 ? '+' : '';
    const side = qty >= 0 ? 'LONG' : 'SHORT';

    return (
      `<code>${symbol.padEnd(10)}</code> ${side}\n` +
      `  Qty: ${Math.abs(qty)}  |  LTP: ${formatINR(p.last_price)}  |  P&L: ${sign}${formatINR(pnl)} ${emoji}`
    );
  });

  const totalEmoji = totalPnl >= 0 ? '🟢' : '🔴';
  const totalSign = totalPnl >= 0 ? '+' : '';

  return [
    `📋 <b>Open Positions</b>`,
    LINE,
    ...rows,
    LINE,
    `<b>Total P&amp;L:</b> ${totalSign}${formatINR(totalPnl)} ${totalEmoji}`,
  ].join('\n');
}

/**
 * Format today's orders.
 *
 * @param {Array<{tradingsymbol: string, transaction_type: string, order_type: string,
 *   quantity: number, price: number, status: string, order_timestamp: string,
 *   status_message: string}>} orders
 * @returns {string} HTML-formatted message
 */
export function formatOrders(orders) {
  if (!orders || orders.length === 0) {
    return `🧾 <b>Today's Orders</b>\n${LINE}\n<i>No orders placed today.</i>`;
  }

  const statusEmoji = {
    COMPLETE: '✅',
    REJECTED: '❌',
    CANCELLED: '🚫',
    OPEN: '⏳',
    PENDING: '⏳',
    'TRIGGER PENDING': '⏳',
  };

  const rows = orders.map((o) => {
    const symbol = escapeHtml(o.tradingsymbol);
    const side = o.transaction_type === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    const emoji = statusEmoji[o.status] || '❓';
    const price = o.price ? formatINR(o.price) : 'MKT';

    return (
      `${emoji} <code>${symbol}</code> ${side}\n` +
      `  ${o.order_type} | Qty: ${o.quantity} | Price: ${price}\n` +
      `  Status: <b>${escapeHtml(o.status)}</b>`
    );
  });

  return [
    `🧾 <b>Today's Orders</b>`,
    LINE,
    ...rows,
    LINE,
    `Total: ${orders.length} order(s)`,
  ].join('\n');
}

/**
 * Format screener scan results with indicator status.
 *
 * @param {Array<{symbol: string, price: number, changePercent: number,
 *   volume: number, indicatorResults: {passed: boolean, score?: number, maxScore?: number, confidenceLabel?: string, conditions: Array<{name: string, passed: boolean, detail: string}>}
 * }>} results
 * @param {Object} [meta={}] - Meta info like totalScanned
 * @returns {string} HTML-formatted message
 */
export function formatScanResults(results, meta = {}) {
  const { totalScanned = 0, title = 'Scan Results', subtitle = 'Pre-market Scanner' } = meta;

  if (!results || results.length === 0) {
    return `🔍 <b>${title}</b>\n${LINE}\n<i>No stocks matched your screener criteria.</i>`;
  }

  const qualifying = results.filter((r) => r.indicatorResults?.passed);
  const partial = results.filter((r) => !r.indicatorResults?.passed);
  
  // Sort qualifying by score descending
  qualifying.sort((a, b) => (b.indicatorResults?.score || 0) - (a.indicatorResults?.score || 0));
  
  // Sort partial by preserved score descending, fallback to momentum
  partial.sort((a, b) => {
    const scoreA = a.indicatorResults?.score || 0;
    const scoreB = b.indicatorResults?.score || 0;
    if (scoreB === scoreA) {
      return (b.changePercent || 0) - (a.changePercent || 0);
    }
    return scoreB - scoreA;
  });

  const confidenceEmojis = {
    'Strong': '🟢',
    'Medium': '🟡',
    'Low': '🔴',
    'Failed Mandatory': '⚠️',
    'None': '⚪'
  };

  const formatGroup = (stocks, groupTitle, fallbackEmoji) => {
    if (stocks.length === 0) return '';
    const rows = stocks.map((s) => {
      // Determine source tag
      let tag = '';
      if (s.source === 'discovery') tag = '🔭 ';
      else if (s.source === 'chartink') tag = '📡 ';

      const sym = escapeHtml(s.symbol);
      const price = formatINR(s.price);
      const pct = s.changePercent ?? 0;
      const pctSign = pct >= 0 ? '+' : '';
      
      const res = s.indicatorResults || {};
      const scoreStr = res.score !== undefined ? ` [${res.score}/${res.maxScore}]` : '';
      const label = res.confidenceLabel || 'None';
      let emoji = confidenceEmojis[label] || fallbackEmoji;
      if (res.rpciBreakdown?.highConviction) {
        emoji = '🔥';
      }

      let rpciStr = '';
      if (res.rpciBreakdown) {
        const { score, label: rLabel, valuation, earnings, momentum, contraction, timeframe, outperformance, institutional, stExtension, ltExtension, stage, patternDetected, contractionCount, resistanceBreakout } = res.rpciBreakdown;
        rpciStr = `\n  📊 RPCI: ${score || 0}/10 — ${rLabel || 'Unknown'}\n` +
          `  ${valuation?.passed?'✅':'❌'} Valuation · ${earnings?.passed?'✅':'❌'} Earnings · ${momentum?.passed?'✅':'❌'} Momentum · ${contraction?.passed?'✅':'❌'} Contraction\n` +
          `  ${timeframe?.passed?'✅':'❌'} Timeframe · ${outperformance?.passed?'✅':'❌'} Outperformance · ${institutional?.passed?'✅':'❌'} Institutions(${institutional?.label || '0'})\n` +
          `  ${stExtension?.passed?'✅':'❌'} ST Extension · ${ltExtension?.passed?'✅':'❌'} LT Extension · ${stage?.passed?'✅':'❌'} Stage 2`;
          
        if (patternDetected) {
          rpciStr += `\n  📉→📈 Contracted ${contractionCount} days → Expansion today`;
          if (resistanceBreakout) {
            rpciStr += `\n  🔺 Contraction + Resistance Breakout ✅`;
          } else {
            rpciStr += `\n  ⚡ Contraction Detected ✅`;
          }
        }
      }

      return `${emoji} ${tag}<code>${sym.padEnd(10)}</code> ${price}  ${pctSign}${pct.toFixed(2)}%${scoreStr}${rpciStr}`;
    });

    return `\n<b>${groupTitle}</b> (${stocks.length})\n${rows.join('\n')}`;
  };

  const scanInfo = totalScanned > 0 ? ` (Top ${results.length} out of ${totalScanned} scanned)` : '';
  
  let header = `🔍 <b>${title}${scanInfo}</b>`;
  if (subtitle) header += `\n<i>${subtitle}</i>`;

  return [
    header,
    LINE,
    formatGroup(qualifying, '✅ Qualified (By Confidence)', '🎯'),
    formatGroup(partial, '⚠️ Failed Mandatory Rules', '📊'),
    `\n${LINE}`,
    `<i>Scanned at ${getNowIST().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</i>`,
  ].join('\n');
}

/**
 * Format detailed indicator check for a single stock.
 *
 * @param {string} symbol
 * @param {{price: number, passed: boolean,
 *   conditions: Array<{name: string, passed: boolean, detail: string}>}} indicatorResults
 * @returns {string} HTML-formatted message
 */
export function formatStockCheck(symbol, indicatorResults) {
  if (!indicatorResults) {
    return `📈 <b>${escapeHtml(symbol)}</b> — <i>No indicator data available.</i>`;
  }

  const { price, passed, score, maxScore, confidenceLabel, results } = indicatorResults;
  
  let statusText = passed ? '✅ QUALIFIED' : '⚠️ FAILED MANDATORY RULES';
  if (score !== undefined) {
     statusText += ` — ${confidenceLabel} Confidence (${score}/${maxScore})`;
  }

  const conditionLines = (results || []).map((c) => {
    const emoji = c.passed ? '✅' : '❌';
    const scoreStr = c.scoreContribution !== undefined 
      ? ` <i>[${c.scoreContribution} pts]</i>` 
      : (c.mandatory ? ` <i>[Mandatory]</i>` : '');
    
    // threshold contains the engine's dynamic evaluation details
    const details = c.threshold ? `\n   └ <i>${escapeHtml(c.threshold)}</i>` : '';
    
    return `${emoji} <b>${escapeHtml(c.name)}</b>${scoreStr}${details}\n`;
  });

  let rpciBlock = '';
  let titleEmoji = '📈';
  if (indicatorResults.rpciBreakdown) {
    if (indicatorResults.rpciBreakdown.highConviction) {
      titleEmoji = '🔥';
    }
    const { score: rScore, label, valuation, earnings, momentum, contraction, timeframe, outperformance, institutional, stExtension, ltExtension, stage, patternDetected, contractionCount, resistanceBreakout } = indicatorResults.rpciBreakdown;
    rpciBlock = `\n  📊 <b>RPCI: ${rScore || 0}/10 — ${label || 'Unknown'}</b>\n` +
      `  ${valuation?.passed?'✅':'❌'} Valuation · ${earnings?.passed?'✅':'❌'} Earnings · ${momentum?.passed?'✅':'❌'} Momentum · ${contraction?.passed?'✅':'❌'} Contraction\n` +
      `  ${timeframe?.passed?'✅':'❌'} Timeframe · ${outperformance?.passed?'✅':'❌'} Outperformance · ${institutional?.passed?'✅':'❌'} Institutions(${institutional?.label || '0'})\n` +
      `  ${stExtension?.passed?'✅':'❌'} ST Extension · ${ltExtension?.passed?'✅':'❌'} LT Extension · ${stage?.passed?'✅':'❌'} Stage 2`;
      
    if (patternDetected) {
      rpciBlock += `\n  📉→📈 Contracted ${contractionCount} days → Expansion today`;
      if (resistanceBreakout) {
        rpciBlock += `\n  🔺 Contraction + Resistance Breakout ✅\n`;
      } else {
        rpciBlock += `\n  ⚡ Contraction Detected ✅\n`;
      }
    } else {
      rpciBlock += '\n'; // Add newline for spacing
    }
  }

  return [
    `${titleEmoji} <b>${escapeHtml(symbol)}</b> — Indicator Check`,
    LINE,
    `<b>Price:</b> ${formatINR(price || 0)}`,
    '',
    `<b>Status:</b> ${statusText}`,
    rpciBlock,
    ...conditionLines,
  ].join('\n');
}

/**
 * Format watchlist.
 *
 * @param {Array<{symbol: string, last_price?: number, change_percent?: number,
 *   added_at?: string}>} items
 * @returns {string} HTML-formatted message
 */
export function formatWatchlist(items) {
  if (!items || items.length === 0) {
    return `⭐ <b>Watchlist</b>\n${LINE}\n<i>Your watchlist is empty.\nUse /watchlist add SYMBOL to add stocks.</i>`;
  }

  const rows = items.map((item, i) => {
    const sym = escapeHtml(item.symbol);
    const price = item.last_price ? formatINR(item.last_price) : '';
    const pct = item.change_percent ?? 0;
    const emoji = pct >= 0 ? '🟢' : '🔴';
    const sign = pct >= 0 ? '+' : '';
    const priceInfo = price ? `  ${price}  ${sign}${pct.toFixed(2)}% ${emoji}` : '';
    return `${i + 1}. <code>${sym}</code>${priceInfo}`;
  });

  return [
    `⭐ <b>Watchlist</b> (${items.length})`,
    LINE,
    ...rows,
  ].join('\n');
}

/**
 * Format market open/closed status with timer.
 *
 * @returns {string} HTML-formatted message
 */
export function formatMarketStatus() {
  const open = isMarketOpen();

  if (open) {
    return '🟢 Market is <b>OPEN</b>';
  }

  const msLeft = msUntilMarketOpen();
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);

  let timer = '';
  if (hours > 0) timer += `${hours}h `;
  timer += `${minutes}m`;

  return `🔴 Market is <b>CLOSED</b>\n⏱ Opens in ${timer}`;
}

/**
 * Format a user-friendly error message.
 *
 * @param {string} message
 * @returns {string} HTML-formatted message
 */
export function formatError(message) {
  return `❌ <b>Error</b>\n\n${escapeHtml(message)}`;
}

/**
 * Format morning briefing summary.
 *
 * @param {{totalValue: number, dayChange: number, dayChangePct: number,
 *   topGainer: {symbol: string, changePct: number},
 *   topLoser: {symbol: string, changePct: number}}} portfolioSummary
 * @param {{nifty: number, niftyChange: number, bankNifty: number,
 *   bankNiftyChange: number}} marketData
 * @returns {string} HTML-formatted message
 */
export function formatMorningBriefing(portfolioSummary, marketData) {
  const parts = [`🌅 <b>Good Morning! Market Briefing</b>`, LINE];

  if (marketData) {
    const niftyEmoji = (marketData.niftyChange ?? 0) >= 0 ? '🟢' : '🔴';
    const bnEmoji = (marketData.bankNiftyChange ?? 0) >= 0 ? '🟢' : '🔴';
    parts.push(
      `<b>Indices</b>`,
      `NIFTY 50:   ${formatINR(marketData.nifty)}  ${niftyEmoji}`,
      `BANK NIFTY: ${formatINR(marketData.bankNifty)}  ${bnEmoji}`,
      ''
    );
  }

  if (portfolioSummary) {
    const dayEmoji = (portfolioSummary.dayChange ?? 0) >= 0 ? '🟢' : '🔴';
    const daySign = (portfolioSummary.dayChange ?? 0) >= 0 ? '+' : '';
    parts.push(
      `<b>Portfolio</b>`,
      `Value: ${formatINR(portfolioSummary.totalValue)}`,
      `Day Change: ${daySign}${formatINR(portfolioSummary.dayChange)} (${daySign}${(portfolioSummary.dayChangePct ?? 0).toFixed(2)}%) ${dayEmoji}`,
      ''
    );

    if (portfolioSummary.topGainer) {
      parts.push(
        `📈 Top Gainer: <code>${escapeHtml(portfolioSummary.topGainer.symbol)}</code> +${portfolioSummary.topGainer.changePct?.toFixed(2)}%`
      );
    }
    if (portfolioSummary.topLoser) {
      parts.push(
        `📉 Top Loser: <code>${escapeHtml(portfolioSummary.topLoser.symbol)}</code> ${portfolioSummary.topLoser.changePct?.toFixed(2)}%`
      );
    }
  }

  parts.push('', `<i>Have a profitable day! 🚀</i>`);
  return parts.join('\n');
}

/**
 * Format end-of-day summary.
 *
 * @param {{realised: number, unrealised: number, total: number}} dayPnl
 * @param {Array<{tradingsymbol: string, pnl: number}>} positions
 * @returns {string} HTML-formatted message
 */
export function formatEodSummary(dayPnl, positions) {
  const parts = [`🌙 <b>End of Day Summary</b>`, LINE];

  if (dayPnl) {
    const totalEmoji = (dayPnl.total ?? 0) >= 0 ? '🟢' : '🔴';
    const totalSign = (dayPnl.total ?? 0) >= 0 ? '+' : '';

    parts.push(
      `<b>Day P&amp;L</b>`,
      `Realised:   ${totalSign}${formatINR(dayPnl.realised)}`,
      `Unrealised: ${totalSign}${formatINR(dayPnl.unrealised)}`,
      `<b>Total:</b>      ${totalSign}${formatINR(dayPnl.total)} ${totalEmoji}`,
      ''
    );
  }

  if (positions && positions.length > 0) {
    parts.push(`<b>Positions Carried Forward</b>`);
    positions.forEach((p) => {
      const pnlEmoji = (p.pnl ?? 0) >= 0 ? '🟢' : '🔴';
      parts.push(`  <code>${escapeHtml(p.tradingsymbol)}</code> ${formatINR(p.pnl)} ${pnlEmoji}`);
    });
  } else {
    parts.push(`<i>No positions carried forward.</i>`);
  }

  parts.push('', `<i>See you tomorrow! 💤</i>`);
  return parts.join('\n');
}
