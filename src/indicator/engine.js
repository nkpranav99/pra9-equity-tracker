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

      let rpciBreakdown = null;
      for (const r of results) {
        if (r.rpciResults) {
          rpciBreakdown = r.rpciResults;
          break;
        }
      }

      return { 
        symbol: symbolStr, 
        price: latestPrice,
        passed, 
        score: Number(score.toFixed(2)), 
        maxScore, 
        confidenceLabel, 
        results,
        rpciBreakdown,
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
    let rpciResults = null;

    try {
      switch (rule.type) {
        case 'RPCI_ROHAN_MOMENTUM': {
          const { rpciPassThreshold, contractionBars, maxContractionBars, momentumThreshold, atrPeriod, normLookback, volPeriod } = rule;
          const len = close.length;

          // Helper: safely get value from indicator array aligned to end
          const getInd = (arr, offsetFromEnd) => {
            if (!arr || arr.length === 0) return null;
            const idx = arr.length - 1 - offsetFromEnd;
            return idx >= 0 ? arr[idx] : null;
          };

          // Basic moving averages & indicators
          const sma200 = SMA.calculate({ period: 200, values: close });
          const sma50 = SMA.calculate({ period: 50, values: close });
          const ema21 = EMA.calculate({ period: 21, values: close });
          const ema50 = EMA.calculate({ period: 50, values: close });
          const ema200 = EMA.calculate({ period: 200, values: close });
          const rsi14 = RSI.calculate({ period: 14, values: close });
          const bb20 = BollingerBands.calculate({ period: 20, stdDev: 2, values: close });

          const lastClose = close[len - 1];

          // ---------------------------------------------------------
          // LAYER 1: RPCI CHECKLIST
          // ---------------------------------------------------------
          let rpciScore = 0;
          rpciResults = {};

          // 1. Valuation
          let valPass = false;
          let valLabel = 'N/A';
          const lastSma200 = getInd(sma200, 0);
          if (lastSma200) {
            const ratio = lastClose / lastSma200;
            valPass = ratio < 1.3;
            if (ratio < 0.95) valLabel = 'Undervalued';
            else if (ratio <= 1.15) valLabel = 'Fair Value';
            else valLabel = 'Extended';
          }
          if (valPass) rpciScore++;
          rpciResults.valuation = { passed: valPass, label: valLabel };

          // 2. Earnings Power (ROC63)
          let roc63Pass = false;
          let roc63Label = 'N/A';
          if (len >= 64) {
            const close63 = close[len - 64];
            const roc63 = ((lastClose - close63) / close63) * 100;
            roc63Pass = roc63 > 10;
            if (roc63 > 20) roc63Label = 'Very Strong';
            else if (roc63 > 10) roc63Label = 'Strong';
            else roc63Label = 'Weak';
          }
          if (roc63Pass) rpciScore++;
          rpciResults.earnings = { passed: roc63Pass, label: roc63Label };

          // 3. Momentum (RSI14 & ROC20)
          let momPass = false;
          let momLabel = 'N/A';
          if (len >= 21) {
            const close20 = close[len - 21];
            const roc20 = ((lastClose - close20) / close20) * 100;
            const lastRsi = getInd(rsi14, 0);
            
            if (lastRsi) {
              if (lastRsi > 70 && roc20 > 10) {
                momPass = true;
                momLabel = 'Very Strong momentum';
              } else if (lastRsi > 60 && roc20 > 5) {
                momPass = true;
                momLabel = 'Strong momentum';
              } else {
                momPass = false;
                momLabel = 'Weak';
              }
            }
            
            // 6. Outperformance Proxy (evaluating ROC20 here)
            const outperfPass = roc20 > 8;
            if (outperfPass) rpciScore++;
            rpciResults.outperformance = { passed: outperfPass, label: outperfPass ? 'YES' : 'NO' };
          } else {
            rpciResults.outperformance = { passed: false, label: 'N/A' };
          }
          if (momPass) rpciScore++;
          rpciResults.momentum = { passed: momPass, label: momLabel };

          // 5. Timeframe Alignment
          let tfPass = false;
          const lEma21 = getInd(ema21, 0);
          const lEma50 = getInd(ema50, 0);
          const lEma200 = getInd(ema200, 0);
          if (lEma21 && lEma50 && lEma200) {
            tfPass = (lEma21 > lEma50) && (lEma50 > lEma200);
          }
          if (tfPass) rpciScore++;
          rpciResults.timeframe = { passed: tfPass, label: tfPass ? 'YES' : 'NO' };

          // 7. Institutional Candles
          let instCount = 0;
          if (len >= 20) {
            for (let i = len - 10; i < len; i++) {
              if (i < 20) continue; // safety
              const isGreen = close[i] > data.opens[i]; // wait, do we have opens? yes, data.opens
              if (!isGreen) continue;
              
              const body = close[i] - data.opens[i];
              
              // 10-day avg body
              let sumBody = 0;
              for (let j = i - 10; j < i; j++) {
                sumBody += Math.abs(close[j] - data.opens[j]);
              }
              const avgBody = sumBody / 10;
              
              // 20-day avg vol
              let sumVol = 0;
              for (let j = i - 20; j < i; j++) {
                sumVol += volume[j];
              }
              const avgVol = sumVol / 20;
              
              if (body > 1.5 * avgBody && volume[i] > 1.5 * avgVol) {
                instCount++;
              }
            }
          }
          const instPass = instCount >= 1;
          if (instPass) rpciScore++;
          rpciResults.institutional = { passed: instPass, label: instCount.toString() };

          // 8. Short-term Extension
          let stExtPass = false; // PASS means NOT overextended
          const lastBB = getInd(bb20, 0);
          if (lastBB) {
            stExtPass = lastClose <= lastBB.upper;
          }
          if (stExtPass) rpciScore++;
          rpciResults.stExtension = { passed: stExtPass, label: stExtPass ? 'NO' : 'YES' };

          // 9. Long-term Extension
          let ltExtPass = false;
          if (lastSma200) {
            ltExtPass = lastClose <= (lastSma200 * 1.5);
          }
          if (ltExtPass) rpciScore++;
          rpciResults.ltExtension = { passed: ltExtPass, label: ltExtPass ? 'NO' : 'YES' };

          // 10. Stage Analysis
          let stagePass = false;
          let stageLabel = 'N/A';
          if (lastSma200 && lastSma200 > 0 && len >= 210) {
            const sma200_10d_ago = getInd(sma200, 10);
            const sma200_rising = lastSma200 > sma200_10d_ago;
            
            const lastSma50 = getInd(sma50, 0);
            const sma50_5d_ago = getInd(sma50, 5);
            const sma50_rising = lastSma50 > sma50_5d_ago;
            
            if (lastClose > lastSma200 && sma200_rising && lastClose > lastSma50 && sma50_rising) {
              stagePass = true;
              stageLabel = 'Stage 2 – Uptrend';
            } else if (lastClose > lastSma200 && (!sma50_rising || lastClose <= lastSma50)) {
              stageLabel = 'Stage 3 – Topping';
            } else if (lastClose < lastSma200 && !sma200_rising) {
              stageLabel = 'Stage 4 – Downtrend';
            } else if (lastClose < lastSma200 && sma200_rising) { // simplified basing
              stageLabel = 'Stage 1 – Basing';
            } else {
              stageLabel = 'Mixed';
            }
          }
          if (stagePass) rpciScore++;
          rpciResults.stage = { passed: stagePass, label: stageLabel };

          // ---------------------------------------------------------
          // LAYER 2: ROHAN MOMENTUM BAR (and Sub-check 4)
          // ---------------------------------------------------------
          const atr = ATR.calculate({ high, low, close, period: atrPeriod });
          if (atr.length < normLookback + contractionBars + 1) {
             // Fallback if not enough data, just fail gracefully
             rulePassed = false;
             details = 'Insufficient data for Momentum calculations.';
             break;
          }
          
          const paddedAtr = new Array(close.length - atr.length).fill(null).concat(atr);
          const rawMomentum = new Array(close.length).fill(null);
          for (let i = 1; i < close.length; i++) {
            if (paddedAtr[i] !== null) {
              rawMomentum[i] = Math.abs(close[i] - close[i - 1]) / paddedAtr[i];
            }
          }

          const normValue = new Array(close.length).fill(null);
          for (let i = normLookback; i < close.length; i++) {
            if (rawMomentum[i] === null) continue;
            let rollingMax = -Infinity;
            for (let j = i - normLookback + 1; j <= i; j++) {
              if (rawMomentum[j] > rollingMax) rollingMax = rawMomentum[j];
            }
            if (rollingMax > 0) {
              normValue[i] = Math.min((rawMomentum[i] / rollingMax) * 10, 10);
            } else {
              normValue[i] = 0;
            }
          }

          const todayNorm = normValue[len - 1] !== null ? normValue[len - 1] : 0;
          
          let contractionCount = 0;
          for (let i = len - 2; i >= 0; i--) {
            if (normValue[i] === null || normValue[i] >= momentumThreshold) break;
            contractionCount++;
            if (contractionCount >= maxContractionBars) break;
          }
          
          const contractionValid = contractionCount >= contractionBars && contractionCount <= maxContractionBars;
          const expansionValid = todayNorm >= momentumThreshold;
          const patternDetected = contractionValid && expansionValid;
          
          // Short-term resistance check
          let resistance = -Infinity;
          for (let i = len - 11; i <= len - 2; i++) {
            if (i >= 0 && high[i] > resistance) {
              resistance = high[i];
            }
          }
          const resistanceBreakout = lastClose > resistance;
          const highConviction = patternDetected && resistanceBreakout;
          
          // 4. Price Contraction sub-check
          if (patternDetected) rpciScore++;
          
          let contractionLabel = '';
          if (patternDetected && highConviction) contractionLabel = 'YES + Breakout';
          else if (patternDetected && !highConviction) contractionLabel = 'YES';
          else if (!patternDetected && todayNorm >= momentumThreshold) contractionLabel = 'NO (Already ran)';
          else if (!patternDetected && contractionCount > maxContractionBars) contractionLabel = 'NO (Pattern stale)';
          else contractionLabel = 'NO (Building...)';
          
          rpciResults.contraction = { passed: patternDetected, label: contractionLabel };
          rpciResults.patternDetected = patternDetected;
          rpciResults.highConviction = highConviction;
          rpciResults.resistanceBreakout = resistanceBreakout;
          rpciResults.contractionCount = contractionCount;
          
          // ---------------------------------------------------------
          // FINAL EVALUATION
          // ---------------------------------------------------------
          
          let rpciLabel = '';
          if (rpciScore >= 9) rpciLabel = 'Strongly Favourable';
          else if (rpciScore >= 7) rpciLabel = 'Favourable';
          else if (rpciScore >= 5) rpciLabel = 'Neutral';
          else rpciLabel = 'Unfavourable';
          
          rpciResults.score = rpciScore;
          rpciResults.label = rpciLabel;
          
          // Condition A: RPCI Score >= 7
          const condA = rpciScore >= rpciPassThreshold;
          
          // Condition B: Price Contraction = PASS
          const condB = patternDetected;
          
          // Condition C: Volume confirmation
          let condC = false;
          if (len >= volPeriod + 1) {
            const recentVols = volume.slice(len - volPeriod - 1, len - 1);
            const volumeMA = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
            condC = volume[len - 1] > volumeMA;
          }
          
          rulePassed = condA && condB && condC;
          currentValue = todayNorm;
          
          const isGreen = close[len - 1] >= close[len - 2];
          const color = isGreen ? '🟢' : '🔴';
          
          details = `Norm Score: ${currentValue.toFixed(2)} ${color} | Contraction: ${patternDetected} | Vol > MA: ${condC}`;
          
          // Inject rpciBreakdown into rule result object
          // Since the caller expects primitive types usually, we attach it to 'this' or 
          // we modify how evaluateCondition returns things. 
          // Wait, _evaluateCondition just returns an object that is added to condition results.
          // Let's add rpciBreakdown to the returned object.
          break; // The breakdown will be appended below
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

    const result = {
      id: rule.id,
      name: rule.name,
      passed: rulePassed,
      currentValue: currentValue !== null ? Number(Number(currentValue).toFixed(4)) : null,
      threshold: details,
      description: rule.description,
    };

    if (rpciResults) {
      result.rpciResults = rpciResults;
    }

    return result;
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
