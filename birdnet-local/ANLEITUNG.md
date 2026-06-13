# 🐦 BirdNET-Analyzer lokal – Anleitung

Eigener BirdNET-Server auf **Laptop** oder **Raspberry Pi**, öffentlich erreichbar per **Cloudflare-Tunnel** – kostenlos, ohne Cloud-Kosten.

---

## Was du brauchst

| Was | Warum |
|-----|-------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Laptop) oder `docker` + `docker compose` (Pi) | Container-Laufzeit |
| Internetverbindung | Tunnel + Docker-Images ziehen |
| Federbox-Projekt (dieses Repo) | Frontend + API-Proxy |

---

## Schritt 1 – .env anlegen

```bash
cd birdnet-local
cp .env.example .env
```

Die `.env` muss vorerst **nicht angepasst** werden – der Quick-Tunnel läuft ohne weitere Konfiguration.

---

## Schritt 2 – BirdNET-Analyzer + Tunnel starten

```bash
docker compose up
```

Docker lädt beim ersten Start automatisch:
- `ghcr.io/birdnet-team/birdnet-analyzer` (~1–2 GB, einmalig)
- `cloudflare/cloudflared` (klein)

**Warte**, bis im Log steht:

```
tunnel  | Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
tunnel  | https://abc-def-123.trycloudflare.com
```

> 💡 Die URL ändert sich bei jedem Neustart. Für eine feste URL → [Abschnitt "Feste URL"](#feste-url-cloudflare-zero-trust) weiter unten.

---

## Schritt 3 – Federbox mit dem lokalen BirdNET verbinden

Öffne (oder erstelle) die `.env` im **Federbox-Root-Verzeichnis** (nicht in `birdnet-local/`):

```dotenv
BIRDNET_API_URL=https://abc-def-123.trycloudflare.com/analyze
XC_API_KEY=dein_xeno_canto_key
```

Federbox-Dev-Server starten (im Federbox-Root):

```bash
vercel dev
```

Dann im Browser `http://localhost:3000` öffnen → Tab **„Feld"** → Aufnahme starten → BirdNET analysiert! 🎉

---

## Auf Raspberry Pi wechseln

1. Raspberry Pi OS (64-bit) + Docker installieren:

   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Terminal neu öffnen
   ```

2. Diesen `birdnet-local/`-Ordner auf den Pi kopieren (z. B. via `scp` oder USB):

   ```bash
   scp -r birdnet-local/ pi@raspberrypi.local:~/birdnet-local/
   ```

3. In `docker-compose.yml` die ARM64-Zeile einkommentieren:

   ```yaml
   birdnet:
     image: ghcr.io/birdnet-team/birdnet-analyzer:latest
     platform: linux/arm64   # ← diese Zeile einkommentieren
   ```

4. Auf dem Pi starten:

   ```bash
   cd ~/birdnet-local
   cp .env.example .env
   docker compose up -d
   docker compose logs -f tunnel   # Tunnel-URL anzeigen
   ```

5. Neue Tunnel-URL in Federbox `.env` eintragen → fertig.

---

## Feste URL (Cloudflare Zero Trust)

Damit die URL stabil bleibt (kein Neusetzen in Federbox nötig):

1. Kostenloser Account auf [dash.cloudflare.com](https://dash.cloudflare.com) anlegen.
2. **Zero Trust → Networks → Tunnels → Create a tunnel** → Type: Cloudflared.
3. **Name** vergeben (z. B. `birdnet`), dann **Token** kopieren.
4. In `birdnet-local/.env`:
   ```dotenv
   TUNNEL_TOKEN=eyJhSGc...dein-token...
   ```
5. In `docker-compose.yml` den `tunnel`-Service auskommentieren und `tunnel_named` einkommentieren.
6. Im Cloudflare-Dashboard unter **Public Hostname** eintragen:
   - Subdomain: `birdnet` (oder beliebig)
   - Domain: deine Domain (oder `.workers.dev` ohne eigene Domain)
   - Service: `http://birdnet:8080`
7. `docker compose up -d` → URL ist jetzt dauerhaft `https://birdnet.deine-domain.com`.

---

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| BirdNET startet nicht / `unhealthy` | `docker compose logs birdnet` – beim ersten Start dauert das Laden des Modells bis zu 2 Minuten |
| Tunnel zeigt keine URL | `docker compose logs tunnel` – prüfen ob BirdNET health-check bestanden hat |
| `BIRDNET_API_URL` nicht übernommen | `vercel dev` neu starten; Vercel liest `.env` nur beim Start |
| Raspberry Pi: `image not found` | `platform: linux/arm64` in `docker-compose.yml` einkommentieren |
| Analyse schlägt fehl | Audio muss mind. 3 Sekunden lang sein; WAV/MP3/OGG werden unterstützt |

---

## Kosten

| Dienst | Kosten |
|--------|--------|
| Docker + BirdNET lokal | 0 € |
| Cloudflare Quick-Tunnel | 0 € (temporäre URL) |
| Cloudflare Zero Trust Tunnel (feste URL) | 0 € (Free-Tier, 50 Nutzer) |
| Federbox (Vercel) | 0 € (Hobby-Tier) |
| Upstash Redis (Bird-Cache) | 0 € (Free-Tier) |
| **Gesamt** | **0 €** |
