/**
 * ============================================================
 *  Indicator Engine  —  equity-bot  /  src/indicator/engine.js
 * ============================================================
 *
 *  Evaluates every rule defined in rules.js against historical
 *  OHLCV data and returns a structured confidence score.
 *
 *  Dependencies: `technicalindicators` npm package
 *
 * ============================================================
 */

import { RSI, MACD, EMA, BollingerBands, ADX } from 'technicalindicators';
import { rules, MAX_SCORE } from './rules.js';

export class IndicatorEngine {

  /**
   * Main entry point. Pass in one stock's historical OHLCV data.
   *
   * @param {string} symbol  - Ticker symbol e.g. "RELIANCE"
   * @param {object} ohlcv   - { open[], high[], low[], close[], volume[] }
   * @returns {object}       - Full evaluation result with score, breakdown, pass/fail
   */
  evaluate(symbol, ohlcv) {
    const { open, high, low, close, volume } = ohlcv;

    // Need at least 200 candles for meaningful EMA(200) calculation
    if (!close || close.length < 200) {
      return this._insufficientData(symbol);
    }

    let totalScore = 0;
    let mandatoryFailed = false;
    const breakdown = [];

    for (const rule of rules) {
      let rulePassed = false;
      let currentValue = null;
      let details = '';

      try {
        switch (rule.type) {

          // ──────────────────────────────────────────────────
          //  MANDATORY: Relative Volume Breakout
          //  Your custom indicator — logic preserved exactly.
          // ──────────────────────────────────────────────────
          case 'RELATIVE_VOLUME_BREAKOUT': {
            const { avgVolumePeriod, quietPeriods, quietThreshold, spikeMultiplier } = rule;
            const len = volume.length;

            // Calculate 20-day average volume (excluding today)
            const recentVols = volume.slice(len - avgVolumePeriod - 1, len - 1);
            const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;

            // Check that the preceding `quietPeriods` days were below threshold
            const quietWindow = volume.slice(len - quietPeriods - 1, len - 1);
            const wasQuiet = quietWindow.every(v => v < avgVol * quietThreshold);

            // Today's volume
            const todayVol = volume[len - 1];
            const spikeRatio = todayVol / avgVol;

            currentValue = spikeRatio;
            rulePassed = wasQuiet && spikeRatio >= spikeMultiplier;
            details = `Spike ratio: ${spikeRatio.toFixed(2)}× avg | Quiet before: ${wasQuiet}`;
            break;
          }

          // ──────────────────────────────────────────────────
          //  EMA Trend Alignment  (21 > 50 > 200 stack)
          // ──────────────────────────────────────────────────
          case 'EMA_TREND_ALIGNMENT': {
            const [p1, p2, p3] = rule.periods; // [21, 50, 200]

            const ema21 = EMA.calculate({ period: p1, values: close });
            const ema50 = EMA.calculate({ period: p2, values: close });
            const ema200 = EMA.calculate({ period: p3, values: close });

            // Get the most recent value for each
            const last21 = ema21[ema21.length - 1];
            const last50 = ema50[ema50.length - 1];
            const last200 = ema200[ema200.length - 1];

            rulePassed = last21 > last50 && last50 > last200;
            currentValue = last21;
            details = `EMA21=${last21.toFixed(2)} | EMA50=${last50.toFixed(2)} | EMA200=${last200.toFixed(2)}`;
            break;
          }

          // ──────────────────────────────────────────────────
          //  Supertrend Bullish
          //  Note: `technicalindicators` doesn't ship Supertrend.
          //  Implemented manually using ATR — the standard formula.
          // ──────────────────────────────────────────────────
          case 'SUPERTREND_BULLISH': {
            const { atrPeriod, multiplier } = rule;
            const len = close.length;

            // ── 1. Calculate True Range ──
            const tr = [];
            for (let i = 1; i < len; i++) {
              const hl = high[i] - low[i];
              const hpc = Math.abs(high[i] - close[i - 1]);
              const lpc = Math.abs(low[i] - close[i - 1]);
              tr.push(Math.max(hl, hpc, lpc));
            }

            // ── 2. Smooth TR into ATR using Wilder's RMA ──
            // We need enough bars; skip if insufficient
            if (tr.length < atrPeriod + 1) {
              rulePassed = false;
              details = 'Insufficient data for ATR';
              break;
            }
            const atr = this._wilderSmooth(tr, atrPeriod);

            // ── 3. Compute raw upper/lower bands ──
            // Align indices: atr[0] corresponds to close[atrPeriod]
            const offset = atrPeriod; // how many closes are skipped
            const supertrend = [];

            let prevUpper = 0;
            let prevLower = 0;
            let prevST = 0;  // 1 = bullish, -1 = bearish
            let prevClose = close[offset - 1];

            for (let i = 0; i < atr.length; i++) {
              const idx = i + offset;
              const midpoint = (high[idx] + low[idx]) / 2;
              const rawUpper = midpoint + multiplier * atr[i];
              const rawLower = midpoint - multiplier * atr[i];

              // Adjust bands to avoid flipping unnecessarily (standard Supertrend logic)
              const finalUpper = (rawUpper < prevUpper || prevClose > prevUpper) ? rawUpper : prevUpper;
              const finalLower = (rawLower > prevLower || prevClose < prevLower) ? rawLower : prevLower;

              // Determine trend direction
              let trend;
              if (prevST === -1 && close[idx] > prevUpper) {
                trend = 1;  // Flipped bullish
              } else if (prevST === 1 && close[idx] < prevLower) {
                trend = -1; // Flipped bearish
              } else {
                trend = prevST || 1; // Default to bullish on first candle
              }

              supertrend.push({ trend, upper: finalUpper, lower: finalLower });
              prevUpper = finalUpper;
              prevLower = finalLower;
              prevST = trend;
              prevClose = close[idx];
            }

            const lastST = supertrend[supertrend.length - 1];
            rulePassed = lastST.trend === 1;
            currentValue = lastST.trend;
            details = `Supertrend: ${rulePassed ? '▲ BULLISH' : '▼ BEARISH'} | Lower band=${lastST.lower.toFixed(2)}`;
            break;
          }

          // ──────────────────────────────────────────────────
          //  RSI Momentum Zone  (55–75 sweet spot)
          // ──────────────────────────────────────────────────
          case 'RSI_MOMENTUM': {
            const { period, minRsi, maxRsi } = rule;
            const rsiValues = RSI.calculate({ period, values: close });
            const lastRsi = rsiValues[rsiValues.length - 1];

            rulePassed = lastRsi >= minRsi && lastRsi <= maxRsi;
            currentValue = lastRsi;
            details = `RSI(${period})=${lastRsi.toFixed(2)} | Target: ${minRsi}–${maxRsi}`;
            break;
          }

          // ──────────────────────────────────────────────────
          //  MACD Histogram Acceleration
          //  More powerful than simple MACD > Signal:
          //  Histogram must be positive AND growing.
          // ──────────────────────────────────────────────────
          case 'MACD_HISTOGRAM_ACCELERATION': {
            const { fastPeriod, slowPeriod, signalPeriod } = rule;
            const macdResult = MACD.calculate({
              values: close,
              fastPeriod,
              slowPeriod,
              signalPeriod,
              SimpleMAOscillator: false,
              SimpleMASignal: false,
            });

            const len = macdResult.length;
            if (len < 2) { rulePassed = false; break; }

            const last = macdResult[len - 1];
            const prev = macdResult[len - 2];

            const histogramNow = last.histogram;
            const histogramPrev = prev.histogram;

            // Histogram positive (MACD > Signal) AND expanding (accelerating)
            rulePassed = histogramNow > 0 && histogramNow > histogramPrev;
            currentValue = histogramNow;
            details = `Histogram: ${histogramNow?.toFixed(4)} | Prev: ${histogramPrev?.toFixed(4)} | Accelerating: ${histogramNow > histogramPrev}`;
            break;
          }

          // ──────────────────────────────────────────────────
          //  Bollinger Band Squeeze Breakout
          //  Two conditions must both be true:
          //    1. Band width is at a multi-week low (the "squeeze")
          //    2. Price closes above the upper band (the "breakout")
          // ──────────────────────────────────────────────────
          case 'BOLLINGER_SQUEEZE_BREAKOUT': {
            const { period, stdDev, squeezeLookback } = rule;
            const bbAll = BollingerBands.calculate({ period, stdDev, values: close });

            if (bbAll.length < squeezeLookback + 1) { rulePassed = false; break; }

            // Calculate bandwidth for the entire history available
            const bandwidths = bbAll.map(b => (b.upper - b.lower) / b.middle);

            // Current (last) candle
            const lastBB = bbAll[bbAll.length - 1];
            const lastClose = close[close.length - 1];
            const lastBandwidth = bandwidths[bandwidths.length - 1];

            // Recent bandwidth window to detect squeeze (lowest in `squeezeLookback` days)
            const recentBandwidths = bandwidths.slice(-squeezeLookback);
            const minBandwidth = Math.min(...recentBandwidths);
            const isSqueeze = lastBandwidth <= minBandwidth * 1.05; // Within 5% of lowest

            // Breakout: price above upper band
            const isBreakout = lastClose > lastBB.upper;

            rulePassed = isSqueeze && isBreakout;
            currentValue = lastBandwidth;
            details = `Bandwidth=${lastBandwidth.toFixed(4)} | Squeeze=${isSqueeze} | Breakout above upper=${isBreakout} (upper=${lastBB.upper.toFixed(2)})`;
            break;
          }

          // ──────────────────────────────────────────────────
          //  ADX Trend Strength Filter
          //  ADX > 20: trending, not choppy (partial score)
          //  ADX > 25: confirmed strong trend (full score)
          //  Note: `technicalindicators` ADX requires high, low, close.
          // ──────────────────────────────────────────────────
          case 'ADX_TREND_STRENGTH': {
            const { period, minAdx, strongAdx } = rule;
            const adxResult = ADX.calculate({ period, high, low, close });

            if (!adxResult.length) { rulePassed = false; break; }

            const lastAdx = adxResult[adxResult.length - 1].adx;

            // Partial pass: ADX ≥ minAdx; Full pass (full weight): ADX ≥ strongAdx
            // We encode this by using the `weight` proportionally in the engine aggregate.
            // For simplicity here: pass = ADX >= minAdx; the `currentValue` lets formatters show strength.
            rulePassed = lastAdx >= minAdx;
            currentValue = lastAdx;

            // Optional: scale score for partial vs full strength
            // The engine picks this up via `scoreContribution` below.
            const strengthRatio = Math.min(lastAdx / strongAdx, 1.0);
            details = `ADX(${period})=${lastAdx.toFixed(2)} | Strength ratio: ${(strengthRatio * 100).toFixed(0)}%`;

            // Attach for engine to use in weighted scoring
            rule._strengthRatio = rulePassed ? strengthRatio : 0;
            break;
          }

          // ──────────────────────────────────────────────────
          //  52-Week High Proximity
          //  Stocks within 10% of their 52W high have already
          //  cleared all overhead supply — lowest resistance path.
          // ──────────────────────────────────────────────────
          case 'NEAR_52W_HIGH': {
            const { lookbackDays, proximityPct } = rule;
            const recentCloses = close.slice(-lookbackDays);
            const high52w = Math.max(...recentCloses);
            const lastClose = close[close.length - 1];

            const pctFromHigh = ((high52w - lastClose) / high52w) * 100;

            rulePassed = pctFromHigh <= proximityPct;
            currentValue = pctFromHigh;
            details = `52W High: ${high52w.toFixed(2)} | Current: ${lastClose.toFixed(2)} | ${pctFromHigh.toFixed(2)}% below high`;
            break;
          }

          default:
            details = `Unknown rule type: ${rule.type}`;
            break;

        } // end switch

      } catch (err) {
        details = `Error: ${err.message}`;
        rulePassed = false;
      }

      // ── Score Contribution ──────────────────────────────
      // ADX uses a strength ratio for partial scoring.
      // All other rules are binary pass/fail.
      let scoreContribution = 0;
      if (rulePassed) {
        if (rule.type === 'ADX_TREND_STRENGTH' && rule._strengthRatio !== undefined) {
          scoreContribution = rule.weight * rule._strengthRatio;
        } else {
          scoreContribution = rule.weight;
        }
        totalScore += scoreContribution;
      }

      if (rule.mandatory && !rulePassed) {
        mandatoryFailed = true;
      }

      breakdown.push({
        id: rule.id,
        name: rule.name,
        passed: rulePassed,
        mandatory: rule.mandatory,
        weight: rule.weight,
        scoreContribution: Number(scoreContribution.toFixed(2)),
        currentValue: currentValue !== null ? Number(Number(currentValue).toFixed(4)) : null,
        details,
      });

    } // end for rules

    return {
      symbol,
      score: Number(totalScore.toFixed(2)),
      maxScore: MAX_SCORE,
      passed: !mandatoryFailed,
      category: mandatoryFailed ? 'Failed Mandatory' : 'Qualified',
      breakdown,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Private Helpers
  // ────────────────────────────────────────────────────────────

  /**
   * Wilder's Smoothing (RMA) — used for ATR in Supertrend.
   * First value is a simple average; subsequent values use the
   * Wilder formula: rma[i] = (rma[i-1] * (n-1) + value[i]) / n
   *
   * @param {number[]} values
   * @param {number}   period
   * @returns {number[]}
   */
  _wilderSmooth(values, period) {
    const result = [];
    // Seed with simple average of first `period` values
    const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(seed);
    for (let i = period; i < values.length; i++) {
      result.push((result[result.length - 1] * (period - 1) + values[i]) / period);
    }
    return result;
  }

  /**
   * Returns a clean failure object when there isn't enough data.
   */
  _insufficientData(symbol) {
    return {
      symbol,
      score: 0,
      maxScore: MAX_SCORE,
      passed: false,
      category: 'Insufficient Data',
      breakdown: [],
    };
  }
}
