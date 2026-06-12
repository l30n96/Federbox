#  🪶 Federbox

**Vogelstimmen lernen** mit Bild, Ton und einem Karteikasten nach dem **Leitner‑System** (5 Boxen).
Du legst Vögel an (einzeln, als Set oder über die Beispiele), hörst die Rufe, siehst die Bilder
und ordnest die Namen zu. Was du kannst, wandert in die nächste Box – bis Box 5 („gemeistert“).

Alle Daten liegen **lokal im Browser** (IndexedDB). Nichts wird auf einen Server geladen

---

## Was drin ist

- **4 Lernspiele:** Karteikarte (selbst bewerten), Multiple Choice, Hörquiz (nur Ton), Tippen (mit Tipptoleranz)
- **Leitner‑Kasten:** 5 Boxen, Wiederholungs‑Intervalle 1 / 2 / 4 / 8 / 16 Tage
- **Automatische Recherche:** Deutscher Name + Bild (Wikipedia), wissenschaftlicher Name (Wikidata), Rufe (Xeno‑canto)
- **Sets:** eigene Lern‑Sets zusammenstellen
- **Community (optional):** Rangliste, Sets teilen/importieren per Code, Chatroom „Vogelhäuschen“
- **Offline‑fähig:** einmal angelegte Vögel kannst du auch ohne Netz lernen
- **Export / Import / Reset** in den Einstellungen

---

## Schnellstart (lokal)

```bash
npm i -g vercel        # einmalig, falls noch nicht da
vercel dev             # startet Frontend + die /api/proxy-Funktion lokal
```

Dann im Browser `http://localhost:3000` öffnen.

> Ohne laufendes Backend (`vercel dev`) funktioniert die **Suche** nicht – aber „Von Hand“
> Vögel anlegen und vorhandene Karten lernen geht trotzdem.

---

## Deployen (Vercel)

1. Projekt zu **GitHub** pushen.
2. Auf [vercel.com](https://vercel.com) **„New Project“** → das Repo importieren.
3. **Environment Variable** setzen (siehe unten): `XC_API_KEY`.
4. **Deploy** klicken. Fertig – Frontend und `/api/proxy` laufen automatisch zusammen.

Kein Build‑Schritt nötig, es ist ein statisches Frontend + eine Serverless‑Funktion.

---

## Xeno‑canto‑API‑Key (für die Vogelstimmen)

Seit Oktober 2025 braucht die Xeno‑canto‑API (v3) einen **kostenlosen API‑Key**:

1. Auf [xeno-canto.org](https://xeno-canto.org) ein (kostenloses) Konto anlegen.
2. In den **Account‑Einstellungen** den persönlichen API‑Key kopieren.
3. Bei Vercel als Environment Variable hinterlegen:

   | Name         | Wert                |
   |--------------|---------------------|
   | `XC_API_KEY` | *dein Key*          |

   (Local: in eine `.env`-Datei `XC_API_KEY=deinkey` schreiben, `vercel dev` liest sie.)

Ohne eigenen Key fällt der Proxy auf `demo` zurück. Der **Demo‑Key funktioniert nur sehr
eingeschränkt** – für echten Betrieb also unbedingt einen eigenen Key eintragen.
Der Key bleibt serverseitig; der Browser sieht ihn nie.

---

## Wie es technisch funktioniert

- **`public/index.html`** – die komplette App (HTML + CSS + JS in einer Datei, keine Build‑Tools).
- **`api/proxy.js`** – kleine Serverless‑Funktion. Sie ist der einzige Ausweg um die
  **CORS‑Sperren** der Wikipedia‑/Wikidata‑/Xeno‑canto‑**JSON‑APIs** zu umgehen, und sie
  schmuggelt den `XC_API_KEY` serverseitig dazu. Nur erlaubte Ziele (Allowlist) werden
  durchgereicht.
- **Audio & Bilder** brauchen **kein** CORS – die werden direkt von Xeno‑canto / Wikimedia
  geladen. Nur die Such‑Abfragen (JSON) laufen über den Proxy.
- **`api/community.js`** – Serverless‑Funktion für die Community‑Features (siehe unten).
- **Speicherung:** IndexedDB im Browser (Stores `birds` und `sets`).

---

## Community (optional): Rangliste, geteilte Sets, Chat

Unter dem Tab **„Community“** gibt es eine **Rangliste** (XP, Level, Streak, gemeisterte
Vögel), eine Galerie **geteilter Sets** (eigene Sets per 6‑stelligem Code teilen und
importieren) und das **„Vogelhäuschen“** – einen einfachen Chatroom für alle.

- Alles ist **freiwillig und ohne Konto**: Erst wer einen Spitznamen wählt, taucht auf der
  Rangliste auf bzw. kann chatten und Sets teilen.
- Es verlassen nur Spitzname, Punktestand und aktiv geteilte Inhalte den Browser –
  alles andere bleibt wie gehabt lokal.

Damit die Community funktioniert, braucht die Funktion `api/community.js` einen kleinen
**Redis‑Speicher (Upstash)**:

1. Im Vercel‑Dashboard: **Storage → Create Database → Upstash for Redis** (kostenloser
   Free‑Tier reicht locker) und mit dem Projekt verknüpfen.
2. Das setzt automatisch die Umgebungsvariablen `KV_REST_API_URL` und `KV_REST_API_TOKEN`
   (bzw. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) – beide Namensvarianten
   werden unterstützt.
3. Neu deployen. Fertig.

Ohne diese Variablen zeigt der Community‑Tab nur einen freundlichen Hinweis – der Rest
der App funktioniert davon unabhängig.

---

## Bedienung in Kürze

- **Sammlung → Hinzufügen:** Namen suchen (deutsch oder wissenschaftlich) und „+ Hinzufügen“,
  oder „Von Hand“ eintragen, oder „Beispielvögel laden“ (10 Gartenvögel als Set „Gartenvögel“).
- **Lernen:** Spielmodus wählen, Karten kommen nach Fälligkeit aus dem Leitner‑Kasten.
- **Tastatur im Quiz:** Zahlen `1–4` für Antworten, `Leertaste` zum Abspielen, `Enter` weiter.

Viel Spaß beim Lauschen. 🐦
