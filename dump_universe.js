import axios from 'axios';
import fs from 'fs';

async function fetchIndex(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const lines = res.data.split('\n').filter(Boolean);
  // header: Company Name,Industry,Symbol,Series,ISIN Code
  return lines.slice(1).map(l => l.split(',')[2]?.trim()).filter(Boolean);
}

async function run() {
  try {
    const midcap = await fetchIndex('https://nsearchives.nseindia.com/content/indices/ind_niftymidcap150list.csv');
    const smallcap = await fetchIndex('https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv');
    const universe = [...new Set([...midcap, ...smallcap])];
    fs.writeFileSync('src/static/nse-universe.json', JSON.stringify(universe, null, 2));
    console.log(`Saved ${universe.length} symbols to fallback json.`);
  } catch(e) {
    console.error(e.message);
  }
}
run();
