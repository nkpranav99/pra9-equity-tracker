/**
 * @fileoverview Indicator evaluation engine.
 *
 * Consumes OHLCV data via a DataFetcher and evaluates configurable
 * technical indicator rules against each stock symbol. Returns a
 * structured result with per-condition pass/fail details.
 */

import { RSI, EMA, SMA, MACD, BollingerBands } from 'technicalindicators';
import logger from '../utils/logger.js';
import rules from './rules.js';

/**
 * @typedef {Object} ConditionResult
 * @property {string}  id           - Condition identifier
 * @property {string}  name         - Human-readable condition name
 * @property {boolean} passed       - Whether the condition was satisfied
 * @property {number}  [currentValue] - The computed indicator value
 * @property {string}  [threshold]  - Human-readable threshold description
 * @property {string}  description  - Condition description from rules
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {string}            symbol    - Stock symbol evaluated
 * @property {boolean}           passed    - Overall pass/fail
 * @property {string}            [error]   - Error message if evaluation failed
 * @property {ConditionResult[]} results   - Per-condition results
 * @property {string}            timestamp - ISO timestamp of evaluation
 */

class IndicatorEngine {
  /**
   * @param {import('./data-fetcher.js').default} dataFetcher - OHLCV data provider
   * @param {Object} [customRules] - Optional override for the default rules
   */
  constructor(dataFetcher, customRules) {
    this.dataFetcher = dataFetcher;
    this.rules = customRules || rules;
  }

  /**
   * Evaluate all indicator conditions for a stock.
   *
   * @param {string} symbol - Stock symbol (e.g., 'RELIANCE')
   * @returns {Promise<EvaluationResult>}
   */
  async evaluate(stockOrSymbol) {
    // Handle both string 'RELIANCE' or object { symbol: 'RELIANCE', price: 2400 }
    const symbolStr = typeof stockOrSymbol === 'object' ? stockOrSymbol.symbol : stockOrSymbol;
    const initialPrice = typeof stockOrSymbol === 'object' ? stockOrSymbol.price : undefined;

    try {
      // 1. Fetch OHLCV data for the symbol
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

      // 2. Extract price/volume arrays
      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const volumes = candles.map((c) => c.volume);

      // 3. Evaluate each condition
      const results = [];
      for (const condition of this.rules.conditions) {
        const result = this._evaluateCondition(condition, { closes, highs, lows, volumes, candles });
        // Attach scoring metadata from rules
        result.mandatory = condition.mandatory === true;
        result.weight = condition.weight || 0;
        results.push(result);
      }

      // 4. Determine overall pass/fail based on logic gate
      let passed = false;
      let score = 0;
      let maxScore = 0;
      let confidenceLabel = 'None';

      if (this.rules.logic === 'CONFIDENCE') {
        // Compute score for all evaluated conditions
        results.forEach(r => {
          maxScore += r.weight;
          if (r.passed) score += r.weight;
        });
        
        // Determine label based on score
        const strong = this.rules.confidence?.strong || 80;
        const medium = this.rules.confidence?.medium || 40;
        
        if (score >= strong) confidenceLabel = 'Strong';
        else if (score >= medium) confidenceLabel = 'Medium';
        else confidenceLabel = 'Low';

        // Must pass all mandatory conditions to be fully qualified
        const mandatoryPassed = results.filter(r => r.mandatory).every(r => r.passed);
        if (mandatoryPassed) {
          passed = true;
        }
      } else {
        // Fallback for strict AND/OR
        passed = this.rules.logic === 'AND'
          ? results.every((r) => r.passed)
          : results.some((r) => r.passed);
      }

      // 5. Build final result
      const latestPrice = closes[closes.length - 1];

      logger.debug(
        { symbol: symbolStr, passed, score, confidenceLabel, conditionsPassed: results.filter((r) => r.passed).length, total: results.length },
        'Indicator evaluation complete'
      );

      return { 
        symbol: symbolStr, 
        price: latestPrice,
        passed, 
        score, 
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

  /**
   * Route a condition to the appropriate evaluator.
   *
   * @param {Object} condition - Rule condition object
   * @param {Object} data - { closes, highs, lows, volumes, candles }
   * @returns {ConditionResult}
   * @private
   */
  _evaluateCondition(condition, data) {
    try {
      switch (condition.type) {
        case 'RSI':
          return this._evalRSI(condition, data.closes);
        case 'EMA_ABOVE':
          return this._evalEMAAbove(condition, data.closes);
        case 'VOLUME_MULTIPLIER':
          return this._evalVolumeMultiplier(condition, data.volumes);
        case 'MACD_SIGNAL':
          return this._evalMACDSignal(condition, data.closes);
        case 'PRICE_ABOVE_MA':
          return this._evalPriceAboveMA(condition, data.closes);
        case 'BOLLINGER':
          return this._evalBollinger(condition, data);
        case 'RELATIVE_VOLUME_BREAKOUT':
          return this._evalRelativeVolumeBreakout(condition, data);
        default:
          logger.warn({ conditionType: condition.type }, 'Unknown condition type');
          return {
            id: condition.id,
            name: condition.name,
            passed: false,
            currentValue: null,
            threshold: 'Unknown condition type',
            description: condition.description,
          };
      }
    } catch (err) {
      logger.error({ conditionId: condition.id, err: err.message }, 'Condition evaluation error');
      return {
        id: condition.id,
        name: condition.name,
        passed: false,
        currentValue: null,
        threshold: `Error: ${err.message}`,
        description: condition.description,
      };
    }
  }

  // ─── Individual Indicator Evaluators ─────────────────────────────────

  /**
   * Evaluate RSI condition.
   * Computes RSI for the given period and checks against the threshold
   * using the configured operator.
   *
   * @param {Object} condition - { period, operator, value }
   * @param {number[]} closes  - Array of closing prices
   * @returns {ConditionResult}
   * @private
   */
  _evalRSI(condition, closes) {
    const { id, name, description, period, operator, value } = condition;

    const rsiValues = RSI.calculate({ values: closes, period });

    if (rsiValues.length === 0) {
      return { id, name, passed: false, currentValue: null, threshold: `RSI(${period}) ${operator} ${value}`, description };
    }

    const latestRSI = rsiValues[rsiValues.length - 1];
    const passed = this._compare(latestRSI, operator, value);

    return {
      id,
      name,
      passed,
      currentValue: Math.round(latestRSI * 100) / 100,
      threshold: `RSI(${period}) ${operator} ${value}`,
      description,
    };
  }

  /**
   * Evaluate EMA bullish alignment (fast EMA above slow EMA).
   *
   * @param {Object} condition - { fastPeriod, slowPeriod }
   * @param {number[]} closes  - Array of closing prices
   * @returns {ConditionResult}
   * @private
   */
  _evalEMAAbove(condition, closes) {
    const { id, name, description, fastPeriod, slowPeriod } = condition;

    const fastEMA = EMA.calculate({ values: closes, period: fastPeriod });
    const slowEMA = EMA.calculate({ values: closes, period: slowPeriod });

    if (fastEMA.length === 0 || slowEMA.length === 0) {
      return {
        id, name, passed: false, currentValue: null,
        threshold: `EMA(${fastPeriod}) > EMA(${slowPeriod})`, description,
      };
    }

    const latestFast = fastEMA[fastEMA.length - 1];
    const latestSlow = slowEMA[slowEMA.length - 1];
    const passed = latestFast > latestSlow;

    return {
      id,
      name,
      passed,
      currentValue: Math.round(latestFast * 100) / 100,
      threshold: `EMA(${fastPeriod})=${Math.round(latestFast * 100) / 100} > EMA(${slowPeriod})=${Math.round(latestSlow * 100) / 100}`,
      description,
    };
  }

  /**
   * Evaluate volume spike condition.
   * Checks if the latest volume exceeds the N-period average volume
   * multiplied by the given multiplier.
   *
   * @param {Object} condition - { period, operator, multiplier }
   * @param {number[]} volumes - Array of volume values
   * @returns {ConditionResult}
   * @private
   */
  _evalVolumeMultiplier(condition, volumes) {
    const { id, name, description, period, operator, multiplier } = condition;

    if (volumes.length < period + 1) {
      return {
        id, name, passed: false, currentValue: null,
        threshold: `Vol > ${multiplier}x avg(${period})`, description,
      };
    }

    // Average volume over the preceding `period` candles (excluding the latest)
    const recentVolumes = volumes.slice(-(period + 1), -1);
    const avgVolume = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length;
    const latestVolume = volumes[volumes.length - 1];
    const ratio = avgVolume > 0 ? latestVolume / avgVolume : 0;
    const passed = this._compare(ratio, operator, multiplier);

    return {
      id,
      name,
      passed,
      currentValue: Math.round(ratio * 100) / 100,
      threshold: `Volume ratio ${operator} ${multiplier}x (avg ${Math.round(avgVolume).toLocaleString('en-IN')})`,
      description,
    };
  }

  /**
   * Evaluate MACD signal crossover condition.
   * A bullish crossover means: MACD[-1] > Signal[-1] AND MACD[-2] <= Signal[-2]
   * A bearish crossover means: MACD[-1] < Signal[-1] AND MACD[-2] >= Signal[-2]
   *
   * @param {Object} condition - { fastPeriod, slowPeriod, signalPeriod, signal }
   * @param {number[]} closes  - Array of closing prices
   * @returns {ConditionResult}
   * @private
   */
  _evalMACDSignal(condition, closes) {
    const { id, name, description, fastPeriod, slowPeriod, signalPeriod, signal } = condition;

    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    // Need at least 2 data points to detect a crossover
    if (macdResult.length < 2) {
      return {
        id, name, passed: false, currentValue: null,
        threshold: `MACD ${signal}`, description,
      };
    }

    const current = macdResult[macdResult.length - 1];
    const previous = macdResult[macdResult.length - 2];

    // Guard against undefined MACD/signal values (can happen with sparse data)
    if (
      current.MACD == null || current.signal == null ||
      previous.MACD == null || previous.signal == null
    ) {
      return {
        id, name, passed: false, currentValue: null,
        threshold: `MACD ${signal} (insufficient computed values)`, description,
      };
    }

    let passed = false;
    if (signal === 'bullish_crossover') {
      // MACD crossed above signal in the most recent candle
      passed = current.MACD > current.signal && previous.MACD <= previous.signal;
    } else if (signal === 'bearish_crossover') {
      // MACD crossed below signal in the most recent candle
      passed = current.MACD < current.signal && previous.MACD >= previous.signal;
    }

    return {
      id,
      name,
      passed,
      currentValue: Math.round(current.MACD * 100) / 100,
      threshold: `MACD(${fastPeriod},${slowPeriod},${signalPeriod}) ${signal} | MACD=${Math.round(current.MACD * 100) / 100}, Signal=${Math.round(current.signal * 100) / 100}`,
      description,
    };
  }

  /**
   * Evaluate price-above-moving-average condition.
   * Supports both SMA and EMA.
   *
   * @param {Object} condition - { maType, period }
   * @param {number[]} closes  - Array of closing prices
   * @returns {ConditionResult}
   * @private
   */
  _evalPriceAboveMA(condition, closes) {
    const { id, name, description, maType, period } = condition;

    let maValues;
    if (maType === 'EMA') {
      maValues = EMA.calculate({ values: closes, period });
    } else {
      // Default to SMA
      maValues = SMA.calculate({ values: closes, period });
    }

    if (maValues.length === 0) {
      return {
        id, name, passed: false, currentValue: null,
        threshold: `Price > ${maType}(${period})`, description,
      };
    }

    const latestMA = maValues[maValues.length - 1];
    const latestClose = closes[closes.length - 1];
    const passed = latestClose > latestMA;

    return {
      id,
      name,
      passed,
      currentValue: Math.round(latestClose * 100) / 100,
      threshold: `Price (${Math.round(latestClose * 100) / 100}) > ${maType}(${period}) (${Math.round(latestMA * 100) / 100})`,
      description,
    };
  }

  /**
   * Evaluate Bollinger Band condition (reserved for future expansion).
   * Currently supports checking if price is below the lower band
   * or above the upper band.
   *
   * @param {Object} condition - { period, stdDev, band, operator, ... }
   * @param {Object} data      - { closes, highs, lows, volumes }
   * @returns {ConditionResult}
   * @private
   */
  _evalBollinger(condition, data) {
    const { id, name, description } = condition;
    const period = condition.period || 20;
    const stdDev = condition.stdDev || 2;
    const band = condition.band || 'lower'; // 'upper' or 'lower'
    const operator = condition.operator || '<';

    const bbResult = BollingerBands.calculate({
      values: data.closes,
      period,
      stdDev,
    });

    if (bbResult.length === 0) {
      return {
        id, name, passed: false, currentValue: null,
        threshold: `Bollinger(${period}, ${stdDev})`, description,
      };
    }

    const latest = bbResult[bbResult.length - 1];
    const latestClose = data.closes[data.closes.length - 1];
    const targetBand = band === 'upper' ? latest.upper : latest.lower;
    const passed = this._compare(latestClose, operator, targetBand);

    return {
      id,
      name,
      passed,
      currentValue: Math.round(latestClose * 100) / 100,
      threshold: `Price ${operator} BB ${band}(${Math.round(targetBand * 100) / 100})`,
      description,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /**
   * Evaluate Relative Volume Breakout Indicator.
   * Checks if Volume / SMA(Volume) ratio is below threshold for 'quietPeriods',
   * and crosses above threshold on the current candle, with bullish price action.
   *
   * @param {Object} condition - { avgPeriod, quietPeriods, threshold }
   * @param {Object} data - { closes, volumes, ... }
   * @returns {ConditionResult}
   * @private
   */
  _evalRelativeVolumeBreakout(condition, data) {
    const { id, name, description, avgPeriod = 20, quietPeriods = 4, threshold = 2.0 } = condition;
    const { closes, volumes } = data;

    if (volumes.length < avgPeriod + quietPeriods + 1) {
      return { 
        id, name, passed: false, currentValue: null, 
        threshold: `Requires ${avgPeriod + quietPeriods + 1} periods`, description 
      };
    }

    const volSMA = SMA.calculate({ values: volumes, period: avgPeriod });
    
    // We need at least quietPeriods + 1 values in volSMA to do the check
    if (volSMA.length < quietPeriods + 1) {
      return { 
        id, name, passed: false, currentValue: null, 
        threshold: `Insufficient SMA data`, description 
      };
    }

    let passed = true;
    let reason = "Conditions met";
    
    const currentVolRatio = volumes[volumes.length - 1] / volSMA[volSMA.length - 1];
    
    if (currentVolRatio < threshold) {
      passed = false;
      reason = `Current ratio ${currentVolRatio.toFixed(2)} < ${threshold}`;
    } else {
      // Check the quiet periods (bars before current)
      for (let i = 1; i <= quietPeriods; i++) {
        const ratio = volumes[volumes.length - 1 - i] / volSMA[volSMA.length - 1 - i];
        if (ratio >= threshold) {
          passed = false;
          reason = `Period -${i} ratio ${ratio.toFixed(2)} >= ${threshold}`;
          break;
        }
      }
    }
    
    // Check bullish trend
    if (passed) {
      const isBullish = closes[closes.length - 1] > closes[closes.length - 2];
      if (!isBullish) {
        passed = false;
        reason = `Price is not bullish (Close <= Prev Close)`;
      }
    }

    return {
      id,
      name,
      passed,
      currentValue: Math.round(currentVolRatio * 100) / 100,
      threshold: `Ratio >= ${threshold} after ${quietPeriods} quiet, Bullish`,
      description: reason
    };
  }

  /**
   * Generic comparator for operator-based conditions.
   *
   * @param {number} a        - Left-hand value
   * @param {string} operator - One of '<', '>', '<=', '>=', '=='
   * @param {number} b        - Right-hand value
   * @returns {boolean}
   * @private
   */
  _compare(a, operator, b) {
    switch (operator) {
      case '<':  return a < b;
      case '>':  return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      case '==': return Math.abs(a - b) < Number.EPSILON;
      default:
        logger.warn({ operator }, 'Unknown operator, defaulting to false');
        return false;
    }
  }
}

export default IndicatorEngine;
