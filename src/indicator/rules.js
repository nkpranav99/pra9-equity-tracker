/**
 * @fileoverview Configurable trading indicator rules definition.
 *
 * This file defines YOUR trading indicator conditions.
 * The engine evaluates all conditions — a stock passes only when
 * the logic gate (AND/OR) is satisfied across all conditions.
 *
 * Current Logic: WEIGHTED (Confidence Score out of 100)
 */

const rules = {
  name: 'Multi-Timeframe Breakout Strategy',
  description: 'Confidence-based strategy relying on a custom volume breakout baseline with secondary confirmations.',
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
      type: 'RPCI_ROHAN_MOMENTUM',
      weight: 20,
      mandatory: true,
      rpciPassThreshold: 7,
      contractionBars: 3,
      maxContractionBars: 10,
      momentumThreshold: 5.0,
      atrPeriod: 14,
      normLookback: 50,
      volPeriod: 20,
      description: 'RPCI Score >= 7 AND Volatility Contraction followed by Momentum Expansion (>= 5.0) AND Volume > SMA(20).',
    },
    {
      id: 'ema_trend_alignment',
      name: 'EMA Trend Alignment (21 > 50 > 200)',
      type: 'EMA_TREND_ALIGNMENT',
      weight: 14,
      mandatory: false,
      periods: [21, 50, 200],
      description: 'Confirms a full bull structure: EMA(21) > EMA(50) > EMA(200).',
    },
    {
      id: 'supertrend_bullish',
      name: 'Supertrend Bullish Signal',
      type: 'SUPERTREND_BULLISH',
      weight: 12,
      mandatory: false,
      atrPeriod: 10,
      multiplier: 3.0,
      description: 'Price is above the Supertrend indicator line (ATR period=10, mult=3).',
    },
    {
      id: 'rsi_momentum',
      name: 'RSI Momentum Zone',
      type: 'RSI_MOMENTUM',
      weight: 12,
      mandatory: false,
      period: 14,
      minRsi: 55,
      maxRsi: 75,
      description: 'RSI(14) must be in the momentum sweet-spot: 55-75.',
    },
    {
      id: 'macd_histogram_acceleration',
      name: 'MACD Histogram Acceleration',
      type: 'MACD_HISTOGRAM_ACCELERATION',
      weight: 10,
      mandatory: false,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      description: 'MACD histogram is positive AND growing (today\'s histogram > yesterday\'s).',
    },
    {
      id: 'bollinger_squeeze_breakout',
      name: 'Bollinger Band Squeeze Breakout',
      type: 'BOLLINGER_SQUEEZE_BREAKOUT',
      weight: 10,
      mandatory: false,
      period: 20,
      stdDev: 2,
      squeezeLookback: 20,
      description: 'Detects a Bollinger Band squeeze followed by price breaking above the upper band.',
    },
    {
      id: 'adx_trend_strength',
      name: 'ADX Trend Strength Filter',
      type: 'ADX_TREND_STRENGTH',
      weight: 10,
      mandatory: false,
      period: 14,
      minAdx: 20,
      strongAdx: 25,
      description: 'ADX(14) > 20 confirms the move is a directional TREND.',
    },
    {
      id: 'near_52w_high',
      name: '52-Week High Proximity',
      type: 'NEAR_52W_HIGH',
      weight: 12,
      mandatory: false,
      lookbackDays: 252,
      proximityPct: 10,
      description: 'Price is within 10% of the 52-week high.',
    },
  ],

  logic: 'CONFIDENCE',
};

export default rules;
