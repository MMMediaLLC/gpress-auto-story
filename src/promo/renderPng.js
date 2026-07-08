const path = require("node:path");

process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(__dirname, "..", "..", ".ms-playwright");

const { chromium } = require("playwright");

async function withBrowser(task) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    return await task(browser);
  } finally {
    await browser.close();
  }
}

async function renderHtmlToPng(browser, html, outputPath, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.locator(".card").screenshot({ path: outputPath, type: "png" });
  await context.close();
}

module.exports = { withBrowser, renderHtmlToPng };
