/**
 * @fileoverview Indicator evaluation engine.
 *
 * Consumes OHLCV data via a DataFetcher and evaluates configurable
 * technical indicator rules against each stock symbol. Returns a
 * structured result with per-condition pass/fail details.
 */

import { RSI, EMA, SMA, MACD, BollingerBands, ADX, ATR } from 'technicalindicators';
import logger from '../utils/logger.js';
import rules from './rules.js';

class IndicatorEngine {
  constructor(dataFetcher, customRules) {
    this.dataFetcher = dataFetcher;
    this.rules = customRules || rules;
  }

  async evaluate(stockOrSymbol) {
    const symbolStr = typeof stockOrSymbol === 'object' ? stockOrSymbol.symbol : stockOrSymbol;
    const initialPrice = typeof stockOrSymbol === 'object' ? stockOrSymbol.price : undefined;

    try {
      const candles = await this.dataFetcher.getOHLCV(symbolStr, this.rules.timeframe);

      if (!candles || candles.length < 200) {
        logger.warn(
          { symbol: symbolStr, candleCount: candles?.length ?? 0 },
          'Insufficient OHLCV data for indicator evaluation'
        );
        return {
          symbol: symbolStr,
          price: initialPrice || 0,
          passed: false,
          error: `Insufficient data (got ${candles?.length ?? 0} candles, need ≥200)`,
          results: [],
          timestamp: new Date().toISOString(),
        };
      }

      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const volumes = candles.map((c) => c.volume);

      const results = [];
      for (const condition of this.rules.conditions) {
        const result = this._evaluateCondition(condition, { closes, highs, lows, volumes, candles });
        result.mandatory = condition.mandatory === true;
        result.weight = condition.weight || 0;
        
        // Attach proportional strength ratio (used for ADX) if set
        if (condition._strengthRatio !== undefined) {
           result.scoreContribution = condition.weight * condition._strengthRatio;
        } else {
           result.scoreContribution = result.passed ? condition.weight : 0;
        }
        
        results.push(result);
      }

      let passed = false;
      let score = 0;
      let maxScore = 0;
      let confidenceLabel = 'None';

      if (this.rules.logic === 'CONFIDENCE') {
        results.forEach(r => {
          maxScore += r.weight;
          score += r.scoreContribution; // Proportional scoring support
        });
        
        const strong = this.rules.confidence?.strong || 80;
        const medium = this.rules.confidence?.medium || 40;
        
        if (score >= strong) confidenceLabel = 'Strong';
        else if (score >= medium) confidenceLabel = 'Medium';
        else confidenceLabel = 'Low';

        const mandatoryPassed = results.filter(r => r.mandatory).every(r => r.passed);
        if (mandatoryPassed) {
          passed = true;
        } else {
          passed = false;
          confidenceLabel = 'Failed Mandatory';
        }
      } else {
        passed = this.rules.logic === 'AND'
          ? results.every((r) => r.passed)
          : results.some((r) => r.passed);
      }

      const latestPrice = closes[closes.length - 1];

      logger.debug(
        { symbol: symbolStr, passed, score, confidenceLabel, conditionsPassed: results.filter((r) => r.passed).length, total: results.length },
        'Indicator evaluation complete'
      );

      return { 
        symbol: symbolStr, 
        price: latestPrice,
        passed, 
        score: Number(score.toFixed(2)), 
        maxScore, 
        confidenceLabel, 
        results, 
        timestamp: new Date().toISOString() 
      };
    } catch (err) {
      logger.error({ symbol: symbolStr, err: err.message }, 'Indicator evaluation failed');
      return {
        symbol: symbolStr,
        price: initialPrice || 0,
        passed: false,
        error: err.message,
        results: [],
        timestamp: new Date().toISOString(),
      };
    }
  }

  _evaluateCondition(rule, data) {
    const { closes: close, highs: high, lows: low, volumes: volume } = data;
    let rulePassed = false;
    let currentValue = null;
    let details = '';

    try {
      switch (rule.type) {
        case 'MOMENTUM_BREAKOUT': {
          const { atrPeriod, normLookback, threshold, contractionBars, volPeriod } = rule;
          
          // 1. Calculate ATR
          const atr = ATR.calculate({ high, low, close, period: atrPeriod });
          if (atr.length < normLookback + contractionBars + 1) {
            throw new Error(`Not enough data for ATR or normLookback in ${rule.id}`);
          }
          
          // ATR array is shorter than close array by atrPeriod - 1
          // Let's pad it to align indices
          const paddedAtr = new Array(close.length - atr.length).fill(null).concat(atr);

          // 2. Calculate raw momentum per bar
          const rawMomentum = new Array(close.length).fill(null);
          for (let i = 1; i < close.length; i++) {
            if (paddedAtr[i] !== null) {
              rawMomentum[i] = Math.abs(close[i] - close[i - 1]) / paddedAtr[i];
            }
          }

          // 3. Normalise to 0–10 scale
          const normValue = new Array(close.length).fill(null);
          for (let i = normLookback; i < close.length; i++) {
            if (rawMomentum[i] === null) continue;
            
            // Get rolling max over the last `normLookback` bars (including current)
            let rollingMax = -Infinity;
            for (let j = i - normLookback + 1; j <= i; j++) {
              if (rawMomentum[j] > rollingMax) {
                rollingMax = rawMomentum[j];
              }
            }
            
            if (rollingMax > 0) {
              let val = (rawMomentum[i] / rollingMax) * 10;
              normValue[i] = Math.min(val, 10);
            } else {
              normValue[i] = 0;
            }
          }

          const len = close.length;
          const todayNorm = normValue[len - 1];

          // 4. Detect contraction -> expansion
          let contractionDetected = true;
          for (let i = len - contractionBars - 1; i <= len - 2; i++) {
            if (normValue[i] === null || normValue[i] >= threshold) {
              contractionDetected = false;
              break;
            }
          }
          
          // 5. Volume confirmation
          const recentVols = volume.slice(len - volPeriod - 1, len - 1);
          const volumeMA = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
          const volConfirmed = volume[len - 1] > volumeMA;
          
          // Final rule check
          rulePassed = contractionDetected && todayNorm >= threshold && volConfirmed;
          currentValue = todayNorm !== null ? todayNorm : 0;
          
          const isGreen = close[len - 1] >= close[len - 2];
          const color = isGreen ? '🟢' : '🔴';
          
          details = `Norm Score: ${currentValue.toFixed(2)} ${color} | Contraction: ${contractionDetected} | Vol > MA: ${volConfirmed}`;
          break;
        }

        case 'EMA_TREND_ALIGNMENT': {
          const [p1, p2, p3] = rule.periods;

          const ema21 = EMA.calculate({ period: p1, values: close });
          const ema50 = EMA.calculate({ period: p2, values: close });
          const ema200 = EMA.calculate({ period: p3, values: close });

          const last21 = ema21[ema21.length - 1];
          const last50 = ema50[ema50.length - 1];
          const last200 = ema200[ema200.length - 1];

          rulePassed = last21 > last50 && last50 > last200;
          currentValue = last21;
          details = `EMA21=${last21.toFixed(2)} | EMA50=${last50.toFixed(2)} | EMA200=${last200.toFixed(2)}`;
          break;
        }

        case 'SUPERTREND_BULLISH': {
          const { atrPeriod, multiplier } = rule;
          const len = close.length;

          const tr = [];
          for (let i = 1; i < len; i++) {
            const hl = high[i] - low[i];
            const hpc = Math.abs(high[i] - close[i - 1]);
            const lpc = Math.abs(low[i] - close[i - 1]);
            tr.push(Math.max(hl, hpc, lpc));
          }

          if (tr.length < atrPeriod + 1) {
            rulePassed = false;
            details = 'Insufficient data for ATR';
            break;
          }
          const atr = this._wilderSmooth(tr, atrPeriod);

          const offset = atrPeriod;
          const supertrend = [];

          let prevUpper = 0;
          let prevLower = 0;
          let prevST = 0; 
          let prevClose = close[offset - 1];

          for (let i = 0; i < atr.length; i++) {
            const idx = i + offset;
            const midpoint = (high[idx] + low[idx]) / 2;
            const rawUpper = midpoint + multiplier * atr[i];
            const rawLower = midpoint - multiplier * atr[i];

            const finalUpper = (rawUpper < prevUpper || prevClose > prevUpper) ? rawUpper : prevUpper;
            const finalLower = (rawLower > prevLower || prevClose < prevLower) ? rawLower : prevLower;

            let trend;
            if (prevST === -1 && close[idx] > prevUpper) {
              trend = 1;
            } else if (prevST === 1 && close[idx] < prevLower) {
              trend = -1;
            } else {
              trend = prevST || 1;
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

        case 'RSI_MOMENTUM': {
          const { period, minRsi, maxRsi } = rule;
          const rsiValues = RSI.calculate({ period, values: close });
          const lastRsi = rsiValues[rsiValues.length - 1];

          rulePassed = lastRsi >= minRsi && lastRsi <= maxRsi;
          currentValue = lastRsi;
          details = `RSI(${period})=${lastRsi.toFixed(2)} | Target: ${minRsi}-${maxRsi}`;
          break;
        }

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

          rulePassed = histogramNow > 0 && histogramNow > histogramPrev;
          currentValue = histogramNow;
          details = `Histogram: ${histogramNow?.toFixed(4)} | Prev: ${histogramPrev?.toFixed(4)} | Accelerating: ${histogramNow > histogramPrev}`;
          break;
        }

        case 'BOLLINGER_SQUEEZE_BREAKOUT': {
          const { period, stdDev, squeezeLookback } = rule;
          const bbAll = BollingerBands.calculate({ period, stdDev, values: close });

          if (bbAll.length < squeezeLookback + 1) { rulePassed = false; break; }

          const bandwidths = bbAll.map(b => (b.upper - b.lower) / b.middle);
          const lastBB = bbAll[bbAll.length - 1];
          const lastClose = close[close.length - 1];
          const lastBandwidth = bandwidths[bandwidths.length - 1];

          const recentBandwidths = bandwidths.slice(-squeezeLookback);
          const minBandwidth = Math.min(...recentBandwidths);
          const isSqueeze = lastBandwidth <= minBandwidth * 1.05;

          const isBreakout = lastClose > lastBB.upper;

          rulePassed = isSqueeze && isBreakout;
          currentValue = lastBandwidth;
          details = `Bandwidth=${lastBandwidth.toFixed(4)} | Squeeze=${isSqueeze} | Breakout above upper=${isBreakout}`;
          break;
        }

        case 'ADX_TREND_STRENGTH': {
          const { period, minAdx, strongAdx } = rule;
          const adxResult = ADX.calculate({ period, high, low, close });

          if (!adxResult.length) { rulePassed = false; break; }

          const lastAdx = adxResult[adxResult.length - 1].adx;
          rulePassed = lastAdx >= minAdx;
          currentValue = lastAdx;

          const strengthRatio = Math.min(lastAdx / strongAdx, 1.0);
          details = `ADX(${period})=${lastAdx.toFixed(2)} | Strength ratio: ${(strengthRatio * 100).toFixed(0)}%`;

          rule._strengthRatio = rulePassed ? strengthRatio : 0;
          break;
        }

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
      }
    } catch (err) {
      details = `Error: ${err.message}`;
      rulePassed = false;
    }

    return {
      id: rule.id,
      name: rule.name,
      passed: rulePassed,
      currentValue: currentValue !== null ? Number(Number(currentValue).toFixed(4)) : null,
      threshold: details,
      description: rule.description,
    };
  }

  _wilderSmooth(values, period) {
    const result = [];
    const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(seed);
    for (let i = period; i < values.length; i++) {
      result.push((result[result.length - 1] * (period - 1) + values[i]) / period);
    }
    return result;
  }
}

export default IndicatorEngine;
