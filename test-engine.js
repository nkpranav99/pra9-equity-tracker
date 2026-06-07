import { config } from 'dotenv';
config();
import DataFetcher from './src/indicator/data-fetcher.js';
import IndicatorEngine from './src/indicator/engine.js';
import { formatStockCheck } from './src/bot/formatters.js';

async function test() {
  const fetcher = new DataFetcher();
  const engine = new IndicatorEngine(fetcher);
  
  try {
    const res = await engine.evaluate('HIMADRI.NS'); // HIMADRI.NS was referenced
    console.log(formatStockCheck('HIMADRI.NS', res));
  } catch (err) {
    console.error(err);
  }
}
test();
