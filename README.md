# GPress Story Generator

Production-safe Node.js 20 preview service for Gostivarpress story cards.

This version uses only built-in Node.js modules. It does not require Express, Puppeteer, Playwright, Sharp, a database, login, admin panel, or social media credentials.

## Local Start

```bash
npm start
```

Default runtime:

```text
HOST=127.0.0.1
PORT=3010
RSS_URL=https://gostivarpress.mk/feed/
```

Optional logo:

```bash
LOGO_URL=https://example.com/logo.png npm start
```

## Endpoints

```text
GET /health
```

Returns:

```json
{ "ok": true, "service": "gpress-story" }
```

```text
GET /
```

Shows the latest RSS posts with `Preview Story` buttons.

```text
GET /api/latest
```

Fetches and parses the latest 10 RSS posts. The response includes:

- `title`
- `link`
- `pubDate`
- `category`
- `image`

RSS is cached in memory for 5 minutes.

```text
GET /story
GET /story?i=0
```

Shows a responsive 9:16 story preview card for the selected RSS item.

## Server Deployment

The existing systemd service starts:

```text
WorkingDirectory=/opt/gpress-story
ExecStart=/usr/bin/node server.js
```

Deploy these files into `/opt/gpress-story`:

- `server.js`
- `package.json`
- `README.md`

Then restart and check the existing service:

```bash
systemctl restart gpress-story
systemctl status gpress-story --no-pager
```

Health check:

```bash
curl http://127.0.0.1:3010/health
```
