const http = require("node:http");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(__dirname, ".ms-playwright");

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
const TOKEN_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const CARD_DESIGN_VERSION = "v18";

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const CARDS_DIR = path.join(PUBLIC_DIR, "cards");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLISHED_FILE = path.join(DATA_DIR, "published.json");
const TOKEN_FILE = path.join(DATA_DIR, "token.json");
let storedToken = loadStoredToken();
const LOCAL_LOGO_PATH = path.join(PUBLIC_DIR, "logo.png");
const PROMO_EXPORTS_DIR = path.join(ROOT_DIR, "exports", "promo");
const promoWordpress = require("./src/promo/wordpress");
const promoExport = require("./src/promo/exportPromoPackage");
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

    if (requestUrl.pathname === "/promo" && req.method === "GET") {
      return sendHtml(res, renderPromoHome());
    }

    if (requestUrl.pathname === "/promo/generate" && req.method === "POST") {
      const form = await readFormBody(req);
      const postUrl = String(form.get("url") || "").trim();
      if (!postUrl) return sendHtml(res, renderPromoHome("Внеси линк до објавата."));
      const post = await promoWordpress.fetchPostByUrl(postUrl);
      await promoExport.exportPromoPackage(post);
      return redirect(res, `/promo/${post.slug}`);
    }

    const promoAssetMatch = requestUrl.pathname.match(/^\/promo-assets\/([a-z0-9-]+)\/((?:uploads\/)?[a-z0-9._-]+\.(?:png|jpe?g|webp|txt))$/i);
    if (promoAssetMatch) {
      return servePromoAsset(res, promoAssetMatch[1], promoAssetMatch[2]);
    }

    const promoSaveMatch = requestUrl.pathname.match(/^\/promo\/([a-z0-9-]+)\/save$/i);
    if (promoSaveMatch && req.method === "POST") {
      const form = await readFormBody(req);
      await savePromoDataAndRegenerate(promoSaveMatch[1], form);
      return redirect(res, `/promo/${promoSaveMatch[1]}`);
    }

    const promoUploadMatch = requestUrl.pathname.match(/^\/promo\/([a-z0-9-]+)\/upload$/i);
    if (promoUploadMatch && req.method === "POST") {
      const upload = await readMultipartFile(req);
      await savePromoUpload(promoUploadMatch[1], upload);
      return redirect(res, `/promo/${promoUploadMatch[1]}`);
    }

    const promoStatusMatch = requestUrl.pathname.match(/^\/promo\/([a-z0-9-]+)\/status$/i);
    if (promoStatusMatch && req.method === "POST") {
      const form = await readFormBody(req);
      await setPromoStatus(promoStatusMatch[1], String(form.get("status") || ""));
      return redirect(res, `/promo/${promoStatusMatch[1]}`);
    }

    const promoPublishMatch = requestUrl.pathname.match(/^\/promo\/([a-z0-9-]+)\/publish$/i);
    if (promoPublishMatch && req.method === "POST") {
      const form = await readFormBody(req);
      const result = await publishPromoSet(promoPublishMatch[1], form.get("again") === "1");
      return sendHtml(res, renderPromoPublishResult(promoPublishMatch[1], result));
    }

    const promoDetailMatch = requestUrl.pathname.match(/^\/promo\/([a-z0-9-]+)$/i);
    if (promoDetailMatch && req.method === "GET") {
      return sendHtml(res, renderPromoDetail(promoDetailMatch[1]));
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

if (IG_ACCESS_TOKEN) {
  setTimeout(() => {
    refreshAccessToken().catch((error) => logError("token-refresh", error));
  }, 60_000).unref();

  setInterval(() => {
    refreshAccessToken().catch((error) => logError("token-refresh", error));
  }, TOKEN_REFRESH_INTERVAL_MS).unref();
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
  if (!IG_USER_ID || !currentAccessToken()) {
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
      access_token: currentAccessToken()
    });

    if (!container.id) throw new Error("Instagram media container response did not include id.");

    await waitForContainerReady(container.id);

    const published = await graphPost(`https://graph.instagram.com/v23.0/${encodeURIComponent(IG_USER_ID)}/media_publish`, {
      creation_id: container.id,
      access_token: currentAccessToken()
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

function loadStoredToken() {
  try {
    const parsed = JSON.parse(fss.readFileSync(TOKEN_FILE, "utf8"));
    return parsed && parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

function currentAccessToken() {
  return storedToken?.access_token || IG_ACCESS_TOKEN;
}

async function refreshAccessToken() {
  const token = currentAccessToken();
  if (!token) return;

  const json = await graphGet(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
  );

  if (!json.access_token) throw new Error("Refresh response did not include access_token.");

  storedToken = {
    access_token: json.access_token,
    expiresIn: json.expires_in,
    refreshedAt: new Date().toISOString()
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TOKEN_FILE, `${JSON.stringify(storedToken, null, 2)}\n`, "utf8");
  logInfo("token", `refreshed, valid for ${Math.round((json.expires_in || 0) / 86400)} days`);
}

async function waitForContainerReady(containerId) {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await graphGet(
      `https://graph.instagram.com/v23.0/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(currentAccessToken())}`
    );
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram container failed with status ${status.status_code}.`);
    }
    logInfo("publish", `container ${containerId} status ${status.status_code || "UNKNOWN"} (attempt ${attempt}/${maxAttempts})`);
    await sleep(2500);
  }
  throw new Error("Instagram container was not ready after 30 seconds.");
}

async function graphGet(url) {
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok || json.error) {
    const message = json.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Instagram Graph API error: ${message}`);
  }
  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      <span class="chip ${IG_USER_ID && currentAccessToken() ? "good" : "warn"}">Instagram env: ${IG_USER_ID && currentAccessToken() ? "ready" : "missing"}</span>
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
  const catColors = categoryColor(category);
  const badgeBackground = catColors.badge || catColors.solid;
  const accentBackground = catColors.accent || catColors.solid;

  return `<!doctype html>
<html lang="mk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(item.title)} · Story Preview</title>
  <script>
    (function () {
      function fit() {
        var w = document.documentElement.clientWidth;
        var h = document.documentElement.clientHeight;
        var scale = Math.min(1, w / 540, h / 960);
        document.documentElement.style.setProperty("--fit", scale);
      }
      fit();
      window.addEventListener("resize", fit);
    })();
  </script>
  <style>
    ${localFontCss()}
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; background: #101318; font-family: "GPressSans", Arial, sans-serif; }
    .stage { width: calc(540px * var(--fit, 1)); height: calc(960px * var(--fit, 1)); }
    .story { width: 540px; height: 960px; position: relative; overflow: hidden; background-image: ${background}; background-size: cover; background-position: center; color: #071121; box-shadow: 0 30px 90px rgba(0,0,0,.45); transform: scale(var(--fit, 1)); transform-origin: top left; }
    .story::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,10,24,.42) 0%, rgba(5,10,24,.05) 28%, rgba(5,10,24,0) 40%), linear-gradient(180deg, rgba(6,11,22,0) 38%, rgba(6,11,22,.55) 54%, rgba(6,10,20,.86) 68%, rgba(5,9,18,.98) 100%); }
    .logo { position: absolute; top: 28px; right: 34px; width: 210px; height: auto; z-index: 2; filter: drop-shadow(0 8px 20px rgba(0,0,0,.25)); }
    .content { position: absolute; left: 36px; right: 34px; bottom: 44px; z-index: 2; }
    .meta { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
    .badge { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 16px; border-radius: 8px; background: ${badgeBackground}; color: #fff; font-size: 18px; line-height: 1; font-weight: 900; text-transform: uppercase; letter-spacing: 0.4px; box-shadow: 0 6px 18px rgba(4,8,18,.30); }
    .date { color: rgba(235,240,252,.82); font-size: 18px; font-weight: 700; line-height: 1; }
    .headline-row { display: grid; grid-template-columns: 4px minmax(0, 1fr); column-gap: 14px; align-items: stretch; margin-bottom: 60px; }
    .accent { width: 4px; border-radius: 999px; background: ${accentBackground}; }
    h1 { margin: -5px 0 0; max-width: 462px; color: #ffffff; font-size: ${storyTitleFontSize(item.title)}px; line-height: 1.12; font-weight: 900; letter-spacing: 0; text-wrap: balance; text-shadow: 0 2px 26px rgba(0,0,0,.45); }
    .footer { display: flex; align-items: center; gap: 14px; color: rgba(255,255,255,.64); font-size: 20px; font-weight: 700; line-height: 1; }
    .link-icon { width: 26px; height: 26px; border: 4px solid ${catColors.solid}; border-radius: 50%; position: relative; flex: 0 0 auto; }
    .link-icon::after { content: ""; position: absolute; width: 18px; height: 4px; border-radius: 999px; background: ${catColors.solid}; right: -12px; top: 3px; transform: rotate(-35deg); }
    .footer strong { color: ${BRAND_COLOR}; font-weight: 900; }
    .nav { position: fixed; left: 18px; bottom: 18px; display: flex; gap: 10px; z-index: 20; }
    .nav a { color: #fff; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.20); border-radius: 10px; padding: 10px 12px; text-decoration: none; font-weight: 800; }
  </style>
</head>
<body>
  <div class="stage">
    <main class="story">
      ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="GPress">` : `<div class="logo" style="color:#fff;font-size:34px;font-weight:900">GPRESS</div>`}
      <section class="content">
        <div class="meta"><span class="badge">${escapeHtml(category)}</span><span class="date">${escapeHtml(formatDate(item.pubDate))}</span></div>
        <div class="headline-row"><span class="accent"></span><h1>${escapeHtml(item.title)}</h1></div>
        <footer class="footer"><span class="link-icon"></span><span>Повеќе на <strong>Gostivarpress.mk</strong></span></footer>
      </section>
    </main>
  </div>
</body>
</html>`;
}

const BRAND_COLOR = "#7285F4";

// Ordered: more specific keys first ("гостиварски" before "гостивар").
// Subcategories inherit via substring match on the main category name.
const CATEGORY_COLORS = [
  ["гостиварски", { solid: "#4557D6" }],
  ["гостивар", { solid: "#4F46E5" }],
  ["македонија", { solid: "#DC2626" }],
  ["свет", { solid: "#D97706" }],
  ["спорт", { solid: "#84CC16" }],
  ["култура", { solid: "#7285F4" }],
  ["живот", { solid: "#5B6EE8" }],
  ["магазин", { solid: "#F43F5E" }],
  ["занимливости", { solid: "#65A30D" }],
  ["вести", { solid: "#7285F4" }],
  ["здравје", { solid: "#C084FC" }],
  ["фото", {
    solid: "#FF4D6D",
    badge: "linear-gradient(90deg,#FF4D6D,#F59E0B,#3B82F6)",
    accent: "linear-gradient(180deg,#FF4D6D,#F59E0B,#3B82F6)"
  }],
  ["видео", { solid: "#7285F4" }],
  ["камери", { solid: "#7285F4" }],
  ["радио", { solid: "#7285F4" }]
];

function categoryColor(category) {
  const normalized = String(category || "").toLowerCase();
  for (const [key, colors] of CATEGORY_COLORS) {
    if (normalized.includes(key)) return colors;
  }
  return { solid: BRAND_COLOR };
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
function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function promoSlugDir(slug) {
  if (!/^[a-z0-9-]+$/i.test(slug)) throw new Error("Invalid promo slug.");
  return path.join(PROMO_EXPORTS_DIR, slug);
}

function readPromoSidecar(slug) {
  const sidecarPath = path.join(promoSlugDir(slug), "promo-data.json");
  if (!fss.existsSync(sidecarPath)) return null;
  return JSON.parse(fss.readFileSync(sidecarPath, "utf8"));
}

function readPromoPublishLog(slug) {
  const logPath = path.join(promoSlugDir(slug), "publish-log.json");
  if (!fss.existsSync(logPath)) return null;
  try {
    return JSON.parse(fss.readFileSync(logPath, "utf8"));
  } catch {
    return null;
  }
}

const PROMO_CARD_LABELS = {
  story1: "Story 1 — Ново во Гостивар",
  story2: "Story 2 — Што нуди",
  story3: "Story 3 — Локација и контакт",
  feed: "Feed картичка 4:5",
  square: "Facebook квадрат 1:1"
};

async function savePromoDataAndRegenerate(slug, form) {
  const sidecar = readPromoSidecar(slug);
  if (!sidecar) throw new Error("Promo set not found. Generate it first.");

  const textFields = [
    "business_name", "badge_text", "story1_heading", "story1_description",
    "story2_heading", "story3_heading", "address", "working_hours",
    "phone", "instagram", "facebook", "maps_link"
  ];
  for (const field of textFields) {
    if (form.has(field)) sidecar[field] = String(form.get(field) || "").trim();
  }
  if (form.has("offer_items")) {
    sidecar.offer_items = String(form.get("offer_items") || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (form.has("status") && promoExport.PROMO_STATUSES.includes(form.get("status"))) {
    sidecar.status = form.get("status");
  }
  if (form.has("theme") && Object.keys(promoExport.THEMES).includes(form.get("theme"))) {
    sidecar.theme = form.get("theme");
  }
  sidecar.colors = sidecar.colors || {};
  for (const colorKey of ["primary", "secondary", "accent", "overlay", "badge"]) {
    const value = String(form.get(`color_${colorKey}`) || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) sidecar.colors[colorKey] = value.toUpperCase();
  }

  sidecar.images = sidecar.images || {};
  for (const cardKey of promoExport.CARD_KEYS) {
    const current = sidecar.images[cardKey] || {};
    const source = String(form.get(`img_${cardKey}_source`) || current.source || "featured");
    sidecar.images[cardKey] = {
      source,
      url: String(form.get(`img_${cardKey}_url`) || current.url || "").trim(),
      x: Number(form.get(`img_${cardKey}_x`) ?? current.x ?? 50),
      y: Number(form.get(`img_${cardKey}_y`) ?? current.y ?? 50),
      zoom: Number(form.get(`img_${cardKey}_zoom`) ?? current.zoom ?? 1),
      overlay: Number(form.get(`img_${cardKey}_overlay`) ?? current.overlay ?? 1),
      fit: form.get(`img_${cardKey}_fit`) === "contain" ? "contain" : "cover"
    };
  }

  const exportDir = promoSlugDir(slug);
  await fs.writeFile(path.join(exportDir, "promo-data.json"), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

  const post = await promoWordpress.fetchPostByUrl(sidecar.article_url);
  await promoExport.exportPromoPackage(post, { exportDir });
}

async function setPromoStatus(slug, status) {
  const sidecar = readPromoSidecar(slug);
  if (!sidecar) throw new Error("Promo set not found.");
  if (!promoExport.PROMO_STATUSES.includes(status)) throw new Error("Invalid status.");
  sidecar.status = status;
  await fs.writeFile(path.join(promoSlugDir(slug), "promo-data.json"), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
}

async function savePromoUpload(slug, upload) {
  const uploadsDir = path.join(promoSlugDir(slug), "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const extension = (upload.filename.match(/\.(png|jpe?g|webp)$/i) || [])[0];
  if (!extension) throw new Error("Дозволени се само PNG, JPG и WEBP слики.");
  const base = upload.filename
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "slika";
  const filename = `${base}-${Date.now()}${extension.toLowerCase()}`;
  await fs.writeFile(path.join(uploadsDir, filename), upload.buffer);
  return filename;
}

function listPromoUploads(slug) {
  const uploadsDir = path.join(promoSlugDir(slug), "uploads");
  if (!fss.existsSync(uploadsDir)) return [];
  return fss.readdirSync(uploadsDir).filter((file) => /\.(png|jpe?g|webp)$/i.test(file));
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("Фајлот е преголем (максимум 15 MB)."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readMultipartFile(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) throw new Error("Missing multipart boundary.");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = await readRawBody(req, 15 * 1024 * 1024);

  let position = body.indexOf(boundary);
  while (position !== -1) {
    const start = position + boundary.length + 2;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    const part = body.slice(start, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const filenameMatch = headers.match(/filename="([^"]*)"/i);
      if (filenameMatch && filenameMatch[1]) {
        return { filename: path.basename(filenameMatch[1]), buffer: part.slice(headerEnd + 4) };
      }
    }
    position = next;
  }
  throw new Error("Не е избран фајл за качување.");
}

async function publishPromoSet(slug, publishAgain) {
  const exportDir = promoSlugDir(slug);
  const sidecar = readPromoSidecar(slug);
  if (!sidecar) return { ok: false, error: "Promo сетот не постои." };

  if (!IG_USER_ID || !currentAccessToken()) {
    return { ok: false, error: "Недостасуваат IG_USER_ID / IG_ACCESS_TOKEN на серверот." };
  }

  const existingLog = readPromoPublishLog(slug);
  if (existingLog && !publishAgain) {
    return { ok: false, error: `Овој сет е веќе објавен на ${existingLog.publishedAt}. Кликни „Објави повторно" ако намерно сакаш пак.` };
  }

  const storyFiles = ["01-story-novo-vo-gostivar.png", "02-story-sto-nudi.png", "03-story-lokacija-kontakt.png"];
  for (const file of storyFiles) {
    if (!fss.existsSync(path.join(exportDir, file))) {
      return { ok: false, error: `Недостасува ${file} — регенерирај го сетот прво.` };
    }
  }

  const results = [];
  for (const file of storyFiles) {
    const imageUrl = `${PUBLIC_BASE_URL}/promo-assets/${slug}/${file}`;
    const container = await graphPost(`https://graph.instagram.com/v23.0/${encodeURIComponent(IG_USER_ID)}/media`, {
      media_type: "STORIES",
      image_url: imageUrl,
      access_token: currentAccessToken()
    });
    if (!container.id) throw new Error(`Instagram не врати container id за ${file}.`);
    await waitForContainerReady(container.id);
    const published = await graphPost(`https://graph.instagram.com/v23.0/${encodeURIComponent(IG_USER_ID)}/media_publish`, {
      creation_id: container.id,
      access_token: currentAccessToken()
    });
    if (!published.id) throw new Error(`Instagram не врати story id за ${file}.`);
    results.push({ file, storyId: published.id });
    logInfo("promo-publish", `${slug} ${file} -> ${published.id}`);
  }

  const log = { publishedAt: new Date().toISOString(), slug, stories: results };
  await fs.writeFile(path.join(exportDir, "publish-log.json"), `${JSON.stringify(log, null, 2)}\n`, "utf8");
  await setPromoStatus(slug, "Published");
  return { ok: true, ...log };
}

async function servePromoAsset(res, slug, filename) {
  try {
    const data = await fs.readFile(path.join(promoSlugDir(slug), filename));
    const extension = filename.split(".").pop().toLowerCase();
    const contentTypes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain; charset=utf-8" };
    res.writeHead(200, { "content-type": contentTypes[extension] || "application/octet-stream", "cache-control": "no-store, max-age=0" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(res, 404, { ok: false, error: "Asset not found." });
    throw error;
  }
}

const PROMO_PAGE_CSS = `
    :root { color-scheme: light; --accent: #7285f4; --ink: #111827; --muted: #667085; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; background: #f4f6fb; color: var(--ink); }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 30px 22px 60px; }
    h1 { margin: 0 0 6px; font-size: clamp(26px, 4vw, 38px); }
    h2 { margin: 26px 0 12px; font-size: 20px; }
    .sub { color: var(--muted); margin-bottom: 20px; }
    .panel { background: #fff; border: 1px solid #e6e8ef; border-radius: 14px; padding: 18px; margin-bottom: 16px; box-shadow: 0 12px 30px rgba(17,24,39,0.06); }
    label { display: block; font-size: 13px; font-weight: 800; color: #344054; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: .4px; }
    input[type=text], input[type=url], textarea { width: 100%; padding: 10px 12px; border: 1px solid #d7dbe6; border-radius: 8px; font-size: 15px; font-family: inherit; }
    textarea { min-height: 90px; }
    .button { display: inline-flex; align-items: center; min-height: 40px; padding: 0 18px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 900; font-size: 15px; cursor: pointer; text-decoration: none; }
    .button.dark { background: #101827; }
    .button.danger { background: #dc2626; }
    .button.ghost { background: #eef1ff; color: #3442ad; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
    .cards figure { margin: 0; }
    .cards img { width: 100%; border-radius: 10px; border: 1px solid #e6e8ef; display: block; }
    .cards figcaption { font-size: 12px; color: var(--muted); margin-top: 6px; text-align: center; }
    .row-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; align-items: center; }
    .note { font-size: 13px; color: var(--muted); }
    .ok { color: #087443; font-weight: 800; }
    .warn { color: #b54708; font-weight: 800; }
    pre { background: #f8f9fd; border: 1px solid #e6e8ef; border-radius: 8px; padding: 12px; font-size: 13px; white-space: pre-wrap; }
    a.back { color: var(--muted); text-decoration: none; font-weight: 700; }
`;

function listPromoSets() {
  if (!fss.existsSync(PROMO_EXPORTS_DIR)) return [];
  return fss.readdirSync(PROMO_EXPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const slug = entry.name;
      let name = slug;
      let status = "Generated";
      try {
        const sidecar = readPromoSidecar(slug);
        name = sidecar?.business_name || slug;
        status = sidecar?.status || "Generated";
      } catch {}
      return { slug, name, status, published: Boolean(readPromoPublishLog(slug)) };
    });
}

function renderPromoHome(message = "") {
  const sets = listPromoSets();
  const rows = sets.map((set) => `
    <div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div>
        <strong>${escapeHtml(set.name)}</strong>
        <div class="note">${escapeHtml(set.slug)} · ${escapeHtml(set.status)} · ${set.published ? '<span class="ok">објавено</span>' : '<span class="warn">необјавено</span>'}</div>
      </div>
      <a class="button ghost" href="/promo/${escapeHtml(set.slug)}">Отвори</a>
    </div>`).join("");

  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GPress Promo</title><style>${PROMO_PAGE_CSS}</style></head>
<body><div class="wrap">
  <h1>GPress Promo</h1>
  <div class="sub">Промо пакети за клиенти — генерирај, прегледај, измени, па објави рачно. <a class="back" href="/">← кон вестите</a></div>
  ${message ? `<div class="panel warn">${escapeHtml(message)}</div>` : ""}
  <div class="panel">
    <form method="post" action="/promo/generate">
      <label>Линк до WordPress објавата</label>
      <input type="url" name="url" placeholder="https://gostivarpress.mk/..." required>
      <div class="row-actions">
        <button class="button" type="submit">Генерирај промо сет</button>
        <span class="note">Генерирањето НЕ објавува ништо — само прави преглед.</span>
      </div>
    </form>
  </div>
  <h2>Постоечки сетови</h2>
  ${rows || '<div class="note">Сè уште нема генерирани промо сетови.</div>'}
</div></body></html>`;
}

function renderPromoDetail(slug) {
  const sidecar = readPromoSidecar(slug);
  if (!sidecar) return renderNotFoundPage("Promo сетот не постои. Генерирај го прво од /promo.");

  const exportDir = promoSlugDir(slug);
  const publishLog = readPromoPublishLog(slug);
  const uploads = listPromoUploads(slug);
  const postImages = sidecar.post_images || [];
  const colors = { ...promoExport.THEMES.default, ...(sidecar.colors || {}) };
  const exportFiles = [
    "01-story-novo-vo-gostivar.png", "02-story-sto-nudi.png", "03-story-lokacija-kontakt.png",
    "04-feed-4x5.png", "05-facebook-1x1.png",
    "caption-facebook.txt", "caption-instagram.txt", "caption-telegram.txt"
  ].filter((file) => fss.existsSync(path.join(exportDir, file)));
  const imageFiles = exportFiles.filter((file) => file.endsWith(".png"));
  const bust = Date.now();
  const figures = imageFiles.map((file) => `
    <figure>
      <a href="/promo-assets/${escapeHtml(slug)}/${escapeHtml(file)}" target="_blank" rel="noopener"><img src="/promo-assets/${escapeHtml(slug)}/${escapeHtml(file)}?t=${bust}" alt=""></a>
      <figcaption>${escapeHtml(file)}</figcaption>
    </figure>`).join("");

  const captions = ["caption-facebook.txt", "caption-instagram.txt", "caption-telegram.txt"]
    .filter((file) => fss.existsSync(path.join(exportDir, file)))
    .map((file) => `<h2>${escapeHtml(file.replace("caption-", "").replace(".txt", ""))}</h2><pre>${escapeHtml(fss.readFileSync(path.join(exportDir, file), "utf8"))}</pre>`)
    .join("");

  let metaWarnings = [];
  try {
    const meta = JSON.parse(fss.readFileSync(path.join(exportDir, "export-meta.json"), "utf8"));
    metaWarnings = meta.warnings || [];
  } catch {}

  const field = (name, label, value) => `<label>${escapeHtml(label)}</label><input type="text" name="${name}" value="${escapeHtml(value || "")}">`;
  const selectedAttr = (a, b) => (String(a) === String(b) ? " selected" : "");

  const statusOptions = promoExport.PROMO_STATUSES
    .map((status) => `<option value="${status}"${selectedAttr(sidecar.status, status)}>${status}</option>`).join("");
  const themeOptions = Object.keys(promoExport.THEMES)
    .map((theme) => `<option value="${theme}"${selectedAttr(sidecar.theme, theme)}>${theme}</option>`).join("");

  const colorField = (key, label) => `
    <div style="display:inline-block;margin-right:14px;">
      <label>${escapeHtml(label)}</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="color" name="color_${key}" value="${escapeHtml(colors[key] || "#7285F4")}" style="width:44px;height:36px;padding:2px;border:1px solid #d7dbe6;border-radius:8px;">
        <code style="font-size:12px;">${escapeHtml(colors[key] || "")}</code>
      </div>
    </div>`;

  const imageSourceOptions = (config) => {
    const options = [];
    options.push(`<option value="featured"${selectedAttr(config.source, "featured")}>Главна слика од објавата</option>`);
    postImages.forEach((url, index) => {
      if (index === 0) return;
      options.push(`<option value="post:${index}"${selectedAttr(config.source, `post:${index}`)}>Слика ${index + 1} од објавата</option>`);
    });
    for (const file of uploads) {
      options.push(`<option value="upload:${escapeHtml(file)}"${selectedAttr(config.source, `upload:${file}`)}>Качена: ${escapeHtml(file)}</option>`);
    }
    options.push(`<option value="url"${selectedAttr(config.source, "url")}>URL (внеси долу)</option>`);
    options.push(`<option value="none"${selectedAttr(config.source, "none")}>Без слика (бренд позадина)</option>`);
    return options.join("");
  };

  const imageControls = promoExport.CARD_KEYS.map((cardKey) => {
    const config = (sidecar.images || {})[cardKey] || { source: "featured", url: "", x: 50, y: 50, zoom: 1, overlay: 1, fit: "cover" };
    return `
    <details style="margin-bottom:10px;">
      <summary style="cursor:pointer;font-weight:800;">${escapeHtml(PROMO_CARD_LABELS[cardKey])}</summary>
      <div style="padding:10px 4px 4px;">
        <label>Извор на слика</label>
        <select name="img_${cardKey}_source">${imageSourceOptions(config)}</select>
        <label>URL на слика (само ако изворот е URL)</label>
        <input type="text" name="img_${cardKey}_url" value="${escapeHtml(config.url || "")}" placeholder="https://...">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
          <div><label>Позиција X % (0-100)</label><input type="number" name="img_${cardKey}_x" min="0" max="100" step="1" value="${Number(config.x) || 50}"></div>
          <div><label>Позиција Y % (0-100)</label><input type="number" name="img_${cardKey}_y" min="0" max="100" step="1" value="${Number(config.y) || 50}"></div>
          <div><label>Zoom (1-3)</label><input type="number" name="img_${cardKey}_zoom" min="1" max="3" step="0.05" value="${Number(config.zoom) || 1}"></div>
          <div><label>Overlay јачина (0-1.5)</label><input type="number" name="img_${cardKey}_overlay" min="0" max="1.5" step="0.05" value="${Number(config.overlay) >= 0 ? Number(config.overlay) : 1}"></div>
          <div><label>Пополнување</label><select name="img_${cardKey}_fit"><option value="cover"${selectedAttr(config.fit, "cover")}>cover (исечи)</option><option value="contain"${selectedAttr(config.fit, "contain")}>contain (цела слика)</option></select></div>
        </div>
      </div>
    </details>`;
  }).join("");

  const postImageThumbs = postImages.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">${postImages.map((url, index) => `
        <figure style="margin:0;width:92px;text-align:center;">
          <img src="${escapeHtml(url)}" alt="" style="width:92px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #e6e8ef;">
          <figcaption class="note">${index === 0 ? "главна" : `слика ${index + 1}`}</figcaption>
        </figure>`).join("")}</div>`
    : `<div class="note">Објавата нема слики — користи URL или качи слика.</div>`;

  const downloads = exportFiles.map((file) => `<a class="button ghost" style="margin:4px 6px 4px 0;" href="/promo-assets/${escapeHtml(slug)}/${escapeHtml(file)}" download>${escapeHtml(file)}</a>`).join("");

  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(sidecar.business_name || slug)} · GPress Promo</title><style>${PROMO_PAGE_CSS}</style></head>
<body><div class="wrap">
  <a class="back" href="/promo">← сите промо сетови</a>
  <h1>${escapeHtml(sidecar.business_name || slug)}</h1>
  <div class="sub">${escapeHtml(sidecar.article_url || "")} · статус: <strong>${escapeHtml(sidecar.status || "Generated")}</strong></div>
  ${publishLog ? `<div class="panel"><span class="ok">Објавено на Instagram: ${escapeHtml(publishLog.publishedAt)}</span></div>` : ""}
  ${metaWarnings.length ? `<div class="panel"><span class="warn">Предупредувања од последното генерирање:</span><ul>${metaWarnings.map((w) => `<li class="note">${escapeHtml(w)}</li>`).join("")}</ul></div>` : ""}

  <h2>Преглед на картичките</h2>
  <div class="cards">${figures}</div>

  <h2>Уреди го сетот</h2>
  <div class="panel">
    <form method="post" action="/promo/${escapeHtml(slug)}/save">
      <h2 style="margin-top:0;">Текстови</h2>
      ${field("badge_text", "Беџ текст (default: Промотивно)", sidecar.badge_text)}
      ${field("story1_heading", "Story 1 наслов (default: Ново во Гостивар)", sidecar.story1_heading)}
      ${field("business_name", "Име на бизнис / клиент", sidecar.business_name)}
      <label>Story 1 краток опис</label><textarea name="story1_description">${escapeHtml(sidecar.story1_description || "")}</textarea>
      ${field("story2_heading", "Story 2 наслов (default: Што нуди?)", sidecar.story2_heading)}
      <label>Понуда (една ставка по ред, 3-5 ставки)</label><textarea name="offer_items">${escapeHtml((sidecar.offer_items || []).join("\n"))}</textarea>
      ${field("story3_heading", "Story 3 наслов (default: Локација и контакт)", sidecar.story3_heading)}
      ${field("address", "Адреса", sidecar.address)}
      ${field("working_hours", "Работно време", sidecar.working_hours)}
      ${field("phone", "Телефон", sidecar.phone)}
      ${field("instagram", "Instagram", sidecar.instagram)}
      ${field("facebook", "Facebook", sidecar.facebook)}

      <h2>Тема и бои</h2>
      <label>Preset тема</label>
      <select name="theme">${themeOptions}</select>
      <div class="note" style="margin:6px 0 10px;">Изберi „custom" за рачните бои долу да важат; со preset тема боите доаѓаат од темата.</div>
      <div>
        ${colorField("primary", "Primary")}
        ${colorField("secondary", "Secondary")}
        ${colorField("accent", "Accent")}
        ${colorField("overlay", "Overlay")}
        ${colorField("badge", "Badge")}
      </div>

      <h2>Слики по картичка</h2>
      <div class="note" style="margin-bottom:8px;">Слики во објавата:</div>
      ${postImageThumbs}
      <div style="margin-top:12px;">${imageControls}</div>

      <h2>Статус</h2>
      <select name="status">${statusOptions}</select>

      <div class="row-actions">
        <button class="button dark" type="submit">Зачувај и регенерирај</button>
        <span class="note">Регенерирањето ги преправа сликите — сè уште ништо не се објавува.</span>
      </div>
    </form>
  </div>

  <h2>Качи нова слика</h2>
  <div class="panel">
    <form method="post" action="/promo/${escapeHtml(slug)}/upload" enctype="multipart/form-data">
      <input type="file" name="file" accept=".png,.jpg,.jpeg,.webp" required>
      <div class="row-actions">
        <button class="button ghost" type="submit">Качи</button>
        <span class="note">По качувањето, сликата се појавува во „Извор на слика" за секоја картичка.</span>
      </div>
    </form>
    ${uploads.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${uploads.map((file) => `
      <figure style="margin:0;width:92px;text-align:center;">
        <img src="/promo-assets/${escapeHtml(slug)}/uploads/${escapeHtml(file)}" alt="" style="width:92px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #e6e8ef;">
        <figcaption class="note">${escapeHtml(file)}</figcaption>
      </figure>`).join("")}</div>` : ""}
  </div>

  <h2>Download / Export</h2>
  <div class="panel">
    ${downloads || '<span class="note">Уште нема генерирани фајлови.</span>'}
    <div class="note" style="margin-top:8px;">Фолдер на серверот: exports/promo/${escapeHtml(slug)}/</div>
  </div>

  <h2>Одобрување</h2>
  <div class="panel">
    <form method="post" action="/promo/${escapeHtml(slug)}/status" style="display:inline;">
      <input type="hidden" name="status" value="Approved">
      <button class="button ghost" type="submit">Одобри (без објава)</button>
    </form>
  </div>

  ${captions}

  <h2>Објавување</h2>
  <div class="panel">
    <form method="post" action="/promo/${escapeHtml(slug)}/publish" onsubmit="return confirm('Сигурно? Ова ВЕДНАШ објавува 3 стории на Instagram профилот.');">
      ${publishLog ? '<input type="hidden" name="again" value="1">' : ""}
      <div class="row-actions">
        <button class="button ${publishLog ? "danger" : ""}" type="submit">${publishLog ? "Објави повторно (3 стории)" : "Одобри и објави 3 стории на Instagram"}</button>
        <span class="note">Story 1 → Story 2 → Story 3, по ред. Feed/square картичките и caption текстовите се за рачна употреба.</span>
      </div>
    </form>
  </div>
</div></body></html>`;
}

function renderPromoPublishResult(slug, result) {
  const body = result.ok
    ? `<div class="panel"><span class="ok">Успешно објавени ${result.stories.length} стории.</span><pre>${escapeHtml(JSON.stringify(result.stories, null, 2))}</pre></div>`
    : `<div class="panel"><span class="warn">${escapeHtml(result.error)}</span></div>`;
  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Објавување · GPress Promo</title><style>${PROMO_PAGE_CSS}</style></head>
<body><div class="wrap">
  <a class="back" href="/promo/${escapeHtml(slug)}">← назад кон сетот</a>
  <h1>Објавување</h1>
  ${body}
</div></body></html>`;
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

