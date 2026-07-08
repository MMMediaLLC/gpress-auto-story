const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "..");
const BRAND = require(path.join(ROOT, "src", "brand", "brand.config.json"));
const FONT_REGULAR = path.join(ROOT, "public", "fonts", "NotoSans-Regular.ttf");
const FONT_BOLD = path.join(ROOT, "public", "fonts", "NotoSans-Bold.ttf");
const LOGO_PATH = path.join(ROOT, "public", "logo.png");

function fontCss() {
  if (!fs.existsSync(FONT_REGULAR) || !fs.existsSync(FONT_BOLD)) return "";
  const regular = fs.readFileSync(FONT_REGULAR).toString("base64");
  const bold = fs.readFileSync(FONT_BOLD).toString("base64");
  return `@font-face { font-family: "GPressSans"; src: url("data:font/ttf;base64,${regular}") format("truetype"); font-weight: 400 700; }
@font-face { font-family: "GPressSans"; src: url("data:font/ttf;base64,${bold}") format("truetype"); font-weight: 800 900; }`;
}

function logoDataUri() {
  if (!fs.existsSync(LOGO_PATH)) return "";
  return `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`;
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cssUrl(input) {
  return String(input || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function baseHead(widthPx, heightPx, extraCss) {
  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><style>
${fontCss()}
* { box-sizing: border-box; }
body { margin: 0; font-family: ${BRAND.typography.fontFamily}; }
.card { width: ${widthPx}px; height: ${heightPx}px; position: relative; overflow: hidden; background: linear-gradient(160deg, ${BRAND.darkColor} 0%, ${BRAND.darkColorSoft} 58%, ${BRAND.darkColor} 100%); color: #fff; }
.badge { display: inline-flex; align-items: center; min-height: 19px; padding: 5px 9px; border-radius: 5px; background: ${BRAND.primaryColor}; color: #fff; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .6px; }
.logo { position: absolute; top: 16px; right: 18px; width: 105px; z-index: 3; filter: drop-shadow(0 4px 10px rgba(0,0,0,.25)); }
.footer { position: absolute; left: 42px; right: 42px; bottom: 24px; z-index: 3; display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,.64); }
.footer strong { color: ${BRAND.primaryColor}; font-weight: 900; }
.dot { width: 4px; height: 4px; border-radius: 999px; background: ${BRAND.primaryColor}; }
${extraCss}
</style></head><body>`;
}

// Cards are laid out at half size and rendered at deviceScaleFactor 2,
// so px values here are half of the final output dimensions.

function story1Html(data) {
  const bg = data.heroImage
    ? `background-image: linear-gradient(180deg, rgba(6,10,22,.42) 0%, rgba(6,10,22,.62) 46%, rgba(5,9,18,.94) 78%, rgba(5,9,18,.99) 100%), url('${cssUrl(data.heroImage)}'); background-size: cover; background-position: center;`
    : "";
  return `${baseHead(540, 960, `
.card.hero { ${bg} }
.top { position: absolute; top: 118px; left: 42px; z-index: 3; }
.content { position: absolute; left: 42px; right: 42px; bottom: 130px; z-index: 3; }
.kicker { color: ${BRAND.primaryColor}; font-size: 19px; font-weight: 900; letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 16px; }
h1 { margin: 0 0 18px; font-size: ${data.businessName.length <= 26 ? 42 : 34}px; line-height: 1.1; font-weight: 900; text-wrap: balance; text-shadow: 0 2px 20px rgba(0,0,0,.4); }
.intro { max-width: 420px; font-size: 19px; line-height: 1.4; font-weight: 700; color: rgba(255,255,255,.85); }
`)}
<main class="card hero">
  ${data.logo ? `<img class="logo" src="${data.logo}" alt="">` : ""}
  <div class="top"><span class="badge">${escapeHtml(BRAND.promoLabel)}</span></div>
  <section class="content">
    <div class="kicker">Ново во Гостивар</div>
    <h1>${escapeHtml(data.businessName)}</h1>
    ${data.shortIntro ? `<p class="intro">${escapeHtml(data.shortIntro)}</p>` : ""}
  </section>
  <footer class="footer"><span class="dot"></span><span><strong>${escapeHtml(BRAND.footerText)}</strong></span></footer>
</main></body></html>`;
}

function story2Html(data) {
  const items = data.offerItems
    .map((item) => `<li><span class="tick"></span><span>${escapeHtml(item)}</span></li>`)
    .join("");
  return `${baseHead(540, 960, `
.top { position: absolute; top: 118px; left: 42px; z-index: 3; }
.content { position: absolute; left: 42px; right: 42px; top: 200px; bottom: 130px; z-index: 3; display: flex; flex-direction: column; justify-content: center; }
h1 { margin: 0 0 34px; font-size: 44px; font-weight: 900; }
h1 em { font-style: normal; color: ${BRAND.primaryColor}; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 20px; }
li { display: flex; align-items: flex-start; gap: 14px; font-size: 21px; line-height: 1.3; font-weight: 700; color: rgba(255,255,255,.92); }
.tick { flex: 0 0 auto; width: 26px; height: 26px; margin-top: 1px; border-radius: 8px; background: ${BRAND.primaryColor}; position: relative; }
.tick::after { content: ""; position: absolute; left: 9px; top: 4px; width: 7px; height: 12px; border: solid #fff; border-width: 0 3.5px 3.5px 0; transform: rotate(40deg); }
.glow { position: absolute; right: -140px; top: 220px; width: 380px; height: 380px; border-radius: 50%; background: radial-gradient(circle, rgba(114,133,244,.22), rgba(114,133,244,0) 70%); }
`)}
<main class="card">
  <div class="glow"></div>
  ${data.logo ? `<img class="logo" src="${data.logo}" alt="">` : ""}
  <div class="top"><span class="badge">${escapeHtml(BRAND.promoLabel)}</span></div>
  <section class="content">
    <h1>Што <em>нуди</em>?</h1>
    <ul>${items}</ul>
  </section>
  <footer class="footer"><span class="dot"></span><span>Повеќе на <strong>${escapeHtml(BRAND.footerText)}</strong></span></footer>
</main></body></html>`;
}

function story3Html(data) {
  const rows = [
    ["Бизнис", data.businessName],
    ["Адреса", data.address],
    ["Работно време", data.workingHours],
    ["Телефон", data.phone],
    ["Instagram", data.instagram],
    ["Facebook", data.facebook]
  ]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) => `
      <div class="row">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
      </div>`
    )
    .join("");
  return `${baseHead(540, 960, `
.top { position: absolute; top: 118px; left: 42px; z-index: 3; }
.content { position: absolute; left: 42px; right: 42px; top: 200px; bottom: 130px; z-index: 3; display: flex; flex-direction: column; justify-content: center; }
h1 { margin: 0 0 32px; font-size: 38px; font-weight: 900; }
h1 em { font-style: normal; color: ${BRAND.primaryColor}; }
.rows { display: flex; flex-direction: column; gap: 18px; }
.row { border-left: 4px solid ${BRAND.primaryColor}; padding-left: 16px; }
.label { font-size: 13px; font-weight: 900; letter-spacing: 1.6px; text-transform: uppercase; color: ${BRAND.primaryColor}; margin-bottom: 4px; }
.value { font-size: 21px; line-height: 1.3; font-weight: 700; color: rgba(255,255,255,.92); overflow-wrap: anywhere; }
`)}
<main class="card">
  ${data.logo ? `<img class="logo" src="${data.logo}" alt="">` : ""}
  <div class="top"><span class="badge">${escapeHtml(BRAND.promoLabel)}</span></div>
  <section class="content">
    <h1>Локација и <em>контакт</em></h1>
    <div class="rows">${rows}</div>
  </section>
  <footer class="footer"><span class="dot"></span><span>Целата објава на <strong>${escapeHtml(BRAND.footerText)}</strong></span></footer>
</main></body></html>`;
}

function feedCardHtml(data) {
  const photo = data.heroImage
    ? `<div class="photo" style="background-image:url('${cssUrl(data.heroImage)}')"></div>`
    : `<div class="photo fallback"></div>`;
  return `${baseHead(540, 675, `
.photo { position: absolute; inset: 0 0 auto 0; height: 372px; background-size: cover; background-position: center; }
.photo.fallback { background: linear-gradient(150deg, ${BRAND.darkColorSoft}, ${BRAND.primaryColor}); }
.photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,9,18,0) 55%, ${BRAND.darkColor} 100%); }
.panel { position: absolute; left: 34px; right: 34px; bottom: 58px; z-index: 3; }
h1 { margin: 12px 0 10px; font-size: 30px; line-height: 1.14; font-weight: 900; text-wrap: balance; }
.intro { margin: 0; font-size: 16px; line-height: 1.4; font-weight: 700; color: rgba(255,255,255,.8); }
.logo { top: 14px; right: 16px; width: 96px; }
`)}
<main class="card">
  ${photo}
  ${data.logo ? `<img class="logo" src="${data.logo}" alt="">` : ""}
  <section class="panel">
    <span class="badge">${escapeHtml(BRAND.promoLabel)}</span>
    <h1>${escapeHtml(data.title)}</h1>
    ${data.shortIntro ? `<p class="intro">${escapeHtml(data.shortIntro)}</p>` : ""}
  </section>
  <footer class="footer"><span class="dot"></span><span><strong>${escapeHtml(BRAND.footerText)}</strong></span></footer>
</main></body></html>`;
}

function squareCardHtml(data) {
  const bg = data.heroImage
    ? `background-image: linear-gradient(180deg, rgba(6,10,22,.5) 0%, rgba(6,10,22,.7) 45%, rgba(5,9,18,.95) 100%), url('${cssUrl(data.heroImage)}'); background-size: cover; background-position: center;`
    : "";
  return `${baseHead(540, 540, `
.card.hero { ${bg} }
.content { position: absolute; left: 36px; right: 36px; bottom: 66px; z-index: 3; }
h1 { margin: 12px 0 10px; font-size: 30px; line-height: 1.14; font-weight: 900; text-wrap: balance; }
.intro { margin: 0 0 18px; font-size: 15px; line-height: 1.4; font-weight: 700; color: rgba(255,255,255,.82); }
.cta { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 16px; border-radius: 999px; background: ${BRAND.primaryColor}; color: #fff; font-size: 14px; font-weight: 900; }
.logo { top: 14px; right: 16px; width: 96px; }
`)}
<main class="card hero">
  ${data.logo ? `<img class="logo" src="${data.logo}" alt="">` : ""}
  <section class="content">
    <span class="badge">${escapeHtml(BRAND.promoLabel)}</span>
    <h1>${escapeHtml(data.title)}</h1>
    ${data.shortIntro ? `<p class="intro">${escapeHtml(data.shortIntro)}</p>` : ""}
    <span class="cta">Дознај повеќе → ${escapeHtml(BRAND.footerText)}</span>
  </section>
  <footer class="footer"><span class="dot"></span><span><strong>${escapeHtml(BRAND.footerText)}</strong></span></footer>
</main></body></html>`;
}

module.exports = { story1Html, story2Html, story3Html, feedCardHtml, squareCardHtml, logoDataUri };
