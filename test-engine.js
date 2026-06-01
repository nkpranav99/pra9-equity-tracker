import DataFetcher from './src/indicator/data-fetcher.js';
import IndicatorEngine from './src/indicator/engine.js';
import rules from './src/indicator/rules.js';

async function run() {
  const fetcher = new DataFetcher();
  const engine = new IndicatorEngine(fetcher, rules);
  const result = await engine.evaluate('NAM-INDIA');
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
