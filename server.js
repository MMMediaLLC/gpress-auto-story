const http = require("node:http");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3010);
const RSS_URL = process.env.RSS_URL || "https://gostivarpress.mk/feed/";
const LOGO_URL = process.env.LOGO_URL || "";
const CACHE_TTL_MS = 5 * 60 * 1000;

let feedCache = {
  fetchedAt: 0,
  items: [],
  error: null
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (requestUrl.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "gpress-story" });
    }

    if (requestUrl.pathname === "/api/latest") {
      const items = await getLatestItems();
      return sendJson(res, 200, items);
    }

    if (requestUrl.pathname === "/story") {
      const items = await getLatestItems();
      const index = clampIndex(Number(requestUrl.searchParams.get("i") || "0"), items.length);
      return sendHtml(res, renderStoryPage(items[index], index));
    }

    if (requestUrl.pathname === "/") {
      const items = await getLatestItems();
      return sendHtml(res, renderHomePage(items));
    }

    return sendHtml(res, renderNotFoundPage(), 404);
  } catch (error) {
    console.error("[request:error]", error);
    return sendJson(res, 500, {
      ok: false,
      error: "Internal server error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[gpress-story] listening on http://${HOST}:${PORT}`);
});

async function getLatestItems() {
  const now = Date.now();
  if (feedCache.items.length > 0 && now - feedCache.fetchedAt < CACHE_TTL_MS) {
    return feedCache.items;
  }

  try {
    const response = await fetch(RSS_URL, {
      headers: {
        "user-agent": "gpress-story/1.0 (+https://gostivarpress.mk)"
      }
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const items = parseRssItems(xml).slice(0, 10);
    feedCache = {
      fetchedAt: now,
      items,
      error: null
    };
    return items;
  } catch (error) {
    feedCache.error = error;
    if (feedCache.items.length > 0) {
      return feedCache.items;
    }
    throw error;
  }
}

function parseRssItems(xml) {
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return itemMatches.map((itemXml) => {
    const title = cleanText(readTag(itemXml, "title"));
    const link = cleanText(readTag(itemXml, "link"));
    const pubDate = cleanText(readTag(itemXml, "pubDate"));
    const category = cleanText(readTag(itemXml, "category"));
    const contentEncoded = readNamespacedTag(itemXml, "content:encoded");
    const description = readTag(itemXml, "description");

    return {
      title,
      link,
      pubDate,
      category,
      image: extractImage(itemXml, contentEncoded || description)
    };
  }).filter((item) => item.title && item.link);
}

function readTag(xml, tagName) {
  const regex = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  const match = xml.match(regex);
  return match ? unwrapCdata(match[1]) : "";
}

function readNamespacedTag(xml, tagName) {
  return readTag(xml, tagName);
}

function extractImage(itemXml, html) {
  const media = itemXml.match(/<media:content\b[^>]*\burl=["']([^"']+)["'][^>]*>/i);
  if (media?.[1]) return decodeEntities(media[1]);

  const enclosure = itemXml.match(/<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i);
  if (enclosure?.[1]) return decodeEntities(enclosure[1]);

  const img = (html || "").match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  if (img?.[1]) return decodeEntities(img[1]);

  return "";
}

function renderHomePage(items) {
  const rows = items.map((item, index) => `
    <article class="post">
      ${item.image ? `<img src="${attr(item.image)}" alt="">` : `<div class="thumb-fallback"></div>`}
      <div class="post-body">
        <div class="meta">${escapeHtml(item.category || "Вести")} · ${escapeHtml(formatDate(item.pubDate))}</div>
        <h2>${escapeHtml(item.title)}</h2>
        <a href="/story?i=${index}" class="button">Preview Story</a>
        <a href="${attr(item.link)}" class="link" target="_blank" rel="noopener">Open article</a>
      </div>
    </article>
  `).join("");

  return `<!doctype html>
<html lang="mk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GPress Story Generator</title>
  <style>
    :root { color-scheme: light; --accent: #7285f4; --ink: #111827; --muted: #667085; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; background: #f4f6fb; color: var(--ink); }
    header { padding: 34px 22px 18px; max-width: 980px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: clamp(30px, 5vw, 48px); letter-spacing: 0; }
    .sub { color: var(--muted); font-size: 16px; }
    main { max-width: 980px; margin: 0 auto; padding: 12px 22px 44px; display: grid; gap: 16px; }
    .post { display: grid; grid-template-columns: 180px 1fr; gap: 18px; background: #fff; border: 1px solid #e6e8ef; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 30px rgba(17,24,39,0.06); }
    .post img, .thumb-fallback { width: 100%; height: 100%; min-height: 145px; object-fit: cover; background: linear-gradient(135deg, var(--accent), #f7f8ff); }
    .post-body { padding: 18px 18px 16px 0; }
    .meta { color: var(--accent); font-size: 13px; font-weight: 800; text-transform: uppercase; margin-bottom: 7px; }
    h2 { margin: 0 0 14px; font-size: 22px; line-height: 1.18; letter-spacing: 0; }
    .button, .link { display: inline-flex; align-items: center; min-height: 38px; margin-right: 12px; text-decoration: none; font-weight: 800; }
    .button { padding: 0 15px; color: #fff; background: var(--accent); border-radius: 8px; }
    .link { color: var(--muted); }
    @media (max-width: 680px) {
      .post { grid-template-columns: 1fr; }
      .post img, .thumb-fallback { height: 210px; }
      .post-body { padding: 0 16px 18px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>GPress Story Generator</h1>
    <div class="sub">Последни објави од RSS: ${escapeHtml(RSS_URL)}</div>
  </header>
  <main>${rows || `<p>Нема достапни објави.</p>`}</main>
</body>
</html>`;
}

function renderStoryPage(item, index) {
  if (!item) {
    return renderNotFoundPage("Нема објава за избраниот индекс.");
  }

  const backgroundStyle = item.image
    ? `background-image: linear-gradient(180deg, rgba(5,8,18,0.45) 0%, rgba(5,8,18,0.22) 34%, rgba(5,8,18,0.78) 100%), url('${cssUrl(item.image)}');`
    : `background-image: radial-gradient(circle at 30% 16%, rgba(255,255,255,0.24), transparent 34%), linear-gradient(150deg, #111827 0%, #7285f4 52%, #0f172a 100%);`;

  return `<!doctype html>
<html lang="mk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(item.title)} · Story Preview</title>
  <style>
    :root { --accent: #7285f4; --ink: #ffffff; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 22px;
      background: #0b1020;
      font-family: Arial, "Helvetica Neue", sans-serif;
    }
    .story {
      position: relative;
      width: min(100vw - 44px, 540px);
      aspect-ratio: 9 / 16;
      overflow: hidden;
      border-radius: 24px;
      color: var(--ink);
      background-size: cover;
      background-position: center;
      box-shadow: 0 28px 80px rgba(0,0,0,0.42);
      ${backgroundStyle}
    }
    .story:after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0.20), transparent 42%, rgba(0,0,0,0.32));
      pointer-events: none;
    }
    .inner {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      flex-direction: column;
      padding: 7.2% 6.8% 7%;
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
      text-shadow: 0 4px 18px rgba(0,0,0,0.35);
    }
    .brand-mark {
      width: 8px;
      height: 36px;
      border-radius: 99px;
      background: var(--accent);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.14);
    }
    .brand img {
      max-width: 230px;
      max-height: 58px;
      object-fit: contain;
      filter: drop-shadow(0 4px 18px rgba(0,0,0,0.32));
    }
    .brand-text { font-size: clamp(18px, 4.2vw, 25px); }
    .pill {
      flex: 0 0 auto;
      padding: 9px 12px;
      border-radius: 9px;
      background: var(--accent);
      color: #fff;
      font-size: clamp(12px, 2.5vw, 16px);
      font-weight: 900;
      text-transform: uppercase;
      box-shadow: 0 10px 24px rgba(0,0,0,0.22);
    }
    .top-line {
      width: 84px;
      height: 6px;
      margin-top: 22px;
      border-radius: 99px;
      background: var(--accent);
    }
    .spacer { flex: 1; }
    .date {
      width: fit-content;
      margin-bottom: 15px;
      color: rgba(255,255,255,0.88);
      font-size: clamp(14px, 3vw, 20px);
      font-weight: 800;
      text-shadow: 0 4px 16px rgba(0,0,0,0.44);
    }
    h1 {
      margin: 0;
      max-width: 96%;
      font-size: clamp(34px, 8.6vw, 70px);
      line-height: 1.04;
      font-weight: 900;
      letter-spacing: 0;
      text-wrap: balance;
      text-shadow: 0 8px 32px rgba(0,0,0,0.55);
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 30px;
      font-size: clamp(16px, 3.8vw, 25px);
      font-weight: 900;
      text-shadow: 0 5px 20px rgba(0,0,0,0.45);
    }
    .footer-dot {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 4px solid var(--accent);
      position: relative;
      flex: 0 0 auto;
    }
    .footer-dot:after {
      content: "";
      position: absolute;
      width: 22px;
      height: 4px;
      left: 15px;
      top: 13px;
      border-radius: 99px;
      background: var(--accent);
      transform: rotate(-34deg);
    }
    .nav {
      position: fixed;
      left: 18px;
      bottom: 18px;
      display: flex;
      gap: 10px;
      z-index: 5;
    }
    .nav a {
      color: #fff;
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.20);
      border-radius: 10px;
      padding: 10px 12px;
      text-decoration: none;
      font-weight: 800;
      backdrop-filter: blur(12px);
    }
  </style>
</head>
<body>
  <main class="story" aria-label="Story preview ${index + 1}">
    <section class="inner">
      <header>
        <div class="brand-row">
          <div class="brand">
            <span class="brand-mark"></span>
            ${LOGO_URL ? `<img src="${attr(LOGO_URL)}" alt="Gostivarpress">` : `<span class="brand-text">GOSTIVARPRESS</span>`}
          </div>
          <div class="pill">${escapeHtml(item.category || "Вести")}</div>
        </div>
        <div class="top-line"></div>
      </header>
      <div class="spacer"></div>
      <div class="date">${escapeHtml(formatDate(item.pubDate))}</div>
      <h1>${escapeHtml(item.title)}</h1>
      <footer class="footer">
        <span class="footer-dot"></span>
        <span>gostivarpress.mk</span>
      </footer>
    </section>
  </main>
  <nav class="nav">
    <a href="/">Latest</a>
    <a href="/api/latest">JSON</a>
  </nav>
</body>
</html>`;
}

function renderNotFoundPage(message = "Not found") {
  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title></head><body style="font-family:Arial,sans-serif;padding:32px"><h1>${escapeHtml(message)}</h1><p><a href="/">Назад</a></p></body></html>`;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendHtml(res, html, statusCode = 200) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function clampIndex(value, length) {
  if (!length) return 0;
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, length - 1);
}

function formatDate(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("mk-MK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function cleanText(input) {
  return decodeEntities(stripTags(unwrapCdata(input || ""))).replace(/\s+/g, " ").trim();
}

function unwrapCdata(input) {
  return String(input || "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripTags(input) {
  return String(input || "").replace(/<[^>]*>/g, " ");
}

function decodeEntities(input) {
  return String(input || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, "\"");
}

function safeCodePoint(value) {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  return String.fromCodePoint(value);
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attr(input) {
  return escapeHtml(input);
}

function cssUrl(input) {
  return String(input || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
