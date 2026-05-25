const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── CORS — allow your GitHub Pages site to call this server ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

// ── All 25 portfolio symbols in Yahoo Finance format ──────────
const SYMBOLS = [
  // US stocks
  'MSFT', 'AMZN', 'ORCL', 'ETN', 'SYK', 'V', 'NFLX', 'UBER',
  'ANET', 'DIS', 'UPS', 'OXY', 'BABA', 'UBS', 'SLG',
  // International — Yahoo Finance suffix format
  'ADS.DE',   // Adidas — Frankfurt
  'AIR.PA',   // Airbus — Paris
  'MC.PA',    // LVMH — Paris
  '1810.HK',  // Xiaomi — Hong Kong
  '1211.HK',  // BYD — Hong Kong
  'MTLN.L',   // Metlen — London
  'EMAAR.DU', // Emaar — Dubai
];

// ── Fetch a single symbol from Yahoo Finance ──────────────────
async function fetchSymbol(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  try {
    const res  = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.chart?.result?.[0]) return null;

    const meta   = data.chart.result[0].meta;
    const closes = (data.chart.result[0].indicators?.quote?.[0]?.close || []).filter(Boolean);
    const price  = meta.regularMarketPrice || closes[closes.length - 1] || meta.previousClose;
    const prev   = closes.length >= 2 ? closes[closes.length - 2] : (meta.previousClose || price);

    if (!price) return null;

    return {
      price:    Math.round(price * 10000) / 10000,
      prev:     Math.round(prev  * 10000) / 10000,
      change:   prev > 0 ? Math.round(((price - prev) / prev) * 10000) / 100 : 0,
      currency: meta.currency || 'USD'
    };
  } catch(e) {
    return null;
  }
}

// ── Simple in-memory cache — refresh every 8 hours ───────────
let cache     = {};
let cacheTime = 0;
const CACHE_TTL = 8 * 60 * 60 * 1000;

async function refreshCache() {
  console.log('Fetching all prices from Yahoo Finance...');
  // Fetch all symbols in parallel — no rate limit on server side
  const results = await Promise.all(
    SYMBOLS.map(async sym => ({ sym, data: await fetchSymbol(sym) }))
  );
  const newCache = {};
  results.forEach(({ sym, data }) => {
    if (data) newCache[sym] = data;
  });
  cache     = newCache;
  cacheTime = Date.now();
  console.log(`Cached ${Object.keys(newCache).length}/${SYMBOLS.length} symbols`);
  return cache;
}

// ── API endpoint ──────────────────────────────────────────────
app.get('/prices', async (req, res) => {
  try {
    // Refresh cache if expired or empty
    if (Date.now() - cacheTime > CACHE_TTL || Object.keys(cache).length === 0) {
      await refreshCache();
    }
    res.json({
      success:   true,
      prices:    cache,
      cached_at: new Date(cacheTime).toISOString(),
      count:     Object.keys(cache).length
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Health check / keep-alive ping ───────────────────────────
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', cached: Object.keys(cache).length, age_minutes: Math.round((Date.now() - cacheTime) / 60000) });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Price API running on port ${PORT}`);
  // Pre-warm cache on startup
  refreshCache();
});
