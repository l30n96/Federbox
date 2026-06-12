// Federbox – Community-API (Vercel Serverless Function)
// ------------------------------------------------------
// Treibt die Community-Features an: Rangliste, geteilte Sets und den
// Chatroom („Vogelhäuschen“). Gespeichert wird in einem Redis-kompatiblen
// KV-Store über die Upstash-REST-API. Die Vercel-Integrationen
// „Upstash for Redis“ bzw. „Vercel KV“ setzen die nötigen
// Umgebungsvariablen automatisch:
//
//   KV_REST_API_URL   + KV_REST_API_TOKEN        (Vercel KV / Marketplace)
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash direkt)
//
// Ohne diese Variablen antwortet die Funktion mit 503 – die App zeigt
// dann einen freundlichen Hinweis und alles andere funktioniert weiter.
//
// Datenschutz: Es werden nur freiwillig geteilte Daten gespeichert
// (Spitzname, Punktestand, geteilte Sets, Chat-Nachrichten). Keine
// Accounts, keine E-Mails, keine IPs in der Datenbank.

// Env-Werte robust einlesen: Whitespace und versehentlich mitkopierte
// Anführungszeichen entfernen, Slash am Ende abschneiden. Wird zur
// Request-Zeit gelesen, damit neue Vercel-Env-Vars sicher ankommen.
function cleanEnv(v){
  return String(v || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
}
function kvConfig(){
  const url   = cleanEnv(process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  return { url, token };
}

const MAX_NAME    = 24;    // Spitznamen
const MAX_TEXT    = 280;   // Chat-Nachrichten
const MAX_CHAT    = 150;   // gespeicherte Chat-Nachrichten
const MAX_BOARD   = 200;   // Einträge auf der Rangliste
const MAX_SETS    = 200;   // gelistete geteilte Sets
const MAX_BIRDS   = 60;    // Vögel pro geteiltem Set
const SET_TTL     = 60 * 60 * 24 * 180; // geteilte Sets leben 180 Tage

// Ein Redis-Kommando über die Upstash-REST-API ausführen.
async function kv(cmd){
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

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const okUrl = u => { try { return !u || new URL(u).protocol === 'https:'; } catch { return false; } };
const code6 = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += A[(Math.random() * A.length) | 0]; return c; };
const json = (res, status, data) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.status(status).send(JSON.stringify(data)); };

function readBody(req){
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url: KV_URL, token: KV_TOKEN } = kvConfig();
  if (!KV_URL || !KV_TOKEN) {
    return json(res, 503, { error: 'Community-Backend nicht konfiguriert', setup: true });
  }

  const action = (req.query && req.query.action) || '';

  try {
    /* ---------- Rangliste ---------- */
    if (action === 'leaderboard' && req.method === 'GET') {
      const raw = await kv(['HGETALL', 'fb:leaderboard']);
      const rows = [];
      for (let i = 0; i + 1 < (raw || []).length; i += 2) {
        try { rows.push(JSON.parse(raw[i + 1])); } catch { /* kaputter Eintrag */ }
      }
      rows.sort((a, b) => (b.xp || 0) - (a.xp || 0));
      return json(res, 200, { rows: rows.slice(0, MAX_BOARD) });
    }

    if (action === 'score' && req.method === 'POST') {
      const body = readBody(req);
      const id   = clean(body.id, 40);
      const name = clean(body.name, MAX_NAME);
      if (!id || !name) return json(res, 400, { error: 'id und name nötig' });
      const entry = {
        id, name,
        xp:       Math.max(0, Math.min(10_000_000, (+body.xp || 0) | 0)),
        level:    Math.max(1, Math.min(99, (+body.level || 1) | 0)),
        streak:   Math.max(0, Math.min(100_000, (+body.streak || 0) | 0)),
        mastered: Math.max(0, Math.min(100_000, (+body.mastered || 0) | 0)),
        birds:    Math.max(0, Math.min(100_000, (+body.birds || 0) | 0)),
        ts: Date.now(),
      };
      await kv(['HSET', 'fb:leaderboard', id, JSON.stringify(entry)]);
      return json(res, 200, { ok: true });
    }

    /* ---------- Geteilte Sets ---------- */
    if (action === 'sets' && req.method === 'GET') {
      const raw = await kv(['LRANGE', 'fb:setlist', 0, MAX_SETS - 1]);
      const rows = [];
      for (const s of raw || []) { try { rows.push(JSON.parse(s)); } catch { /* überspringen */ } }
      return json(res, 200, { rows });
    }

    if (action === 'set' && req.method === 'GET') {
      const code = clean(req.query.code, 12).toUpperCase();
      if (!code) return json(res, 400, { error: 'code nötig' });
      const raw = await kv(['GET', `fb:set:${code}`]);
      if (!raw) return json(res, 404, { error: 'Set nicht gefunden – Code prüfen.' });
      return json(res, 200, { set: JSON.parse(raw) });
    }

    if (action === 'share' && req.method === 'POST') {
      const body = readBody(req);
      const name   = clean(body.name, 60);
      const author = clean(body.author, MAX_NAME) || 'Anonym';
      const desc   = clean(body.description, 140);
      const birdsIn = Array.isArray(body.birds) ? body.birds.slice(0, MAX_BIRDS) : [];
      if (!name || !birdsIn.length) return json(res, 400, { error: 'Name und mindestens ein Vogel nötig' });
      const birds = [];
      for (const x of birdsIn) {
        const de = clean(x.de, 80); if (!de) continue;
        const image = clean(x.image, 500), sound = clean(x.sound, 500);
        if (!okUrl(image) || !okUrl(sound)) continue; // nur https-URLs zulassen
        birds.push({ de, la: clean(x.la, 80) || null, en: clean(x.en, 80) || null, image: image || null, sound: sound || null });
      }
      if (!birds.length) return json(res, 400, { error: 'Keine gültigen Vögel im Set' });
      const code = code6();
      const set = { code, name, description: desc, author, birds, created: Date.now() };
      await kv(['SET', `fb:set:${code}`, JSON.stringify(set), 'EX', SET_TTL]);
      const meta = { code, name, description: desc, author, count: birds.length, created: set.created };
      await kv(['LPUSH', 'fb:setlist', JSON.stringify(meta)]);
      await kv(['LTRIM', 'fb:setlist', 0, MAX_SETS - 1]);
      return json(res, 200, { ok: true, code });
    }

    /* ---------- Chatroom („Vogelhäuschen“) ---------- */
    if (action === 'chat' && req.method === 'GET') {
      const raw = await kv(['LRANGE', 'fb:chat', 0, MAX_CHAT - 1]);
      const rows = [];
      for (const s of raw || []) { try { rows.push(JSON.parse(s)); } catch { /* überspringen */ } }
      rows.reverse(); // älteste zuerst
      return json(res, 200, { rows });
    }

    if (action === 'chat' && req.method === 'POST') {
      const body = readBody(req);
      const name = clean(body.name, MAX_NAME);
      const text = clean(body.text, MAX_TEXT);
      if (!name || !text) return json(res, 400, { error: 'name und text nötig' });
      const now = Date.now();
      const msg = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, text, ts: now };
      await kv(['LPUSH', 'fb:chat', JSON.stringify(msg)]);
      await kv(['LTRIM', 'fb:chat', 0, MAX_CHAT - 1]);
      return json(res, 200, { ok: true, msg });
    }

    return json(res, 400, { error: 'Unbekannte Aktion', action });
  } catch (err) {
    return json(res, 502, { error: 'Community-Fehler', detail: String((err && err.message) || err) });
  }
};
