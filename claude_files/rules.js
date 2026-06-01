/**
 * ============================================================
 *  Indicator Rules Configuration  —  equity-bot
 * ============================================================
 *
 *  Scoring System: WEIGHTED  |  Max Score: 100
 *
 *  ARCHITECTURE REMINDER
 *  ─────────────────────
 *  • mandatory: true  → Gatekeeper. Failure = stock marked as
 *    "Failed Mandatory" (score preserved for reference only).
 *  • mandatory: false → Weighted contributor to confidence score.
 *  • Weights of all rules must sum to exactly 100.
 *
 *  STRATEGY PHILOSOPHY
 *  ────────────────────
 *  We are hunting BREAKOUT stocks on Indian equity (NSE/BSE) that:
 *    1. Have compressed (quiet) before the move  [Volume + Squeeze]
 *    2. Are breaking out on genuine volume       [Mandatory gate]
 *    3. Show multi-timeframe trend alignment     [EMA stack, Supertrend]
 *    4. Have measurable momentum confirmation    [RSI, MACD histogram]
 *    5. Are near or at structural breakout zones [52W High proximity]
 *    6. Have directional trend strength, not chop[ADX filter]
 *
 * ============================================================
 */

export const SCORING_MODE = 'WEIGHTED';
export const MAX_SCORE = 100;

export const rules = [

  // ════════════════════════════════════════════════════════════
  //  MANDATORY GATEKEEPER  (must pass, or stock is disqualified)
  //  Your original custom indicator — retained as-is.
  // ════════════════════════════════════════════════════════════

  {
    id: 'relative_volume_breakout',
    name: 'Relative Volume Breakout',
    type: 'RELATIVE_VOLUME_BREAKOUT',
    weight: 20,
    mandatory: true,
    // Volume must be quiet for `quietPeriods` days, then explode
    avgVolumePeriod: 20,       // Rolling window for average volume
    quietPeriods: 4,           // Days volume must be below quietThreshold before the spike
    quietThreshold: 0.85,      // Below 85% of avg volume = "quiet"
    spikeMultiplier: 2.0,      // Today's volume >= 2× avg = breakout spike
    description:
      'Detects volume contraction followed by an explosive expansion. ' +
      'Quiet volume for 4 days, then today\'s volume ≥ 2× the 20-day average. ' +
      'This is the primary signal that institutional/smart money is entering.',
  },

  // ════════════════════════════════════════════════════════════
  //  TREND STRUCTURE  (Is the bigger picture aligned?)
  // ════════════════════════════════════════════════════════════

  {
    id: 'ema_trend_alignment',
    name: 'EMA Trend Alignment (21 > 50 > 200)',
    type: 'EMA_TREND_ALIGNMENT',
    weight: 14,
    mandatory: false,
    // Replaces the flat EMA(9)>EMA(10) and EMA(50)>EMA(200) with a single
    // three-tier stack — a far stronger bull-market confirmation.
    periods: [21, 50, 200],
    description:
      'Confirms a full bull structure: EMA(21) > EMA(50) > EMA(200). ' +
      'All three time horizons aligned means the stock is in a genuine ' +
      'uptrend across short, medium, and long-term frames. ' +
      'The classic "EMA ribbon" alignment used by professionals.',
  },

  {
    id: 'supertrend_bullish',
    name: 'Supertrend Bullish Signal',
    type: 'SUPERTREND_BULLISH',
    weight: 12,
    mandatory: false,
    atrPeriod: 10,       // ATR lookback for Supertrend calculation
    multiplier: 3.0,     // Standard 3× ATR multiplier
    description:
      'Price is above the Supertrend indicator line (ATR period=10, mult=3). ' +
      'Supertrend is a dynamic trailing stop that flips bullish/bearish. ' +
      'One of the most reliable trend-following signals for Indian equities. ' +
      'Computed as: Upper Band = (High+Low)/2 + 3×ATR(10); bullish when close > upper band.',
  },

  // ════════════════════════════════════════════════════════════
  //  MOMENTUM CONFIRMATION  (Is the move accelerating?)
  // ════════════════════════════════════════════════════════════

  {
    id: 'rsi_momentum',
    name: 'RSI Momentum Zone',
    type: 'RSI_MOMENTUM',
    weight: 12,
    mandatory: false,
    period: 14,
    // RSI between 55–75: strong momentum without being overbought.
    // Below 55 = weak; above 75 = extended/overbought risk.
    minRsi: 55,
    maxRsi: 75,
    description:
      'RSI(14) must be in the momentum sweet-spot: 55–75. ' +
      'This range confirms bullish strength while avoiding overbought conditions. ' +
      'RSI < 55 suggests choppiness/bearish bias; RSI > 75 signals potential exhaustion.',
  },

  {
    id: 'macd_histogram_acceleration',
    name: 'MACD Histogram Acceleration',
    type: 'MACD_HISTOGRAM_ACCELERATION',
    weight: 10,
    mandatory: false,
    // Standard MACD settings
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    description:
      'MACD histogram is positive AND growing (today\'s histogram > yesterday\'s). ' +
      'This is more powerful than just MACD > Signal because it confirms that ' +
      'momentum is ACCELERATING, not just present. Rising bars = bulls gaining strength.',
  },

  // ════════════════════════════════════════════════════════════
  //  VOLATILITY & STRUCTURE  (Is it coiling for a breakout?)
  // ════════════════════════════════════════════════════════════

  {
    id: 'bollinger_squeeze_breakout',
    name: 'Bollinger Band Squeeze Breakout',
    type: 'BOLLINGER_SQUEEZE_BREAKOUT',
    weight: 10,
    mandatory: false,
    period: 20,
    stdDev: 2,
    // Squeeze = band-width is at its lowest in `squeezeLookback` days
    squeezeLookback: 20,
    description:
      'Detects a Bollinger Band squeeze (volatility compression) followed by ' +
      'price breaking above the upper band. The "coil before the spring" pattern. ' +
      'Bandwidth = (Upper - Lower) / Middle; a squeeze occurs when bandwidth is at ' +
      'a multi-week low, then price closes above the upper band — classic breakout setup.',
  },

  {
    id: 'adx_trend_strength',
    name: 'ADX Trend Strength Filter',
    type: 'ADX_TREND_STRENGTH',
    weight: 10,
    mandatory: false,
    period: 14,
    // ADX > 20 = trend beginning; ADX > 25 = strong trend (full score)
    minAdx: 20,
    strongAdx: 25,
    description:
      'ADX(14) > 20 confirms the move is a directional TREND, not sideways chop. ' +
      'ADX measures trend strength regardless of direction. Values below 20 indicate ' +
      'a ranging market where breakouts frequently fail. ADX > 25 earns full weight. ' +
      'This is the most critical chop-filter for Indian mid/small caps.',
  },

  // ════════════════════════════════════════════════════════════
  //  PRICE STRUCTURE  (Is it at a significant price level?)
  // ════════════════════════════════════════════════════════════

  {
    id: 'near_52w_high',
    name: '52-Week High Proximity',
    type: 'NEAR_52W_HIGH',
    weight: 12,
    mandatory: false,
    // Stock within `proximityPct`% of its 52-week high
    lookbackDays: 252,   // ~1 trading year
    proximityPct: 10,    // Within 10% of 52W high
    description:
      'Price is within 10% of the 52-week high. ' +
      'Stocks breaking to new 52-week highs exhibit the highest win-rate of any ' +
      'single factor in momentum strategies (O\'Neil/IBD research). ' +
      'A stock near its highs has already defeated all overhead resistance sellers.',
  },

];

/**
 * ════════════════════════════════════════════════════════════
 *  WEIGHT AUDIT  (must sum to 100)
 * ════════════════════════════════════════════════════════════
 *
 *  Rule                          Weight
 *  ──────────────────────────    ──────
 *  relative_volume_breakout       20   ← MANDATORY
 *  ema_trend_alignment            14
 *  supertrend_bullish             12
 *  rsi_momentum                   12
 *  macd_histogram_acceleration    10
 *  bollinger_squeeze_breakout     10
 *  adx_trend_strength             10
 *  near_52w_high                  12
 *  ──────────────────────────    ──────
 *  TOTAL                         100  ✓
 *
 * ════════════════════════════════════════════════════════════
 */
