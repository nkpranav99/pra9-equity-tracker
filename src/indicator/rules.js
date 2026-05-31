/**
 * @fileoverview Configurable trading indicator rules definition.
 *
 * This file defines YOUR trading indicator conditions.
 * Customize these rules to match your TradingView indicator.
 * The engine evaluates all conditions — a stock passes only when
 * the logic gate (AND/OR) is satisfied across all conditions.
 *
 * Supported condition types:
 *   - RSI            : Relative Strength Index threshold check
 *   - EMA_ABOVE      : Fast EMA above slow EMA (bullish alignment)
 *   - VOLUME_MULTIPLIER : Current volume vs N-period average
 *   - MACD_SIGNAL    : MACD/Signal line crossover detection
 *   - PRICE_ABOVE_MA : Price above a moving average (SMA or EMA)
 *   - BOLLINGER      : Bollinger Band conditions (reserved for future use)
 *
 * Supported operators: '<', '>', '<=', '>=', '=='
 * Supported MACD signals: 'bullish_crossover', 'bearish_crossover'
 */

const rules = {
  name: 'Relative Volume Breakout Strategy',
  description: 'Confidence-based strategy relying on a custom volume breakout baseline.',
  timeframe: 'daily',

  // Confidence thresholds out of 100 max bonus points
  confidence: {
    strong: 80,
    medium: 40,
  },

  conditions: [
    {
      id: 'relative_volume_breakout',
      name: 'Relative Volume Breakout',
      type: 'RELATIVE_VOLUME_BREAKOUT',
      avgPeriod: 20,       // Standard length for average volume
      quietPeriods: 4,     // 4 consecutive days below the line
      threshold: 2.0,      // The horizontal line value (2x average volume)
      mandatory: true,     // Must pass for the stock to be considered
      weight: 0,           // Baseline, doesn't add to bonus points
      description: 'Volume ratio crosses 2.0 after being below 2.0 for 4 days, with bullish price',
    },
    {
      id: 'volume_spike',
      name: 'Volume Spike Confirmation',
      type: 'VOLUME_MULTIPLIER',
      period: 20, 
      operator: '>',
      multiplier: 1.5,
      mandatory: false,
      weight: 20,
      description: 'Current volume > 1.5x average (confirms momentum)',
    },
    {
      id: 'rsi_bullish',
      name: 'RSI Bullish Zone',
      type: 'RSI',
      period: 14,
      operator: '>',
      value: 55,
      mandatory: false,
      weight: 20,
      description: 'RSI(14) > 55 (rules out fakeouts)',
    },
    {
      id: 'ema_9_10_cross',
      name: 'Short-Term Momentum',
      type: 'EMA_ABOVE',
      fastPeriod: 9,
      slowPeriod: 10,
      mandatory: false,
      weight: 20,
      description: 'EMA(9) > EMA(10)',
    },
    {
      id: 'ema_50_200_cross',
      name: 'Long-Term Golden Cross',
      type: 'EMA_ABOVE',
      fastPeriod: 50,
      slowPeriod: 200,
      mandatory: false,
      weight: 20,
      description: 'EMA(50) > EMA(200)',
    },
    {
      id: 'macd_bullish',
      name: 'MACD Bullish',
      type: 'MACD_SIGNAL',
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      signal: 'bullish_crossover',
      mandatory: false,
      weight: 20,
      description: 'MACD line > Signal line',
    },
  ],

  // We no longer rely purely on logic: 'AND'. Engine will compute a confidence score.
  logic: 'CONFIDENCE',
};

export default rules;
