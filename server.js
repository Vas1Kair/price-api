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
app.get('/refresh', async (req, res) => {
  const result = await refreshCache();
  res.json({ success: true, count: Object.keys(result).length });
});

app.get('/test-anet', async (req, res) => {
  const result = await fetchSymbol('ANET');
  res.json({ result });
});


// ── Finnhub ticker symbols ────────────────────────────────────
const FINNHUB_KEY = 'd8ufe31r01qinhuhn3e0d8ufe31r01qinhuhn3eg';
const TICKER_SYMBOLS = [
  'NVDA','META','MSFT','AMZN','ASML','TSM','BABA',
  'ORCL','NFLX','UBER','PANW','UBS','AMD','AAPL','GOOGL'
];

// ── Ticker cache — refresh every 60 seconds ───────────────────
let tickerCache = [];
let tickerCacheTime = 0;
const TICKER_TTL = 60 * 1000;

async function fetchFinnhubQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-Finnhub-Token': FINNHUB_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = data.c;
    const prev  = data.pc;
    if (!price || !prev || price === 0) return null;
    const chgPct = ((price - prev) / prev) * 100;
    return {
      sym:   symbol,
      price: Math.round(price * 100) / 100,
      chg:   Math.round(chgPct * 100) / 100,
      pos:   chgPct >= 0
    };
  } catch(e) {
    return null;
  }
}

async function refreshTickerCache() {
  console.log('Fetching ticker prices from Finnhub...');
  const results = [];
  for (const sym of TICKER_SYMBOLS) {
    const data = await fetchFinnhubQuote(sym);
    if (data) results.push(data);
    // Small delay to respect Finnhub rate limits
    await new Promise(r => setTimeout(r, 150));
  }
  tickerCache     = results;
  tickerCacheTime = Date.now();
  console.log(`Ticker cache updated: ${results.length}/${TICKER_SYMBOLS.length} symbols`);
  return results;
}

// ── /ticker endpoint ──────────────────────────────────────────
app.get('/ticker', async (req, res) => {
  try {
    if (Date.now() - tickerCacheTime > TICKER_TTL || tickerCache.length === 0) {
      await refreshTickerCache();
    }
    res.json({
      success:   true,
      ticker:    tickerCache,
      cached_at: new Date(tickerCacheTime).toISOString()
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Price API running on port ${PORT}`);
  refreshCache();
});
