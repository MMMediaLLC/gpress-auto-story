const http = require("node:http");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3010);
const RSS_URL = process.env.RSS_URL || "https://gostivarpress.mk/feed/";
const LOGO_URL = process.env.LOGO_URL || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://story.gostivarpress.mk").replace(/\/+$/, "");
const AUTO_PUBLISH_ENABLED = process.env.AUTO_PUBLISH_ENABLED === "true";
const IG_USER_ID = process.env.IG_USER_ID || "";
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || "";
const CACHE_TTL_MS = 5 * 60 * 1000;
const AUTO_PUBLISH_INTERVAL_MS = 10 * 60 * 1000;
const CARD_DESIGN_VERSION = "v10";

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CARDS_DIR = path.join(PUBLIC_DIR, "cards");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLISHED_FILE = path.join(DATA_DIR, "published.json");
const LOCAL_LOGO_PATH = path.join(PUBLIC_DIR, "logo.png");
const FONT_REGULAR_PATH = path.join(PUBLIC_DIR, "fonts", "NotoSans-Regular.ttf");
const FONT_BOLD_PATH = path.join(PUBLIC_DIR, "fonts", "NotoSans-Bold.ttf");

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
      const item = await itemFromRequest(requestUrl);
      return sendHtml(res, renderStoryPreview(item));
    }

    if (requestUrl.pathname === "/render") {
      const item = await itemFromRequest(requestUrl);
      const rendered = await renderCardPng(item);
      return sendJson(res, 200, {
        ok: true,
        imageUrl: rendered.imageUrl,
        title: item.title,
        link: item.link
      });
    }

    if (requestUrl.pathname === "/publish" && req.method === "GET") {
      if (requestUrl.searchParams.get("dry") !== "1") {
        return sendJson(res, 405, { ok: false, error: "Use GET /publish?i=0&dry=1 for dry-run or POST /publish?i=0 to publish." });
      }
      const item = await itemFromRequest(requestUrl);
      return sendJson(res, 200, await dryRunPublish(item));
    }

    if (requestUrl.pathname === "/publish" && req.method === "POST") {
      const item = await itemFromRequest(requestUrl);
      return sendJson(res, 200, await publishItem(item, "manual"));
    }

    if (requestUrl.pathname.startsWith("/cards/")) {
      return serveCardFile(res, requestUrl.pathname);
    }

    if (requestUrl.pathname === "/" && req.method === "GET") {
      const items = await getLatestItems();
      const published = await readPublishedStore();
      return sendHtml(res, renderHomePage(items, published));
    }

    return sendHtml(res, renderNotFoundPage(), 404);
  } catch (error) {
    logError("request", error);
    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[gpress-story] listening on http://${HOST}:${PORT}`);
  console.log(`[gpress-story] auto publish: ${AUTO_PUBLISH_ENABLED ? "enabled" : "disabled"}`);
});

if (AUTO_PUBLISH_ENABLED) {
  setInterval(() => {
    checkAndPublishLatest().catch((error) => logError("auto-publish", error));
  }, AUTO_PUBLISH_INTERVAL_MS).unref();

  setTimeout(() => {
    checkAndPublishLatest().catch((error) => logError("auto-publish-initial", error));
  }, 15_000).unref();
}

async function itemFromRequest(requestUrl) {
  const items = await getLatestItems();
  if (!items.length) {
    throw new Error("RSS feed returned no posts.");
  }
  const index = clampIndex(Number(requestUrl.searchParams.get("i") || "0"), items.length);
  return items[index];
}

async function getLatestItems() {
  const now = Date.now();
  if (feedCache.items.length > 0 && now - feedCache.fetchedAt < CACHE_TTL_MS) {
    return feedCache.items;
  }

  try {
    const response = await fetch(RSS_URL, {
      headers: {
        "user-agent": "gpress-story/3.0 (+https://gostivarpress.mk)"
      }
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const items = parseRssItems(xml).slice(0, 10);
    feedCache = { fetchedAt: now, items, error: null };
    return items;
  } catch (error) {
    feedCache.error = error;
    if (feedCache.items.length > 0) return feedCache.items;
    throw error;
  }
}

function parseRssItems(xml) {
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return itemMatches.map((itemXml) => {
    const contentEncoded = readTag(itemXml, "content:encoded");
    const description = readTag(itemXml, "description");
    const link = cleanText(readTag(itemXml, "link"));
    const guid = cleanText(readTag(itemXml, "guid"));

    return {
      id: stableId(guid || link),
      guid,
      title: cleanText(readTag(itemXml, "title")),
      link,
      pubDate: cleanText(readTag(itemXml, "pubDate")),
      category: cleanText(readTag(itemXml, "category")),
      image: normalizeWordPressImageUrl(extractImage(itemXml, contentEncoded || description))
    };
  }).filter((item) => item.title && item.link);
}

function readTag(xml, tagName) {
  const regex = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  const match = xml.match(regex);
  return match ? unwrapCdata(match[1]) : "";
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

function normalizeWordPressImageUrl(imageUrl) {
  if (!imageUrl) return "";
  return imageUrl.replace(/-\d+x\d+(\.(?:jpg|jpeg|png|webp))(\?.*)?$/i, "$1$2");
}

async function renderCardPng(item) {
  await fs.mkdir(CARDS_DIR, { recursive: true });

  const filename = `story-${item.id}-${CARD_DESIGN_VERSION}.png`;
  const outputPath = path.join(CARDS_DIR, filename);
  const imageUrl = `${PUBLIC_BASE_URL}/cards/${filename}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 540, height: 960 },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    await page.setContent(renderStoryCardHtml(item), { waitUntil: "networkidle" });
    await page.locator(".story").screenshot({ path: outputPath, type: "png" });
    await context.close();
  } finally {
    await browser.close();
  }

  logInfo("render", `${filename} ${item.title}`);
  return { outputPath, imageUrl };
}

function loadSvgFontFace() {
  try {
    if (!fss.existsSync(FONT_REGULAR_PATH) || !fss.existsSync(FONT_BOLD_PATH)) {
      return "";
    }

    const regular = fss.readFileSync(FONT_REGULAR_PATH).toString("base64");
    const bold = fss.readFileSync(FONT_BOLD_PATH).toString("base64");

    return `
          @font-face {
            font-family: "GPressNoto";
            src: url("data:font/truetype;charset=utf-8;base64,${regular}") format("truetype");
            font-weight: 400 800;
          }
          @font-face {
            font-family: "GPressNoto";
            src: url("data:font/truetype;charset=utf-8;base64,${bold}") format("truetype");
            font-weight: 900;
          }`;
  } catch (error) {
    logError("font-load", error);
    return "";
  }
}

function loadOpenTypeFont(fontPath) {
  try {
    if (!fss.existsSync(fontPath)) return null;
    const buffer = fss.readFileSync(fontPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return opentype.parse(arrayBuffer);
  } catch (error) {
    logError("font-vector-load", error);
    return null;
  }
}

function svgTextPath(text, x, y, fontSize, className, options = {}) {
  const font = options.weight === "regular" ? VECTOR_FONT_REGULAR : VECTOR_FONT_BOLD;
  const filter = options.filter ? ` filter="${escapeXml(options.filter)}"` : "";
  const stroke = options.stroke ? ` stroke="${escapeXml(options.stroke)}"` : "";
  const strokeWidth = options.strokeWidth ? ` stroke-width="${Number(options.strokeWidth)}"` : "";
  const strokeJoin = options.strokeWidth ? ` stroke-linejoin="round" paint-order="stroke fill"` : "";
  const value = String(text || "");

  if (!font) {
    return `<text x="${x}" y="${y}" class="${escapeXml(className)}" font-size="${fontSize}"${filter}>${escapeXml(value)}</text>`;
  }

  const pathData = textToPathData(font, value, x, y, fontSize);
  return `<path class="${escapeXml(className)}" d="${escapeXml(pathData)}"${filter}${stroke}${strokeWidth}${strokeJoin}/>`;
}

function textToPathData(font, text, x, y, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  let cursor = x;
  let pathData = "";

  for (const char of Array.from(text)) {
    const glyph = font.charToGlyph(char);
    pathData += glyph.getPath(cursor, y, fontSize).toPathData(2);
    cursor += (glyph.advanceWidth || font.unitsPerEm * 0.5) * scale;
  }

  return pathData;
}

async function makeBackground(imageUrl) {
  if (imageUrl) {
    try {
      const buffer = await fetchBuffer(imageUrl);
      return sharp(buffer)
        .resize(1080, 1920, { fit: "cover", position: "centre" })
        .modulate({ brightness: 0.86, saturation: 1.04 })
        .linear(1.03, -4);
    } catch (error) {
      logError("background-image", error);
    }
  }

  return sharp(Buffer.from(`
    <svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#101827"/>
          <stop offset="52%" stop-color="#7285f4"/>
          <stop offset="100%" stop-color="#060912"/>
        </linearGradient>
        <radialGradient id="r" cx="24%" cy="18%" r="60%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.24)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="1080" height="1920" fill="url(#g)"/>
      <rect width="1080" height="1920" fill="url(#r)"/>
      <style>${SVG_FONT_FACE}</style>
      <text x="70" y="940" font-family="GPressNoto, DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="118" font-weight="900" fill="rgba(255,255,255,0.10)">GPRESS</text>
    </svg>
  `)).resize(1080, 1920);
}

function makeOverlaySvg(item, hasLogo) {
  const categoryText = (item.category || "Вести").toUpperCase();
  const dateText = formatDate(item.pubDate);
  const titleLayout = layoutTitle(item.title);
  const lineHeight = Math.round(titleLayout.fontSize * 1.08);
  const titleBlockHeight = (titleLayout.lines.length - 1) * lineHeight + titleLayout.fontSize;
  const titleY = Math.max(1252, 1538 - titleBlockHeight);
  const categoryWidth = badgeWidth(categoryText);
  const categoryX = 86;

  const titleLines = titleLayout.lines.map((line, index) => {
    const y = titleY + index * lineHeight;
    return svgTextPath(line, 128, y, titleLayout.fontSize, "title", { weight: "bold", stroke: "#071121", strokeWidth: 4.2 });
  }).join("");

  return `<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(3,10,24,0.44)"/>
        <stop offset="58%" stop-color="rgba(3,10,24,0.14)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </linearGradient>
      <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,0.00)"/>
        <stop offset="24%" stop-color="rgba(255,255,255,0.58)"/>
        <stop offset="64%" stop-color="rgba(255,255,255,0.90)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0.98)"/>
      </linearGradient>
      <radialGradient id="spot" cx="50%" cy="72%" r="58%">
        <stop offset="0%" stop-color="rgba(114,133,244,0.12)"/>
        <stop offset="100%" stop-color="rgba(114,133,244,0)"/>
      </radialGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/>
      </filter>
      <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#ffffff" flood-opacity="0.22"/>
      </filter>
      <style>
        ${SVG_FONT_FACE}
        .brand { font-family: "GPressNoto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-weight: 900; letter-spacing: 0; fill: #fff; }
        .meta { font-family: "GPressNoto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-weight: 900; letter-spacing: 0; fill: #fff; }
        .date { font-family: "GPressNoto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-weight: 900; letter-spacing: 0; fill: #182437; }
        .title { font-family: "GPressNoto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-weight: 900; letter-spacing: 0; fill: #050b17; filter: url(#softShadow); }
        .footerLight { font-family: "GPressNoto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-weight: 900; letter-spacing: 0; fill: #26364c; }
        .footerAccent { font-family: "GPressNoto", "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-weight: 900; letter-spacing: 0; fill: #7285f4; }
      </style>
    </defs>
    <rect width="1080" height="390" fill="url(#topShade)"/>
    <rect y="770" width="1080" height="1150" fill="url(#bottomShade)"/>
    <rect y="770" width="1080" height="1150" fill="url(#spot)"/>
    ${hasLogo ? "" : svgTextPath("GOSTIVARPRESS", 86, 170, 58, "brand", { weight: "bold", filter: "url(#shadow)" })}
    <rect x="${categoryX}" y="1022" width="${categoryWidth}" height="72" rx="12" fill="#7285f4" opacity="1"/>
    ${svgTextPath(categoryText, categoryX + 24, 1070, 34, "meta", { weight: "bold", stroke: "#ffffff", strokeWidth: 1.6 })}
    ${svgTextPath(dateText, categoryX + categoryWidth + 34, 1072, 36, "date", { weight: "bold", stroke: "#182437", strokeWidth: 1.8 })}
    <rect x="86" y="${titleY - 58}" width="7" height="${Math.max(176, titleBlockHeight + 24)}" rx="4" fill="#7285f4"/>
    ${titleLines || svgTextPath(item.title, 128, titleY, 66, "title", { weight: "bold", stroke: "#071121", strokeWidth: 4.2 })}
    <circle cx="112" cy="1780" r="24" fill="none" stroke="#7285f4" stroke-width="6"/>
    <rect x="126" y="1770" width="34" height="6" rx="3" fill="#7285f4" transform="rotate(-35 126 1770)"/>
    ${svgTextPath("Повеќе на", 174, 1794, 38, "footerLight", { weight: "bold", stroke: "#26364c", strokeWidth: 1.8 })}
    ${svgTextPath("gostivarpress.mk", 370, 1794, 38, "footerAccent", { weight: "bold", stroke: "#7285f4", strokeWidth: 1.8 })}
  </svg>`;
}
async function loadLogoComposite() {
  try {
    let buffer = null;
    if (LOGO_URL) {
      buffer = await fetchBuffer(LOGO_URL);
    } else if (fss.existsSync(LOCAL_LOGO_PATH)) {
      buffer = await fs.readFile(LOCAL_LOGO_PATH);
    }

    if (!buffer) return null;

    const input = await sharp(buffer)
      .resize({ width: 430, height: 110, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const meta = await sharp(input).metadata();

    return {
      input,
      left: 86,
      top: Math.round(96 + (88 - Math.min(meta.height || 88, 88)) / 2)
    };
  } catch (error) {
    logError("logo", error);
    return null;
  }
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "gpress-story/3.0 (+https://gostivarpress.mk)"
    }
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function layoutTitle(title) {
  const clean = String(title || "").trim();
  const length = clean.length;
  const fontSize = length <= 55 ? 66 : length <= 95 ? 62 : length <= 140 ? 58 : 54;
  const maxChars = length <= 55 ? 20 : length <= 95 ? 23 : length <= 140 ? 26 : 29;
  const maxLines = 5;
  const words = clean.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length > maxLines) {
    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = truncateLine(visible[maxLines - 1], Math.max(8, maxChars - 3));
    return { fontSize, lines: visible };
  }

  return { fontSize, lines };
}

function truncateLine(line, maxChars) {
  const clean = String(line || "").trim();
  if (clean.length <= maxChars) return `${clean}...`;
  return `${clean.slice(0, maxChars).trim()}...`;
}

function badgeWidth(text) {
  return Math.min(380, Math.max(150, 62 + String(text || "").length * 18));
}

function badgeX(text) {
  return 1010 - badgeWidth(text);
}

async function dryRunPublish(item) {
  const rendered = await renderCardPng(item);
  const published = await readPublishedStore();
  return {
    ok: true,
    dryRun: true,
    alreadyPublished: Boolean(published.items[item.id]),
    imageUrl: rendered.imageUrl,
    title: item.title,
    link: item.link,
    wouldPublish: !published.items[item.id]
  };
}

async function publishItem(item, source) {
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    return {
      ok: false,
      error: "Missing IG_USER_ID or IG_ACCESS_TOKEN environment variables."
    };
  }

  const store = await readPublishedStore();
  if (store.items[item.id]?.status === "published") {
    return {
      ok: true,
      skipped: true,
      reason: "Already published.",
      item: store.items[item.id]
    };
  }

  const rendered = await renderCardPng(item);
  const recordBase = {
    id: item.id,
    title: item.title,
    link: item.link,
    imageUrl: rendered.imageUrl,
    source,
    updatedAt: new Date().toISOString()
  };

  try {
    const container = await graphPost(`https://graph.instagram.com/v23.0/${encodeURIComponent(IG_USER_ID)}/media`, {
      media_type: "STORIES",
      image_url: rendered.imageUrl,
      access_token: IG_ACCESS_TOKEN
    });

    if (!container.id) throw new Error("Instagram media container response did not include id.");

    const published = await graphPost(`https://graph.instagram.com/v23.0/${encodeURIComponent(IG_USER_ID)}/media_publish`, {
      creation_id: container.id,
      access_token: IG_ACCESS_TOKEN
    });

    if (!published.id) throw new Error("Instagram publish response did not include id.");

    const record = {
      ...recordBase,
      status: "published",
      instagramContainerId: container.id,
      instagramStoryId: published.id,
      publishedAt: new Date().toISOString()
    };
    store.items[item.id] = record;
    await writePublishedStore(store);
    logInfo("publish", `${item.id} ${item.title}`);

    return { ok: true, ...record };
  } catch (error) {
    const record = {
      ...recordBase,
      status: "failed",
      error: error.message || "Publish failed"
    };
    store.items[item.id] = record;
    await writePublishedStore(store);
    logError("publish", error);
    return { ok: false, ...record };
  }
}

async function graphPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    const message = json.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Instagram Graph API error: ${message}`);
  }
  return json;
}

async function checkAndPublishLatest() {
  const items = await getLatestItems();
  if (!items.length) return;

  const store = await readPublishedStore();
  const next = items.find((item) => store.items[item.id]?.status !== "published");
  if (!next) {
    logInfo("auto-publish", "No new posts.");
    return;
  }

  const result = await publishItem(next, "auto");
  if (!result.ok) {
    logError("auto-publish", new Error(result.error || "Publish failed"));
  }
}

async function readPublishedStore() {
  try {
    const raw = await fs.readFile(PUBLISHED_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      items: parsed && typeof parsed.items === "object" ? parsed.items : {}
    };
  } catch (error) {
    if (error.code === "ENOENT") return { items: {} };
    throw error;
  }
}

async function writePublishedStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PUBLISHED_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function serveCardFile(res, pathname) {
  const filename = path.basename(pathname);
  if (!/^story-[a-f0-9]{16}(?:-v[0-9]+)?\.png$/i.test(filename)) {
    return sendJson(res, 400, { ok: false, error: "Invalid card filename." });
  }

  const filePath = path.join(CARDS_DIR, filename);
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": "image/png",
      "cache-control": "no-store, max-age=0"
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(res, 404, { ok: false, error: "Card not found." });
    throw error;
  }
}

function renderHomePage(items, published) {
  const rows = items.map((item, index) => {
    const status = published.items[item.id]?.status || "new";
    return `
      <article class="post">
        ${item.image ? `<img src="${attr(item.image)}" alt="">` : `<div class="thumb-fallback"></div>`}
        <div class="post-body">
          <div class="meta">${escapeHtml(item.category || "Вести")} · ${escapeHtml(formatDate(item.pubDate))} · ${escapeHtml(status)}</div>
          <h2>${escapeHtml(item.title)}</h2>
          <div class="actions">
            <a href="/story?i=${index}" class="button">Preview</a>
            <a href="/render?i=${index}" class="button secondary">Generate PNG</a>
            <a href="/publish?i=${index}&dry=1" class="button ghost">Dry Run Publish</a>
            <a href="${attr(item.link)}" class="link" target="_blank" rel="noopener">Open Article</a>
          </div>
        </div>
      </article>
    `;
  }).join("");

  return `<!doctype html>
<html lang="mk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GPress Story V3</title>
  <style>
    :root { color-scheme: light; --accent: #7285f4; --ink: #111827; --muted: #667085; --panel: #fff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; background: #f4f6fb; color: var(--ink); }
    header { padding: 34px 22px 18px; max-width: 1080px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: clamp(30px, 5vw, 48px); letter-spacing: 0; }
    .sub { color: var(--muted); font-size: 16px; line-height: 1.5; }
    .status { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    .chip { padding: 9px 12px; border-radius: 999px; background: #fff; border: 1px solid #e5e7eb; font-weight: 800; color: #344054; }
    .chip.good { color: #087443; }
    .chip.warn { color: #b54708; }
    main { max-width: 1080px; margin: 0 auto; padding: 12px 22px 44px; display: grid; gap: 16px; }
    .post { display: grid; grid-template-columns: 210px 1fr; gap: 18px; background: var(--panel); border: 1px solid #e6e8ef; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 30px rgba(17,24,39,0.06); }
    .post img, .thumb-fallback { width: 100%; height: 100%; min-height: 160px; object-fit: cover; background: linear-gradient(135deg, #111827, var(--accent)); }
    .post-body { padding: 18px 18px 16px 0; }
    .meta { color: var(--accent); font-size: 13px; font-weight: 900; text-transform: uppercase; margin-bottom: 7px; }
    h2 { margin: 0 0 14px; font-size: 23px; line-height: 1.18; letter-spacing: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
    .button, .link { display: inline-flex; align-items: center; min-height: 38px; text-decoration: none; font-weight: 900; }
    .button { padding: 0 14px; color: #fff; background: var(--accent); border-radius: 8px; }
    .button.secondary { background: #101827; }
    .button.ghost { background: #eef1ff; color: #3442ad; }
    .link { color: var(--muted); }
    @media (max-width: 740px) {
      .post { grid-template-columns: 1fr; }
      .post img, .thumb-fallback { height: 220px; }
      .post-body { padding: 0 16px 18px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>GPress Story V3</h1>
    <div class="sub">RSS: ${escapeHtml(RSS_URL)}</div>
    <div class="status">
      <span class="chip ${IG_USER_ID && IG_ACCESS_TOKEN ? "good" : "warn"}">Instagram env: ${IG_USER_ID && IG_ACCESS_TOKEN ? "ready" : "missing"}</span>
      <span class="chip ${AUTO_PUBLISH_ENABLED ? "good" : "warn"}">Auto publish: ${AUTO_PUBLISH_ENABLED ? "true" : "false"}</span>
      <span class="chip">Public base: ${escapeHtml(PUBLIC_BASE_URL)}</span>
    </div>
  </header>
  <main>${rows || `<p>Нема достапни објави.</p>`}</main>
</body>
</html>`;
}

function renderStoryPreview(item) {
  if (!item) return renderNotFoundPage("Нема објава за избраниот индекс.");
  return renderStoryCardHtml(item);
}

function renderStoryCardHtml(item) {
  const logoSrc = assetDataUri(LOCAL_LOGO_PATH, "image/png");
  const background = item.image
    ? `url('${cssUrl(item.image)}')`
    : "linear-gradient(150deg, #111827 0%, #7285f4 52%, #060912 100%)";
  const category = item.category || "Вести";

  return `<!doctype html>
<html lang="mk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(item.title)} · Story Preview</title>
  <style>
    ${localFontCss()}
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101318; font-family: "GPressSans", Arial, sans-serif; }
    .story { width: 540px; aspect-ratio: 9 / 16; position: relative; overflow: hidden; background-image: ${background}; background-size: cover; background-position: center; color: #071121; box-shadow: 0 30px 90px rgba(0,0,0,.45); }
    .story::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,10,24,.46) 0%, rgba(5,10,24,.08) 34%, rgba(255,255,255,0) 48%), linear-gradient(180deg, rgba(255,255,255,0) 38%, rgba(255,255,255,.76) 60%, rgba(255,255,255,.98) 100%); }
    .logo { position: absolute; top: 58px; left: 42px; width: 210px; height: auto; z-index: 2; filter: drop-shadow(0 8px 20px rgba(0,0,0,.25)); }
    .content { position: absolute; left: 36px; right: 34px; bottom: 38px; z-index: 2; }
    .meta { display: flex; align-items: center; gap: 18px; margin-bottom: 52px; }
    .badge { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 16px; border-radius: 7px; background: #7285f4; color: #fff; font-size: 18px; line-height: 1; font-weight: 900; text-transform: uppercase; letter-spacing: 0; }
    .date { color: #172033; font-size: 19px; font-weight: 900; line-height: 1; }
    .headline-row { display: grid; grid-template-columns: 4px minmax(0, 1fr); column-gap: 14px; align-items: stretch; margin-bottom: 124px; }
    .accent { width: 4px; border-radius: 999px; background: #7285f4; }
    h1 { margin: -5px 0 0; max-width: 462px; color: #071121; font-size: ${storyTitleFontSize(item.title)}px; line-height: 1.06; font-weight: 900; letter-spacing: 0; text-wrap: balance; }
    .footer { display: flex; align-items: center; gap: 16px; color: #344054; font-size: 20px; font-weight: 900; line-height: 1; }
    .link-icon { width: 28px; height: 28px; border: 4px solid #7285f4; border-radius: 50%; position: relative; flex: 0 0 auto; }
    .link-icon::after { content: ""; position: absolute; width: 19px; height: 4px; border-radius: 999px; background: #7285f4; right: -13px; top: 3px; transform: rotate(-35deg); }
    .footer strong { color: #7285f4; font-weight: 900; }
    .nav { position: fixed; left: 18px; bottom: 18px; display: flex; gap: 10px; z-index: 20; }
    .nav a { color: #fff; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.20); border-radius: 10px; padding: 10px 12px; text-decoration: none; font-weight: 800; }
    @media (max-width: 620px) { .story { width: min(100vw, 540px); } }
  </style>
</head>
<body>
  <main class="story">
    ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="GPress">` : `<div class="logo" style="color:#fff;font-size:34px;font-weight:900">GPRESS</div>`}
    <section class="content">
      <div class="meta"><span class="badge">${escapeHtml(category)}</span><span class="date">${escapeHtml(formatDate(item.pubDate))}</span></div>
      <div class="headline-row"><span class="accent"></span><h1>${escapeHtml(item.title)}</h1></div>
      <footer class="footer"><span class="link-icon"></span><span>Повеќе на <strong>gostivarpress.mk</strong></span></footer>
    </section>
  </main>
</body>
</html>`;
}

function storyTitleFontSize(title) {
  const length = String(title || "").trim().length;
  if (length <= 55) return 45;
  if (length <= 95) return 41;
  if (length <= 140) return 37;
  return 33;
}

function localFontCss() {
  const regular = assetDataUri(FONT_REGULAR_PATH, "font/ttf");
  const bold = assetDataUri(FONT_BOLD_PATH, "font/ttf");
  if (!regular || !bold) return "";
  return `@font-face { font-family: "GPressSans"; src: url("${regular}") format("truetype"); font-weight: 700; font-style: normal; font-display: block; }
@font-face { font-family: "GPressSans"; src: url("${bold}") format("truetype"); font-weight: 800 900; font-style: normal; font-display: block; }`;
}

function assetDataUri(filePath, mimeType) {
  try {
    if (!fss.existsSync(filePath)) return "";
    return `data:${mimeType};base64,${fss.readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
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
  const months = [
    "јануари",
    "февруари",
    "март",
    "април",
    "мај",
    "јуни",
    "јули",
    "август",
    "септември",
    "октомври",
    "ноември",
    "декември"
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function stableId(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex").slice(0, 16);
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

function escapeXml(input) {
  return escapeHtml(input);
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

function logInfo(scope, message) {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}

function logError(scope, error) {
  const message = error?.message || String(error);
  console.error(`[${new Date().toISOString()}] [${scope}:error] ${message}`);
}

