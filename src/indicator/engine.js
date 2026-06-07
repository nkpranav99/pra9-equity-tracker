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
      const opens = candles.map((c) => c.open);

      const results = [];
      for (const condition of this.rules.conditions) {
        const result = this._evaluateCondition(condition, { closes, highs, lows, volumes, opens, candles });
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
    const { closes: close, highs: high, lows: low, volumes: volume, opens } = data;
    let rulePassed = false;
    let currentValue = null;
    let details = '';
    let rpciResults = null;

    try {
      switch (rule.type) {
        case 'RPCI_ROHAN_MOMENTUM': {
          const { rpciPassThreshold, valuationPassThreshold = 1.5, earningsPowerMinConsistency = 0.55, contractionBars, maxContractionBars, momentumThreshold, atrPeriod, normLookback, volPeriod } = rule;
          
          if (!close || close.length < 100) {
            rulePassed = false;
            details = 'Insufficient Data';
            rpciResults = { score: 0, label: 'Insufficient Data', subchecks: {} };
            break;
          }
          const len = close.length;

          const safeGet = (arr, idx) => (idx >= 0 && idx < arr.length) ? arr[idx] : null;
          const safeSlice = (arr, from, to) => {
            const start = Math.max(0, from);
            const end = Math.min(arr.length, to ?? arr.length);
            return start < end ? arr.slice(start, end) : [];
          };

          // Helper: safely get value from indicator array aligned to end
          const getInd = (arr, offsetFromEnd) => {
            if (!arr || arr.length === 0) return null;
            const idx = arr.length - 1 - offsetFromEnd;
            return safeGet(arr, idx);
          };

          // Basic moving averages & indicators
          const sma200 = SMA.calculate({ period: 200, values: close });
          const sma50 = SMA.calculate({ period: 50, values: close });
          const ema21 = EMA.calculate({ period: 21, values: close });
          const ema50 = EMA.calculate({ period: 50, values: close });
          const ema200 = EMA.calculate({ period: 200, values: close });
          const rsi14 = RSI.calculate({ period: 14, values: close });
          const bb20 = BollingerBands.calculate({ period: 20, stdDev: 2, values: close });

          const lastClose = safeGet(close, len - 1);

          // ---------------------------------------------------------
          // LAYER 1: RPCI CHECKLIST
          // ---------------------------------------------------------
          let rpciScore = 0;
          rpciResults = {};

          // 1. Valuation (Fix 2: EMA200 + label adjusted)
          let valPass = false;
          let valLabel = 'N/A';
          const lastEma200 = getInd(ema200, 0);
          if (lastEma200) {
            const ratio = lastClose / lastEma200;
            valPass = ratio < 2.0; // PASS if ratio < 2.0
            if (ratio < 1.2) valLabel = 'Deeply Undervalued';
            else if (ratio < 1.5) valLabel = 'Undervalued';
            else if (ratio < 2.0) valLabel = 'Reasonably valued';
            else valLabel = 'Extended';
            // Debug log
            if (global.logger) global.logger.debug({ ratio, valPass }, '[VALUATION RAW]');
          }
          if (valPass) rpciScore++;
          rpciResults.valuation = { passed: valPass, label: valLabel };

          // 2. Earnings Power (Fix 3: Trend Consistency)
          let earnPass = false;
          let earnLabel = 'N/A';
          const last60 = safeSlice(close, len - 60, len);
          if (last60.length > 1) {
            let upDays = 0;
            for (let i = 1; i < last60.length; i++) {
              if (last60[i] > last60[i - 1]) upDays++;
            }
            const consistency = upDays / 60;
            earnPass = consistency >= earningsPowerMinConsistency;
            if (consistency >= 0.65) earnLabel = 'Strong';
            else if (consistency >= 0.55) earnLabel = 'Moderate';
            else earnLabel = 'Weak';
            // Debug log
            if (global.logger) global.logger.debug({ consistency, upDays, earnPass }, '[EARNINGS RAW]');
          }
          if (earnPass) rpciScore++;
          rpciResults.earnings = { passed: earnPass, label: earnLabel };

          // 3. Momentum (RSI14 & ROC20)
          let momPass = false;
          let momLabel = 'N/A';
          const close20 = safeGet(close, len - 21);
          if (close20 !== null) {
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
          }
          if (momPass) rpciScore++;
          rpciResults.momentum = { passed: momPass, label: momLabel };
          
          // 6. Outperformance Proxy (Fix 4: ROC60 > 15%)
          let outperfPass = false;
          const close60 = safeGet(close, len - 61);
          if (close60 !== null && close60 > 0) {
             const roc60 = ((lastClose - close60) / close60) * 100;
             outperfPass = roc60 > 15;
             if (global.logger) global.logger.debug({ roc60, outperfPass }, '[OUTPERF RAW]');
          }
          if (outperfPass) rpciScore++;
          rpciResults.outperformance = { passed: outperfPass, label: outperfPass ? 'YES' : 'NO' };

          // 5. Timeframe Alignment
          let tfPass = false;
          const lEma21 = getInd(ema21, 0);
          const lEma50 = getInd(ema50, 0);
          if (lEma21 && lEma50 && lastEma200) {
            tfPass = (lEma21 > lEma50) && (lEma50 > lastEma200);
          }
          if (tfPass) rpciScore++;
          rpciResults.timeframe = { passed: tfPass, label: tfPass ? 'YES' : 'NO' };

          // 7. Institutional Candles (Fix 5: Tightened Criteria)
          let instCount = 0;
          if (len >= 20) {
            for (let i = len - 10; i < len; i++) {
              if (i < 20) continue; // safety
              const cClose = safeGet(close, i);
              const cOpen = safeGet(data.opens, i);
              const cVol = safeGet(volume, i);
              const cHigh = safeGet(high, i);
              const cLow = safeGet(low, i);
              if (cClose === null || cOpen === null || cVol === null || cHigh === null || cLow === null) continue;
              
              const isGreen = cClose > cOpen;
              if (!isGreen) continue;
              
              const body = cClose - cOpen;
              const range = cHigh - cLow;
              if (range === 0) continue;
              if (body / range <= 0.6) continue; // must be > 60% of candle range
              
              // 20-day avg body
              let sumBody = 0;
              let bodyValidCount = 0;
              for (let j = i - 20; j < i; j++) {
                const jClose = safeGet(close, j);
                const jOpen = safeGet(data.opens, j);
                if (jClose !== null && jOpen !== null) {
                  sumBody += Math.abs(jClose - jOpen);
                  bodyValidCount++;
                }
              }
              const avgBody = bodyValidCount > 0 ? (sumBody / bodyValidCount) : 0;
              
              // 20-day avg vol
              let sumVol = 0;
              let volValidCount = 0;
              for (let j = i - 20; j < i; j++) {
                const jVol = safeGet(volume, j);
                if (jVol !== null) {
                  sumVol += jVol;
                  volValidCount++;
                }
              }
              const avgVol = volValidCount > 0 ? (sumVol / volValidCount) : 0;
              
              if (body > 2.0 * avgBody && cVol > 2.0 * avgVol) {
                instCount++;
              }
            }
          }
          const instPass = instCount >= 1;
          if (instPass) rpciScore++;
          rpciResults.institutional = { passed: instPass, label: instCount.toString() };
          if (global.logger) global.logger.debug({ instCount }, '[INSTITUTIONS RAW]');

          // 8. Short-term Extension
          let stExtPass = false; // PASS means NOT overextended
          const lastBB = getInd(bb20, 0);
          if (lastBB && lastBB.upper !== undefined) {
            stExtPass = lastClose <= lastBB.upper;
            if (global.logger) global.logger.debug({ lastClose, upperBB: lastBB.upper, stExtPass }, '[ST EXT RAW]');
          }
          if (stExtPass) rpciScore++;
          rpciResults.stExtension = { passed: stExtPass, label: stExtPass ? 'NO' : 'YES' };

          // 9. Long-term Extension (Fix 6: Use EMA200 ratio)
          let ltExtPass = false; // PASS means NOT overextended
          if (lastEma200) {
            const ratioLT = lastClose / lastEma200;
            ltExtPass = ratioLT < 2.0; 
            if (global.logger) global.logger.debug({ ratioLT, ltExtPass }, '[LT EXT RAW]');
          }
          if (ltExtPass) rpciScore++;
          rpciResults.ltExtension = { passed: ltExtPass, label: ltExtPass ? 'NO' : 'YES' };

          // 10. Stage Analysis
          let stagePass = false;
          let stageLabel = 'N/A';
          const lastSma200 = getInd(sma200, 0);
          if (lastSma200 && lastSma200 > 0 && len >= 210) {
            const sma200_10d_ago = getInd(sma200, 10);
            const sma200_rising = lastSma200 > sma200_10d_ago;
            
            const lastSma50 = getInd(sma50, 0);
            const sma50_5d_ago = getInd(sma50, 5);
            const sma50_rising = lastSma50 > sma50_5d_ago;
            
            if (lastClose > lastSma200 && sma200_rising && lastClose > lastSma50 && sma50_rising) {
              stagePass = true;
              stageLabel = 'Stage 2 - Uptrend'; // Matching screenshot capitalization
            } else if (lastClose > lastSma200 && (!sma50_rising || lastClose <= lastSma50)) {
              stageLabel = 'Stage 3 - Topping';
            } else if (lastClose < lastSma200 && !sma200_rising) {
              stageLabel = 'Stage 4 - Downtrend';
            } else if (lastClose < lastSma200 && sma200_rising) { // simplified basing
              stageLabel = 'Stage 1 - Basing';
            } else {
              stageLabel = 'Mixed';
            }
          }
          if (stagePass) rpciScore++;
          rpciResults.stage = { passed: stagePass, label: stageLabel };

          // ---------------------------------------------------------
          // LAYER 2: ROHAN MOMENTUM BAR (and Sub-check 4)
          // ---------------------------------------------------------
          const { contractionDepthThreshold = 1.5, expansionStrengthThreshold = 2.5 } = rule;
          const atr = ATR.calculate({ high, low, close, period: atrPeriod });
          if (atr.length < normLookback + contractionBars + 1) {
             rulePassed = false;
             details = 'Insufficient data for Momentum calculations.';
             break;
          }
          
          const paddedAtr = new Array(close.length - atr.length).fill(null).concat(atr);
          const rawMomentum = new Array(close.length).fill(null);
          for (let i = 1; i < close.length; i++) {
            const padAtrI = safeGet(paddedAtr, i);
            const cI = safeGet(close, i);
            const cIPrev = safeGet(close, i - 1);
            if (padAtrI !== null && padAtrI > 0 && cI !== null && cIPrev !== null) {
              rawMomentum[i] = Math.abs(cI - cIPrev) / padAtrI;
            }
          }

          const normValue = new Array(close.length).fill(null);
          for (let i = normLookback; i < close.length; i++) {
            if (safeGet(rawMomentum, i) === null) continue;
            let rollingMax = -Infinity;
            for (let j = i - normLookback + 1; j <= i; j++) {
              const val = safeGet(rawMomentum, j);
              if (val !== null && val > rollingMax) rollingMax = val;
            }
            if (rollingMax > 0) {
              normValue[i] = Math.min((safeGet(rawMomentum, i) / rollingMax) * 10, 10);
            } else {
              normValue[i] = 0;
            }
          }

          const todayNorm = safeGet(normValue, len - 1) !== null ? safeGet(normValue, len - 1) : 0;
          
          // Calculate contraction count INCLUDING today (for State A)
          let contractionCountIncToday = 0;
          for (let i = len - 1; i >= 0; i--) {
            const val = safeGet(normValue, i);
            if (val === null || val >= momentumThreshold) break;
            contractionCountIncToday++;
            if (contractionCountIncToday >= maxContractionBars + 1) break; 
          }
          
          // Calculate contraction count EXCLUDING today (for State B)
          let contractionCountBeforeToday = 0;
          let sumContractionDepth = 0;
          for (let i = len - 2; i >= 0; i--) {
            const val = safeGet(normValue, i);
            if (val === null || val >= momentumThreshold) break;
            contractionCountBeforeToday++;
            sumContractionDepth += val;
            if (contractionCountBeforeToday >= maxContractionBars) break;
          }
          
          // Quality Check A: Contraction Depth
          const avgContraction = contractionCountBeforeToday > 0 ? (sumContractionDepth / contractionCountBeforeToday) : 0;
          const contractionDepthValid = contractionCountBeforeToday > 0 && avgContraction < contractionDepthThreshold;
          
          // State A: Is Contraction In Progress? (Sub-check 4)
          const contractionInProgress = contractionCountIncToday >= contractionBars && contractionCountIncToday <= maxContractionBars;
          
          // Quality Check B: Expansion Candle Strength
          const expansionStrengthValid = todayNorm >= expansionStrengthThreshold;
          
          // Quality Check C: Price Candle Confirmation (Green)
          const todayOpen = safeGet(data.opens, len - 1);
          const expansionCandleGreen = todayOpen !== null ? lastClose >= todayOpen : false;
          
          // State B: Did Expansion Fire Today? (Mandatory Gate)
          const contractionBeforeTodayValid = contractionCountBeforeToday >= contractionBars && contractionCountBeforeToday <= maxContractionBars;
          const expansionFiredToday = contractionBeforeTodayValid && todayNorm >= momentumThreshold && contractionDepthValid && expansionStrengthValid && expansionCandleGreen;
          
          // Short-term resistance check
          let resistance = -Infinity;
          for (let i = len - 11; i <= len - 2; i++) {
            const hI = safeGet(high, i);
            if (hI !== null && hI > resistance) {
              resistance = hI;
            }
          }
          const resistanceBreakout = lastClose > resistance;
          
          // 4. Price Contraction sub-check
          if (contractionInProgress) rpciScore++;
          
          let contractionLabel = '';
          if (contractionInProgress) {
            contractionLabel = 'YES';
          } else if (contractionCountIncToday > 0 && contractionCountIncToday < contractionBars && todayNorm < momentumThreshold) {
            contractionLabel = 'NO (Building...)';
          } else if (expansionFiredToday) {
            contractionLabel = 'NO (Already ran)';
          } else if (contractionCountIncToday > maxContractionBars) {
            contractionLabel = 'NO (Stale)';
          } else {
            contractionLabel = 'NO';
          }
          
          rpciResults.contraction = { passed: contractionInProgress, label: contractionLabel };
          
          // Update internal breakdowns for formatter
          rpciResults.patternDetected = expansionFiredToday;
          rpciResults.resistanceBreakout = resistanceBreakout;
          rpciResults.contractionCount = contractionCountBeforeToday;
          
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
          
          // Condition B: Price Contraction = PASS (meaning expansion fired today)
          const condB = expansionFiredToday;
          
          // Condition C: Volume confirmation
          let condC = false;
          if (len >= volPeriod + 1) {
            const recentVols = safeSlice(volume, len - volPeriod - 1, len - 1);
            if (recentVols.length > 0) {
              const volumeMA = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
              condC = safeGet(volume, len - 1) > volumeMA;
            }
          }
          
          rulePassed = condA && condB && condC;
          
          // 🔥 highConviction requires everything to pass + resistance breakout
          const highConviction = rulePassed && resistanceBreakout;
          rpciResults.highConviction = highConviction;
          
          currentValue = todayNorm;
          
          // Format details string for Telegram Output
          let contractionStr = '';
          if (contractionBeforeTodayValid) {
            contractionStr = `Contraction: ${contractionCountBeforeToday} bars (avg depth: ${avgContraction.toFixed(2)}) ${contractionDepthValid ? '✅' : '❌'}`;
          } else {
            contractionStr = `Contraction: ${contractionCountBeforeToday} bars (need ${contractionBars} minimum) ❌`;
          }
          
          let expansionStr = '';
          if (todayNorm >= expansionStrengthThreshold) {
            expansionStr = `Expansion: normValue=${todayNorm.toFixed(2)} ✅`;
          } else {
            expansionStr = `Expansion: normValue=${todayNorm.toFixed(2)} — too weak (need ${expansionStrengthThreshold}) ❌`;
          }
          
          let greenStr = `Green candle: ${expansionCandleGreen ? 'YES ✅' : 'NO ❌'}`;
          let volStr = `Vol > MA: ${condC ? 'true ✅' : 'false ❌'}`;
          
          details = `${contractionStr}\n     ${expansionStr} | ${greenStr}\n     ${volStr}`;
          
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
