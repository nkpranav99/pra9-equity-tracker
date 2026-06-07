import { config } from 'dotenv';
config();
import DataFetcher from './src/indicator/data-fetcher.js';
import IndicatorEngine from './src/indicator/engine.js';
import { formatStockCheck } from './src/bot/formatters.js';

async function test() {
  const fetcher = new DataFetcher();
  const engine = new IndicatorEngine(fetcher);
  
  try {
    const res1 = await engine.evaluate('WELCORP.NS');
    console.log(formatStockCheck('WELCORP.NS', res1));
  } catch (err) {
    console.error(err);
  }
}
test();
