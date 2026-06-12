// Federbox – Bird Cache API (Vercel Serverless Function)
// -------------------------------------------------------
// Cached bird profiles stored in Upstash Redis to avoid hitting
// Wikipedia/Wikidata rate limits (HTTP 429). When a bird is enriched
// for the first time via the proxy, the client stores the result here.
// Subsequent requests for the same bird load instantly from cache.
//
// Endpoints:
//   GET  ?action=get&names=Kohlmeise,Amsel,...   → cached profiles
//   GET  ?action=list                            → all cached bird names
//   POST ?action=put                             → store bird profile(s)
//
// Uses the same Upstash Redis as the community API.

// Env-Werte robust einlesen: Whitespace und versehentlich mitkopierte
// Anführungszeichen entfernen, Slash am Ende abschneiden. Wird zur
// Request-Zeit gelesen, damit neue Vercel-Env-Vars sicher ankommen.
function cleanEnv(v) {
  return String(v || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
}
function kvConfig() {
  const url   = cleanEnv(process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  return { url, token };
}

const CACHE_TTL = 60 * 60 * 24 * 90; // 90 days
const KEY_PREFIX = 'bird:';
const INDEX_KEY  = 'bird:__index';

async function kv(cmd) {
  const { url, token } = kvConfig();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || ('KV HTTP ' + r.status));
  if (!j || j.error) throw new Error((j && j.error) || 'KV: leere Antwort');
  return j.result;
}

// Pipeline: multiple commands in one HTTP request
async function kvPipeline(cmds) {
  const { url, token } = kvConfig();
  const r = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(cmds),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || ('KV-Pipeline HTTP ' + r.status));
  if (!Array.isArray(j)) throw new Error((j && j.error) || 'KV-Pipeline: unerwartete Antwort');
  return j;
}

// Wichtig: standardmäßig NICHT cachen. Vorher wurden auch 503-/Fehler-
// und Cache-Miss-Antworten 1 h lang vom Vercel-CDN ausgeliefert –
// dadurch wirkte das Caching „kaputt", obwohl Redis längst befüllt war.
const json = (res, status, data, cacheable) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheable ? 'public, max-age=300, s-maxage=300' : 'no-store');
  return res.status(status).send(JSON.stringify(data));
};

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// Normalize bird name for cache key: lowercase, trimmed
function normKey(name) {
  return KEY_PREFIX + String(name || '').trim().toLowerCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url: KV_URL, token: KV_TOKEN } = kvConfig();
  if (!KV_URL || !KV_TOKEN) {
    return json(res, 503, { error: 'Cache nicht konfiguriert (kein KV-Store).' });
  }

  const action = (req.query || {}).action || '';

  try {
    // GET cached bird profiles by German name
    if (action === 'get') {
      const namesParam = (req.query.names || '').trim();
      if (!namesParam) return json(res, 400, { error: 'Parameter "names" fehlt.' });
      const names = namesParam.split(',').map(n => n.trim()).filter(Boolean).slice(0, 50);
      if (!names.length) return json(res, 400, { error: 'Keine gültigen Namen.' });

      // Use pipeline to fetch all at once
      const cmds = names.map(n => ['GET', normKey(n)]);
      const results = await kvPipeline(cmds);

      const birds = {};
      for (let i = 0; i < names.length; i++) {
        const item = results[i];
        if (item && item.error) continue; // einzelner Befehl fehlgeschlagen
        const val = item?.result;
        if (val) {
          try { birds[names[i]] = JSON.parse(val); } catch {}
        }
      }
      const hits = Object.keys(birds).length;
      // Nur vollständige Treffer kurz cachen – Misses dürfen nie im CDN landen,
      // sonst bleiben frisch gespeicherte Vögel unsichtbar.
      return json(res, 200, { birds, cached: hits, total: names.length }, hits === names.length);
    }

    // List all cached bird names
    if (action === 'list') {
      const index = await kv(['SMEMBERS', INDEX_KEY]);
      return json(res, 200, { names: index || [] });
    }

    // Store bird profile(s) — POST
    if (action === 'put') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST erwartet.' });
      const body = readBody(req);
      const birds = Array.isArray(body.birds) ? body.birds : (body.bird ? [body.bird] : []);
      if (!birds.length) return json(res, 400, { error: 'Keine Vogeldaten.' });
      if (birds.length > 50) return json(res, 400, { error: 'Maximal 50 Vögel pro Request.' });

      const cmds = [];
      const names = [];
      for (const b of birds) {
        if (!b || !b.de) continue;
        const name = String(b.de).trim();
        if (!name) continue;
        // Store only the profile data relevant for caching (no user-specific fields)
        const profile = {
          de: b.de, la: b.la || null, en: b.en || null,
          image: b.image || null, sounds: b.sounds || [],
          wiki: b.wiki || null
        };
        const key = normKey(name);
        cmds.push(['SET', key, JSON.stringify(profile), 'EX', CACHE_TTL]);
        names.push(name);
      }

      if (!cmds.length) return json(res, 400, { error: 'Keine gültigen Vogeldaten.' });

      // Add all names to the index set
      cmds.push(['SADD', INDEX_KEY, ...names]);

      const results = await kvPipeline(cmds);
      const failed = results.filter(item => item && item.error);
      if (failed.length) {
        return json(res, 502, { error: 'KV-Schreibfehler', detail: failed[0].error, stored: names.length - failed.length });
      }
      return json(res, 200, { stored: names.length, names });
    }

    return json(res, 400, { error: 'Unbekannte Aktion. Erlaubt: get, list, put' });
  } catch (err) {
    return json(res, 500, { error: 'Cache-Fehler', detail: String(err?.message || err) });
  }
};
