// Federbox – Audio-Proxy (Vercel Serverless Function)
// ---------------------------------------------------
// iOS Safari cannot reliably play audio from URLs that involve HTTP redirects
// combined with Range requests. Xeno-canto download URLs (e.g.
// https://xeno-canto.org/123456/download) redirect to a CDN, which breaks
// playback on iOS (all browsers, since they all use WebKit).
//
// This endpoint fetches the audio server-side, follows all redirects, and
// streams the result back to the client with correct headers so iOS Safari
// can play it reliably.
//
// Security: Only allows fetching from xeno-canto domains to prevent abuse
// as an open proxy.

const ALLOWED_HOSTS = [
  'xeno-canto.org',
  'www.xeno-canto.org',
  'cdn.xeno-canto.org',
];

function isAllowedUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return ALLOWED_HOSTS.includes(u.hostname);
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = req.query.url;
  if (!url || !isAllowedUrl(url)) {
    return res.status(400).json({ error: 'Ungültige oder fehlende Audio-URL' });
  }

  try {
    // Forward Range header if present (for seeking support)
    const headers = { 'User-Agent': 'Federbox/1.0 (Vogel-Lern-App)' };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstream = await fetch(url, { headers, redirect: 'follow' });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: 'Upstream-Fehler', status: upstream.status });
    }

    // Forward relevant headers
    const ct = upstream.headers.get('content-type') || 'audio/mpeg';
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const ar = upstream.headers.get('accept-ranges');

    // Reject excessively large files (bird sounds are typically < 2MB)
    if (cl && parseInt(cl, 10) > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Datei zu groß' });
    }

    res.setHeader('Content-Type', ct);
    res.setHeader('Accept-Ranges', ar || 'bytes');
    if (cl) res.setHeader('Content-Length', cl);
    if (cr) res.setHeader('Content-Range', cr);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');

    // Use correct status code
    const status = upstream.status; // 200 or 206
    res.status(status);

    // Buffer and send (Vercel serverless functions don't support streaming;
    // bird sounds are small, typically < 2MB, so buffering is fine here)
    const body = Buffer.from(await upstream.arrayBuffer());
    return res.send(body);
  } catch (err) {
    return res.status(502).json({ error: 'Audio-Proxy-Fehler', detail: String((err && err.message) || err) });
  }
};
