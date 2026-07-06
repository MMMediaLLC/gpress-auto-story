# GPress Story V3

Node.js 20 service for Gostivarpress RSS story previews, server-side PNG generation, and optional Instagram Story publishing.

This service runs on:

```text
HOST=127.0.0.1
PORT=3010
```

It does not require Docker, Puppeteer, Playwright, a database, or system package changes.

## Local Start

```bash
npm install
npm start
```

## Endpoints

```text
GET /health
GET /
GET /api/latest
GET /story?i=0
GET /render?i=0
GET /cards/<filename>.png
GET /publish?i=0&dry=1
POST /publish?i=0
```

`GET /render?i=0` generates a real `1080x1920` PNG with `sharp`, saves it to:

```text
/opt/gpress-story/public/cards/
```

and returns:

```json
{ "ok": true, "imageUrl": "...", "title": "...", "link": "..." }
```

## Environment Variables

```env
RSS_URL=https://gostivarpress.mk/feed/
PUBLIC_BASE_URL=https://story.gostivarpress.mk
LOGO_URL=
IG_USER_ID=
IG_ACCESS_TOKEN=
AUTO_PUBLISH_ENABLED=false
```

Logo behavior:

- `LOGO_URL` is optional.
- If `LOGO_URL` is empty, the renderer checks `public/logo.png`.
- If no logo exists, it uses fallback text `GOSTIVARPRESS`.
- The included GPRESS logo is stored as `public/logo.png`.

## Publishing Safety

Automatic publishing is disabled by default.

```env
AUTO_PUBLISH_ENABLED=false
```

Dry run:

```bash
curl "http://127.0.0.1:3010/publish?i=0&dry=1"
```

Manual publish:

```bash
curl -X POST "http://127.0.0.1:3010/publish?i=0"
```

If `IG_USER_ID` or `IG_ACCESS_TOKEN` are missing, publish returns a clear JSON error and does not crash.

Published items are tracked in:

```text
/opt/gpress-story/data/published.json
```

The service uses the RSS `guid` or `link` as the duplicate-protection identifier.

## Auto Publish

When enabled:

```env
AUTO_PUBLISH_ENABLED=true
```

the service checks RSS every 10 minutes. If a new post is not in `published.json`, it generates the PNG and publishes it as an Instagram Story.

Errors are logged, but the service continues running.

## Server Deployment

Use only the existing application directory and existing systemd service.

```bash
cd /opt/gpress-story
cp server.js server.js.backup.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
cp package.json package.json.backup.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
cp README.md README.md.backup.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
```

Copy the new files into `/opt/gpress-story`, then run:

```bash
npm install --omit=dev
node --check server.js
systemctl restart gpress-story
systemctl status gpress-story --no-pager
```

Health check:

```bash
curl http://127.0.0.1:3010/health
```

Render test:

```bash
curl "http://127.0.0.1:3010/render?i=0"
```
