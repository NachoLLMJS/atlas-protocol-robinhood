export default async function handler(req, res) {
  const symbols = (req.query.symbols || 'TSLA,AMZN,NFLX,AMD,PLTR').toUpperCase();
  const tickers = symbols.split(',').filter(Boolean).slice(0, 15);

  const results = {};
  await Promise.all(tickers.map(async (ticker) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await r.json();
      const meta = data.chart.result[0].meta;
      const prev = meta.chartPreviousClose;
      const price = meta.regularMarketPrice;
      const change = ((price - prev) / prev) * 100;
      results[ticker] = { price, previousClose: prev, change: parseFloat(change.toFixed(2)) };
    } catch {
      results[ticker] = { error: 'Failed to fetch' };
    }
  }));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  res.json(results);
}
