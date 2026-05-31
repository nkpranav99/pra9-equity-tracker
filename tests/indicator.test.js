import test from 'node:test';
import assert from 'node:assert';
import IndicatorEngine from '../src/indicator/engine.js';

test('IndicatorEngine', async (t) => {
  // Generate dummy data: 250 candles
  const dummyCandles = Array.from({ length: 250 }, (_, i) => ({
    close: 100 + i, // consistently increasing price
    high: 105 + i,
    low: 95 + i,
    volume: 1000 + (i * 10)
  }));

  const mockDataFetcher = {
    getOHLCV: async () => dummyCandles
  };

  const customRules = {
    name: 'Test Rules',
    timeframe: 'daily',
    logic: 'CONFIDENCE',
    confidence: { strong: 80, medium: 40 },
    conditions: [
      {
        id: 'c1',
        name: 'Relative Volume Breakout',
        type: 'RELATIVE_VOLUME_BREAKOUT',
        avgPeriod: 5,
        quietPeriods: 2,
        threshold: 2.0,
        mandatory: true,
        weight: 0
      },
      {
        id: 'c2',
        name: 'Bonus Rule',
        type: 'RSI',
        period: 14,
        operator: '>',
        value: 50,
        mandatory: false,
        weight: 50
      }
    ]
  };

  await t.test('evaluates condition correctly', async () => {
    // Generate dummy data that specifically triggers Relative Volume Breakout
    // Average volume will be ~100.
    // Last 3 volumes: 90, 90 (below 200), then 250 (above 200).
    // Price trend is bullish (close > previous close).
    const customCandles = Array.from({ length: 200 }, (_, i) => ({
      close: 100 + i,
      high: 105 + i,
      low: 95 + i,
      volume: 100
    }));
    
    // Set the last few candles to trigger the condition
    customCandles[197].volume = 90;  // Quiet period 2
    customCandles[198].volume = 90;  // Quiet period 1
    customCandles[199].volume = 300; // Breakout (ratio > 2.0)
    
    const engine = new IndicatorEngine({ getOHLCV: async () => customCandles }, customRules);
    const result = await engine.evaluate('TEST');
    
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.score, 50);
    assert.strictEqual(result.maxScore, 50);
    assert.strictEqual(result.confidenceLabel, 'Medium');
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.results[0].passed, true);
    assert.strictEqual(result.results[1].passed, true);
  });
  
  await t.test('fails when data is insufficient', async () => {
    const badFetcher = {
      getOHLCV: async () => [{ close: 100 }] // Only 1 candle
    };
    const engine = new IndicatorEngine(badFetcher, customRules);
    const result = await engine.evaluate('TEST');
    
    assert.strictEqual(result.passed, false);
    assert.ok(result.error.includes('Insufficient data'));
  });
});
