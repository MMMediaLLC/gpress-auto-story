const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const BRAND = require(path.join(ROOT, "src", "brand", "brand.config.json"));
const templates = require("./templates/promoTemplates");
const { withBrowser, renderHtmlToPng } = require("./renderPng");

const EXPORTS_DIR = path.join(ROOT, "exports", "promo");

const PROMO_STATUSES = ["Draft", "Generated", "Needs Review", "Approved", "Exported", "Published"];

const THEMES = {
  default: { primary: "#7285F4", secondary: "#141D36", accent: "#93A5FF", overlay: "#060B16", badge: "#7285F4" },
  food: { primary: "#F97316", secondary: "#2A1608", accent: "#FACC15", overlay: "#1A0E05", badge: "#F97316" },
  beauty: { primary: "#EC4899", secondary: "#2B0F1E", accent: "#F9A8D4", overlay: "#1D0A15", badge: "#EC4899" },
  health: { primary: "#14B8A6", secondary: "#0A211E", accent: "#5EEAD4", overlay: "#06211E", badge: "#14B8A6" },
  auto: { primary: "#3B82F6", secondary: "#0B1626", accent: "#93C5FD", overlay: "#050D1A", badge: "#3B82F6" },
  security: { primary: "#DC2626", secondary: "#220A0A", accent: "#FCA5A5", overlay: "#170606", badge: "#DC2626" },
  retail: { primary: "#84CC16", secondary: "#141F06", accent: "#D9F99D", overlay: "#0D1503", badge: "#84CC16" },
  custom: null
};

const CARD_KEYS = ["story1", "story2", "story3", "feed", "square"];

function defaultImageConfig(source) {
  return { source, url: "", x: 50, y: 50, zoom: 1, overlay: 1, fit: "cover" };
}

function postImageList(post) {
  const list = [];
  if (post.featuredImage) list.push(post.featuredImage);
  for (const url of post.images) {
    if (!list.includes(url)) list.push(url);
  }
  return list;
}

function promoDataSkeleton(post) {
  const images = postImageList(post);
  return {
    status: "Generated",
    business_name: post.title,
    badge_text: BRAND.promoLabel,
    story1_heading: "Ново во Гостивар",
    story1_description: post.excerpt,
    story2_heading: "Што нуди?",
    offer_items: post.listItems.slice(0, BRAND.typography.maxOfferItems),
    story3_heading: "Локација и контакт",
    address: "",
    working_hours: "",
    phone: "",
    instagram: "",
    facebook: "",
    maps_link: "",
    article_url: post.link,
    post_images: images,
    theme: "default",
    colors: { ...THEMES.default },
    images: {
      story1: defaultImageConfig("featured"),
      story2: defaultImageConfig(images.length > 1 ? "post:1" : "featured"),
      story3: defaultImageConfig(images.length > 2 ? "post:2" : (images.length ? "featured" : "none")),
      feed: defaultImageConfig("featured"),
      square: defaultImageConfig("featured")
    }
  };
}

function migratePromoData(sidecar, post) {
  const skeleton = promoDataSkeleton(post);
  const merged = { ...skeleton, ...sidecar };

  if (!sidecar.story1_description && sidecar.short_intro) merged.story1_description = sidecar.short_intro;
  merged.post_images = skeleton.post_images;
  merged.colors = { ...skeleton.colors, ...(sidecar.colors || {}) };
  merged.images = {};
  for (const key of CARD_KEYS) {
    merged.images[key] = { ...skeleton.images[key], ...((sidecar.images || {})[key] || {}) };
  }
  if (!PROMO_STATUSES.includes(merged.status)) merged.status = "Generated";
  if (!Object.keys(THEMES).includes(merged.theme)) merged.theme = "custom";
  return merged;
}

function loadOrCreatePromoData(post, exportDir) {
  const sidecarPath = path.join(exportDir, "promo-data.json");
  if (fs.existsSync(sidecarPath)) {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    const data = migratePromoData(raw, post);
    fs.writeFileSync(sidecarPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return { data, sidecarPath, created: false };
  }
  const skeleton = promoDataSkeleton(post);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(sidecarPath, `${JSON.stringify(skeleton, null, 2)}\n`, "utf8");
  return { data: skeleton, sidecarPath, created: true };
}

function effectiveColors(promoData) {
  if (promoData.theme !== "custom" && THEMES[promoData.theme]) {
    return { ...THEMES[promoData.theme] };
  }
  return { ...THEMES.default, ...(promoData.colors || {}) };
}

function resolveCardImage(cardKey, promoData, exportDir, warnings) {
  const config = promoData.images[cardKey] || defaultImageConfig("featured");
  const images = promoData.post_images || [];
  let src = "";

  if (config.source === "none") {
    src = "";
  } else if (config.source === "featured") {
    src = images[0] || "";
  } else if (config.source.startsWith("post:")) {
    const index = Number(config.source.slice(5));
    src = images[index] || images[0] || "";
    if (!images[index]) warnings.push(`${cardKey}: избраната слика од објавата повеќе не постои — користам главна.`);
  } else if (config.source === "url") {
    src = String(config.url || "").trim();
    if (!src) warnings.push(`${cardKey}: изворот е URL но полето е празно — картичката оди без слика.`);
  } else if (config.source.startsWith("upload:")) {
    const filename = config.source.slice(7);
    const uploadPath = path.join(exportDir, "uploads", filename);
    if (fs.existsSync(uploadPath) && /\.(png|jpe?g|webp)$/i.test(filename)) {
      const ext = filename.split(".").pop().toLowerCase().replace("jpg", "jpeg");
      src = `data:image/${ext};base64,${fs.readFileSync(uploadPath).toString("base64")}`;
    } else {
      warnings.push(`${cardKey}: качената слика ${filename} не постои — картичката оди без слика.`);
    }
  }

  return {
    src,
    x: clampNumber(config.x, 0, 100, 50),
    y: clampNumber(config.y, 0, 100, 50),
    zoom: clampNumber(config.zoom, 1, 3, 1),
    overlay: clampNumber(config.overlay, 0, 1.5, 1),
    fit: config.fit === "contain" ? "contain" : "cover"
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function truncate(text, maxChars, fieldName, warnings) {
  const clean = String(text || "").trim();
  if (clean.length <= maxChars) return clean;
  warnings.push(`${fieldName} беше скратено на ${maxChars} карактери (имаше ${clean.length}).`);
  const cut = clean.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 30 ? lastSpace : cut.length).trim()}…`;
}

function buildCardData(post, promoData, exportDir, warnings) {
  const typography = BRAND.typography;
  const offerItems = (promoData.offer_items || [])
    .map((item) => truncate(item, typography.maxOfferItemChars, "Ставка од понудата", warnings))
    .filter(Boolean)
    .slice(0, typography.maxOfferItems);

  if (offerItems.length < 3) {
    warnings.push(`Понудата има само ${offerItems.length} ставки (препорачано 3-5).`);
  }

  const cards = {};
  for (const key of CARD_KEYS) {
    cards[key] = resolveCardImage(key, promoData, exportDir, warnings);
  }

  return {
    badgeText: truncate(promoData.badge_text || BRAND.promoLabel, 24, "Беџ текстот", warnings),
    story1Heading: truncate(promoData.story1_heading || "Ново во Гостивар", 34, "Насловот на Story 1", warnings),
    story2Heading: truncate(promoData.story2_heading || "Што нуди?", 30, "Насловот на Story 2", warnings),
    story3Heading: truncate(promoData.story3_heading || "Локација и контакт", 30, "Насловот на Story 3", warnings),
    title: truncate(post.title, typography.maxTitleChars, "Насловот", warnings),
    businessName: truncate(promoData.business_name || post.title, typography.maxTitleChars, "Името на бизнисот", warnings),
    shortIntro: truncate(promoData.story1_description || post.excerpt, typography.maxIntroChars, "Краткиот опис", warnings),
    offerItems,
    address: promoData.address,
    workingHours: promoData.working_hours,
    phone: promoData.phone,
    instagram: promoData.instagram,
    facebook: promoData.facebook,
    colors: effectiveColors(promoData),
    cards,
    logo: templates.logoDataUri()
  };
}

function captionFacebook(post, data) {
  return [
    data.businessName,
    data.shortIntro,
    `Целата објава: ${post.link}`,
    `${data.badgeText} · ${BRAND.brandName}`
  ].filter(Boolean).join("\n\n");
}

function captionInstagram(post, data) {
  return [
    `${data.businessName} — ${data.story1Heading.toLowerCase()}!`,
    data.shortIntro,
    `Целата објава на ${BRAND.brandName} (линк во bio).`,
    `${data.badgeText} · #Гостивар #Gostivarpress`
  ].filter(Boolean).join("\n\n");
}

function captionTelegram(post, data) {
  return [data.businessName, data.shortIntro, post.link].filter(Boolean).join("\n\n");
}

async function exportPromoPackage(post, options = {}) {
  const warnings = [];
  const exportDir = options.exportDir || path.join(EXPORTS_DIR, post.slug);
  const { data: promoData, sidecarPath, created } = loadOrCreatePromoData(post, exportDir);
  const cardData = buildCardData(post, promoData, exportDir, warnings);

  const cards = [
    ["01-story-novo-vo-gostivar.png", templates.story1Html(cardData), BRAND.story],
    ["02-story-sto-nudi.png", templates.story2Html(cardData), BRAND.story],
    ["03-story-lokacija-kontakt.png", templates.story3Html(cardData), BRAND.story],
    ["04-feed-4x5.png", templates.feedCardHtml(cardData), BRAND.feed],
    ["05-facebook-1x1.png", templates.squareCardHtml(cardData), BRAND.square]
  ];

  const written = [];
  await withBrowser(async (browser) => {
    for (const [filename, html, size] of cards) {
      const outputPath = path.join(exportDir, filename);
      await renderHtmlToPng(browser, html, outputPath, {
        width: Math.round(size.width / 2),
        height: Math.round(size.height / 2)
      });
      written.push(outputPath);
    }
  });

  const captions = [
    ["caption-facebook.txt", captionFacebook(post, cardData)],
    ["caption-instagram.txt", captionInstagram(post, cardData)],
    ["caption-telegram.txt", captionTelegram(post, cardData)]
  ];
  for (const [filename, text] of captions) {
    const outputPath = path.join(exportDir, filename);
    fs.writeFileSync(outputPath, `${text}\n`, "utf8");
    written.push(outputPath);
  }

  const linkPath = path.join(exportDir, "link.txt");
  fs.writeFileSync(linkPath, `${post.link}\n`, "utf8");
  written.push(linkPath);

  fs.writeFileSync(
    path.join(exportDir, "export-meta.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), warnings }, null, 2)}\n`,
    "utf8"
  );

  return { exportDir, written, warnings, sidecarPath, sidecarCreated: created, promoData };
}

module.exports = { exportPromoPackage, PROMO_STATUSES, THEMES, CARD_KEYS };
