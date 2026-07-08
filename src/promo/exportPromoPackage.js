const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const BRAND = require(path.join(ROOT, "src", "brand", "brand.config.json"));
const templates = require("./templates/promoTemplates");
const { withBrowser, renderHtmlToPng } = require("./renderPng");

const EXPORTS_DIR = path.join(ROOT, "exports", "promo");

function promoDataSkeleton(post) {
  return {
    business_name: post.title,
    promo_subtype: "",
    short_intro: post.excerpt,
    offer_items: post.listItems.slice(0, BRAND.typography.maxOfferItems),
    address: "",
    working_hours: "",
    phone: "",
    instagram: "",
    facebook: "",
    maps_link: "",
    article_url: post.link,
    selected_images: post.featuredImage ? [post.featuredImage] : post.images.slice(0, 1)
  };
}

function loadOrCreatePromoData(post, exportDir) {
  const sidecarPath = path.join(exportDir, "promo-data.json");
  if (fs.existsSync(sidecarPath)) {
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    return { data: { ...promoDataSkeleton(post), ...sidecar }, sidecarPath, created: false };
  }
  const skeleton = promoDataSkeleton(post);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(sidecarPath, `${JSON.stringify(skeleton, null, 2)}\n`, "utf8");
  return { data: skeleton, sidecarPath, created: true };
}

function truncate(text, maxChars, fieldName, warnings) {
  const clean = String(text || "").trim();
  if (clean.length <= maxChars) return clean;
  warnings.push(`${fieldName} беше скратено на ${maxChars} карактери (имаше ${clean.length}).`);
  const cut = clean.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 30 ? lastSpace : cut.length).trim()}…`;
}

function buildCardData(post, promoData, warnings) {
  const typography = BRAND.typography;
  const offerItems = (promoData.offer_items || [])
    .map((item) => truncate(item, typography.maxOfferItemChars, "Ставка од понудата", warnings))
    .filter(Boolean)
    .slice(0, typography.maxOfferItems);

  if (offerItems.length < 3) {
    warnings.push(
      `Понудата има само ${offerItems.length} ставки (препорачано 3-5). Дополни offer_items во promo-data.json.`
    );
  }

  return {
    title: truncate(post.title, typography.maxTitleChars, "Насловот", warnings),
    businessName: truncate(promoData.business_name || post.title, typography.maxTitleChars, "Името на бизнисот", warnings),
    shortIntro: truncate(promoData.short_intro || post.excerpt, typography.maxIntroChars, "Краткиот опис", warnings),
    offerItems,
    address: promoData.address,
    workingHours: promoData.working_hours,
    phone: promoData.phone,
    instagram: promoData.instagram,
    facebook: promoData.facebook,
    heroImage: (promoData.selected_images || [])[0] || post.featuredImage || "",
    logo: templates.logoDataUri()
  };
}

function captionFacebook(post, data) {
  return [
    data.businessName,
    data.shortIntro,
    `Целата објава: ${post.link}`,
    `${BRAND.promoLabel} · ${BRAND.brandName}`
  ].filter(Boolean).join("\n\n");
}

function captionInstagram(post, data) {
  return [
    `${data.businessName} — ново во Гостивар!`,
    data.shortIntro,
    `Целата објава на ${BRAND.brandName} (линк во bio).`,
    `${BRAND.promoLabel} · #Гостивар #Gostivarpress`
  ].filter(Boolean).join("\n\n");
}

function captionTelegram(post, data) {
  return [data.businessName, data.shortIntro, post.link].filter(Boolean).join("\n\n");
}

async function exportPromoPackage(post, options = {}) {
  const warnings = [];
  const exportDir = options.exportDir || path.join(EXPORTS_DIR, post.slug);
  const { data: promoData, sidecarPath, created } = loadOrCreatePromoData(post, exportDir);
  const cardData = buildCardData(post, promoData, warnings);

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

  return { exportDir, written, warnings, sidecarPath, sidecarCreated: created };
}

module.exports = { exportPromoPackage };
