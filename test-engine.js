import { config } from 'dotenv';
config();
import DataFetcher from './src/indicator/data-fetcher.js';
import IndicatorEngine from './src/indicator/engine.js';
import { formatStockCheck } from './src/bot/formatters.js';
import pino from 'pino';

global.logger = pino({ level: 'debug' });

async function test() {
  const fetcher = new DataFetcher();
  const engine = new IndicatorEngine(fetcher);
  
  try {
    console.log("=== PASUPTAC.NS ===");
    const res1 = await engine.evaluate('PASUPTAC.NS');
    console.log(formatStockCheck('PASUPTAC.NS', res1));
    const br1 = res1.results.find(r => r.rpciResults)?.rpciResults;
    console.log(br1.earnings, br1.institutional, br1.stExtension);

    console.log("=== HSCL.NS ===");
    const res2 = await engine.evaluate('HSCL.NS');
    console.log(formatStockCheck('HSCL.NS', res2));
    const br2 = res2.results.find(r => r.rpciResults)?.rpciResults;
    console.log(br2.earnings, br2.institutional, br2.stExtension);

  } catch (err) {
    console.error(err);
  }
}
test();
