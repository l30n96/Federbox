// Federbox – BirdNET Analysis Proxy (Vercel Serverless Function)
// ---------------------------------------------------------------
// Accepts audio recordings from the client and forwards them to the
// BirdNET API for bird species identification. Also provides species
// suggestions for the multiple-choice mode based on location/season.
//
// Endpoints:
//   POST ?action=analyze   → send audio for BirdNET analysis
//     Body: multipart/form-data with 'audio' file + optional lat, lon, week
//     Returns: { results: [{common_name, scientific_name, confidence}...] }
//
//   GET  ?action=suggest&lat=...&lon=...&n=4  → get random species for MC options
//     Returns: { species: [name1, name2, ...] }
//
// The BirdNET API endpoint can be configured via env var BIRDNET_API_URL.

function cleanEnv(v) {
  return String(v || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
}

const BIRDNET_URL = () => cleanEnv(process.env.BIRDNET_API_URL) || null;

// Common European bird species for fallback suggestions (German names)
const COMMON_BIRDS_DE = [
  'Amsel','Kohlmeise','Blaumeise','Rotkehlchen','Buchfink','Haussperling',
  'Star','Ringeltaube','Elster','Rabenkrähe','Grünfink','Zaunkönig',
  'Singdrossel','Mönchsgrasmücke','Zilpzalp','Buntspecht','Kleiber',
  'Stieglitz','Goldammer','Feldlerche','Nachtigall','Pirol',
  'Kuckuck','Mauersegler','Mehlschwalbe','Rauchschwalbe','Gartenrotschwanz',
  'Hausrotschwanz','Bachstelze','Gartenbaumläufer','Schwanzmeise',
  'Tannenmeise','Haubenmeise','Sumpfmeise','Eichelhäher','Kernbeißer',
  'Girlitz','Heckenbraunelle','Grauschnäpper','Trauerschnäpper',
  'Wacholderdrossel','Misteldrossel','Dorngrasmücke','Gartengrasmücke',
  'Fitis','Waldlaubsänger','Sommergoldhähnchen','Wintergoldhähnchen',
  'Grünspecht','Schwarzspecht','Turmfalke','Mäusebussard','Sperber',
  'Habicht','Graureiher','Stockente','Blässhuhn','Teichhuhn',
  'Eisvogel','Wasseramsel','Gebirgsstelze','Kormoran'
];

function json(res, data, status = 200, cacheable = false) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', cacheable ? 'public, s-maxage=300' : 'no-store');
  return res.status(status).json(data);
}

// Parse multipart form data manually (minimal, for Vercel serverless)
async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const chunks = [];
  for await (const chunk of req) { chunks.push(chunk); }
  const body = Buffer.concat(chunks);

  const parts = {};
  const delimiter = Buffer.from('--' + boundary);
  let start = body.indexOf(delimiter) + delimiter.length;

  while (start < body.length) {
    const nextDelim = body.indexOf(delimiter, start);
    if (nextDelim < 0) break;
    const part = body.slice(start, nextDelim);
    start = nextDelim + delimiter.length;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + 4, part.length - 2);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);

    if (filenameMatch) {
      const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);
      parts[name] = { buffer: content, filename: filenameMatch[1], contentType: (ctMatch && ctMatch[1].trim()) || 'application/octet-stream' };
    } else {
      parts[name] = content.toString('utf8').trim();
    }
  }
  return parts;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  try {
    // ---- ANALYZE: Forward audio to BirdNET ----
    if (action === 'analyze' && req.method === 'POST') {
      if (!BIRDNET_URL()) {
        return json(res, {
          results: [],
          error: 'BirdNET nicht konfiguriert.',
          notConfigured: true
        }, 200);
      }

      const parts = await parseMultipart(req);
      if (!parts || !parts.audio) {
        return json(res, { error: 'Kein Audio-File im Request' }, 400);
      }

      const lat  = parseFloat(parts.lat  || url.searchParams.get('lat')  || '0') || null;
      const lon  = parseFloat(parts.lon  || url.searchParams.get('lon')  || '0') || null;
      const week = parseInt(  parts.week || url.searchParams.get('week') || '-1', 10);

      // Build multipart body – our server expects 'audio' + 'meta' (JSON string)
      const boundary = '----FederboxBoundary' + Date.now().toString(36);
      const audioPart = parts.audio;

      const meta = JSON.stringify({
        lat:         lat,
        lon:         lon,
        week:        week,
        min_conf:    0.1,
        num_results: 10,
        save:        false,
      });

      const bodyParts = [];

      // audio field
      bodyParts.push(`--${boundary}\r\n`);
      bodyParts.push(`Content-Disposition: form-data; name="audio"; filename="${audioPart.filename || 'recording.wav'}"\r\n`);
      bodyParts.push(`Content-Type: ${audioPart.contentType || 'audio/wav'}\r\n\r\n`);
      bodyParts.push(audioPart.buffer);
      bodyParts.push('\r\n');

      // meta field
      bodyParts.push(`--${boundary}\r\n`);
      bodyParts.push(`Content-Disposition: form-data; name="meta"\r\n\r\n`);
      bodyParts.push(meta);
      bodyParts.push('\r\n');

      bodyParts.push(`--${boundary}--\r\n`);

      const requestBody = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

      const birdnetRes = await fetch(BIRDNET_URL(), {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(requestBody.length),
        },
        body: requestBody,
      });

      if (!birdnetRes.ok) {
        const errText = await birdnetRes.text().catch(() => '');
        console.error('BirdNET API error:', birdnetRes.status, errText);
        return json(res, {
          results: [],
          error: 'BirdNET-API Fehler: ' + birdnetRes.status,
          status: birdnetRes.status
        }, 200);
      }

      const data = await birdnetRes.json();

      // Normalize: our server returns { detections: [...] }
      // Log response shape for debugging
      console.log('BirdNET raw response:', JSON.stringify(data).slice(0, 300));
      const raw = Array.isArray(data.detections) ? data.detections
        : Array.isArray(data.results) ? data.results
        : Array.isArray(data) ? data
        : [];
      const results = raw
        .map(r => ({
          common_name:     r.common_name     || r.name     || '',
          scientific_name: r.scientific_name || r.sci_name || '',
          confidence:      r.confidence      || r.score    || 0,
        }))
        .filter(r => r.confidence > 0.1)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);

      return json(res, { results });
    }

    // ---- SUGGEST: Return random species for MC distractors ----
    if (action === 'suggest') {
      const n = Math.min(20, Math.max(1, parseInt(url.searchParams.get('n') || '4', 10)));
      const exclude = (url.searchParams.get('exclude') || '').split(',').filter(Boolean);
      const pool = COMMON_BIRDS_DE.filter(s => !exclude.includes(s));
      const species = pool.sort(() => Math.random() - 0.5).slice(0, n);
      return json(res, { species }, 200, true);
    }

    return json(res, { error: 'Unbekannte Aktion: ' + action }, 400);

  } catch (err) {
    console.error('BirdNET proxy error:', err);
    return json(res, { error: 'Interner Fehler: ' + err.message }, 500);
  }
};

function getWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}
