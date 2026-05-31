import test from 'node:test';
import assert from 'node:assert';
import ChartinkScraper from '../src/screener/chartink.js';

test('ChartinkScraper', async (t) => {
  await t.test('scanScreener successfully returns normalised data', async () => {
    const scraper = new ChartinkScraper();
    
    // Mock the internal methods for token and clause
    scraper._getCSRFToken = async () => 'mock-csrf-token';
    scraper._getScanClause = async () => 'mock-scan-clause';
    
    // Mock the underlying axios post method
    scraper.http.post = async () => {
      return {
        data: {
          data: [
            [
              1,                      // sr
              'RELIANCE',             // symbol
              'Reliance Industries',  // name
              'NSE',                  // exchange
              2500.5,                 // price
              1000000,                // volume
              1.5,                    // change
              1.5                     // changePercent
            ]
          ]
        }
      };
    };
    
    const results = await scraper.scanScreener('test-slug');
    
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].symbol, 'RELIANCE');
    assert.strictEqual(results[0].name, 'Reliance Industries');
    assert.strictEqual(results[0].price, 2500.5);
    assert.strictEqual(results[0].volume, 1000000);
    assert.strictEqual(results[0].changePercent, 1.5);
  });

  await t.test('scanScreener handles missing data array gracefully', async () => {
    const scraper = new ChartinkScraper();
    
    scraper._getCSRFToken = async () => 'mock-csrf-token';
    scraper._getScanClause = async () => 'mock-scan-clause';
    
    scraper.http.post = async () => {
      return { data: {} }; // no .data array
    };
    
    const results = await scraper.scanScreener('test-slug');
    assert.strictEqual(results.length, 0);
  });
});
