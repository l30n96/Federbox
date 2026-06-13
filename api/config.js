// Federbox – Public Config API (Vercel Serverless Function)
// ----------------------------------------------------------
// Liefert unkritische, öffentliche Konfiguration ans Frontend,
// damit optionale Features rein über Env-Variablen gesteuert
// werden können – ohne Build-Schritt.
//
//   GET /api/config → { buyMeACoffee: "https://buymeacoffee.com/…" | null }
//
// Env-Variablen:
//   BUYMEACOFFEE_URL  (optional) – Link zur Buy-Me-a-Coffee-Seite.
//                     Nur wenn gesetzt, zeigt das Frontend den Button.

function cleanEnv(v) {
  return String(v || '').trim().replace(/^["']|["']$/g, '');
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const coffee = cleanEnv(process.env.BUYMEACOFFEE_URL);
  // Nur http(s)-URLs durchlassen – alles andere ignorieren.
  const buyMeACoffee = /^https?:\/\//i.test(coffee) ? coffee : null;

  const birdnetUrl = cleanEnv(process.env.BIRDNET_API_URL);
  const birdnetEnabled = /^https?:\/\//i.test(birdnetUrl);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).send(JSON.stringify({ buyMeACoffee, birdnetEnabled }));
};
