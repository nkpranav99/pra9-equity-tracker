import MarketDepthScreener from './src/screener/market-depth.js';
import fs from 'fs';
import path from 'path';

async function run() {
  const screener = new MarketDepthScreener();
  try {
    const midcap = await screener._fetchIndex('NIFTY MIDCAP 150');
    await new Promise(r => setTimeout(r, 1000));
    const smallcap = await screener._fetchIndex('NIFTY SMALLCAP 250');
    
    const all = [...midcap, ...smallcap].map(s => s.symbol);
    const unique = Array.from(new Set(all));
    
    fs.writeFileSync('./src/data/nse-universe.json', JSON.stringify(unique, null, 2));
    console.log(`Saved ${unique.length} symbols to fallback JSON`);
  } catch (err) {
    console.error('Failed to dump universe:', err);
    // fallback dummy
    fs.writeFileSync('./src/data/nse-universe.json', JSON.stringify(["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"], null, 2));
  }
}
run();
