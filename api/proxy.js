// Federbox – API-Proxy (Vercel Serverless Function)
// -------------------------------------------------
// Warum es diese Funktion gibt:
//  - Xeno-canto (Vogellaute) liefert KEINE CORS-Header und braucht seit
//    Oktober 2025 einen API-Key (v3). Beides lösen wir hier serverseitig:
//    der Key steckt in der Umgebungsvariable XC_API_KEY und verlässt den
//    Server nie.
//  - Wikipedia/Wikidata werden ebenfalls hierdurch geroutet, damit der
//    Browser garantiert nie auf ein CORS-Problem läuft (ein Codepfad).
//  - Bilder und Audio brauchen KEINEN Proxy – die lädt der Browser direkt
//    (ein <img>/<audio> darf cross-origin laden). Hier läuft nur JSON.
//
// Sicherheit: feste Allowlist an Zielen, damit das hier kein offener
// Proxy wird, den Fremde missbrauchen können.

const TARGETS = {
  xc:       'https://xeno-canto.org/api/3/recordings',
  wiki:     'https://de.wikipedia.org/w/api.php',
  wiki_en:  'https://en.wikipedia.org/w/api.php',
  wikidata: 'https://www.wikidata.org/w/api.php',
  commons:  'https://commons.wikimedia.org/w/api.php',
};

// Simple in-memory response cache to reduce duplicate upstream calls.
// Serverless instances are ephemeral, so this only helps within one
// invocation burst (warm container). Entries expire after 5 minutes.
const responseCache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { responseCache.delete(key); return null; }
  return entry;
}

function putCache(key, status, body) {
  if (responseCache.size >= CACHE_MAX) {
    // Evict oldest entry
    const first = responseCache.keys().next().value;
    responseCache.delete(first);
  }
  responseCache.set(key, { status, body, ts: Date.now() });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const q = req.query || {};
    const service = q.service;
    const base = TARGETS[service];
    if (!base) {
      return res.status(400).json({ error: 'Unbekannter Dienst', service: service || null });
    }

    const url = new URL(base);
    for (const [k, v] of Object.entries(q)) {
      if (k === 'service') continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
    }

    // Wiki-APIs immer als JSON, mit origin=* (schadet serverseitig nicht).
    if (service !== 'xc') {
      if (!url.searchParams.has('format')) url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');
    }

    // Xeno-canto: Key serverseitig anhängen. 'demo' funktioniert eingeschränkt
    // zum Ausprobieren – für echten Betrieb einen eigenen Key setzen.
    if (service === 'xc') {
      url.searchParams.set('key', process.env.XC_API_KEY || 'demo');
    }

    const cacheKey = url.toString();

    // Check in-memory cache first (only for read-only wiki/wikidata requests)
    if (service !== 'xc') {
      const hit = getCached(cacheKey);
      if (hit) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.setHeader('X-Cache', 'HIT');
        return res.status(hit.status).send(hit.body);
      }
    }

    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Federbox/1.0 (Vogel-Lern-App)' },
    });
    const body = await upstream.text();

    // Cache successful wiki/wikidata responses in memory
    if (service !== 'xc' && upstream.status === 200) {
      putCache(cacheKey, upstream.status, body);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Antworten dürfen ruhig gecacht werden – Artbeschreibungen ändern sich selten.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(upstream.status).send(body);
  } catch (err) {
    return res.status(502).json({ error: 'Proxy-Fehler', detail: String((err && err.message) || err) });
  }
};
