import DataFetcher from './src/indicator/data-fetcher.js';
async function run() {
  const fetcher = new DataFetcher();
  try {
    const data = await fetcher.getOHLCV('NAM-INDIA', 'daily');
    const maxVol = Math.max(...data.map(d => d.volume));
    console.log(`Max Volume: ${maxVol}`);
  } catch (err) { console.error(err); }
}
run();
