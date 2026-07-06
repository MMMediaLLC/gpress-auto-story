import fs from "node:fs/promises";
import path from "node:path";
import { chromium, Page } from "playwright";
import sharp from "sharp";
import { getConfig, AppConfig } from "./config.js";
import { StoryPost } from "./types.js";
import { ensureDir, fileExists, toPublicUrl } from "./utils.js";
import { formatDateDDMMYYYY } from "./utils/date.js";
import { decodeHtml, shouldShowExcerpt, stripHtml, titleSizeClass } from "./utils/text.js";

const WIDTH = 1080;
const HEIGHT = 1920;

export type StoryCardPost = {
  id: number | string;
  title: string;
  link: string;
  date: string;
  category: string;
  featuredImageUrl: string | null;
  excerpt?: string;
};

export type GeneratedStory = {
  filePath: string;
  publicUrl?: string;
};

export async function generateStoryCard(post: StoryCardPost, config = getConfig()): Promise<string> {
  const generated = await renderStory(post, config);
  return generated.filePath;
}

export async function generateStoryImage(post: StoryPost, config: AppConfig): Promise<GeneratedStory> {
  return renderStory(toStoryCardPost(post), config);
}

async function renderStory(post: StoryCardPost, config: AppConfig): Promise<GeneratedStory> {
  await ensureDir(config.publicStoriesDir);

  const safePostId = String(post.id).replace(/[^\w-]+/g, "-") || "test";
  const filePath = path.join(config.publicStoriesDir, `story-${safePostId}.jpg`);
  const tempPath = path.join(config.publicStoriesDir, `.tmp-${safePostId}.png`);
  const logoExists = await fileExists(config.logoPath);
  const html = await buildHtml(post, logoExists ? config.logoPath : undefined);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1
    });

    page.on("console", (message) => {
      if (message.type() === "error") {
        console.error(`[render:${post.id}] ${message.text()}`);
      }
    });

    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await fitTitle(page);

    await page.screenshot({
      path: tempPath,
      type: "png",
      fullPage: false
    });
  } finally {
    await browser.close();
  }

  await sharp(tempPath)
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(filePath);
  await fs.rm(tempPath, { force: true });

  return {
    filePath,
    publicUrl: config.publicStoriesBaseUrl ? toPublicUrl(config.publicStoriesBaseUrl, filePath) : undefined
  };
}

function toStoryCardPost(post: StoryPost): StoryCardPost {
  return {
    id: post.id,
    title: post.title,
    link: post.link,
    date: post.date,
    category: post.categories[0] || "Вести",
    featuredImageUrl: post.featuredImageUrl || null,
    excerpt: post.excerpt
  };
}

async function buildHtml(post: StoryCardPost, logoPath?: string): Promise<string> {
  const templatePath = path.resolve(process.cwd(), "templates/story.html");
  const template = await fs.readFile(templatePath, "utf8");
  const title = decodeHtml(post.title);
  const excerpt = stripHtml(post.excerpt);
  const showExcerpt = shouldShowExcerpt(title, excerpt);
  const logoSrc = logoPath ? await toImageSrc(logoPath) : undefined;
  const backgroundSrc = post.featuredImageUrl ? await toImageSrc(post.featuredImageUrl) : undefined;
  const background = backgroundSrc
    ? `<img class="bg-image" src="${escapeHtml(backgroundSrc)}" alt="">`
    : "";

  return template
    .replace("{{BACKGROUND}}", background)
    .replace("{{WATERMARK}}", post.featuredImageUrl ? "" : `<div class="watermark">GPRESS</div>`)
    .replace(
      "{{LOGO}}",
      logoSrc
        ? `<img class="logo" src="${logoSrc}" alt="GPRESS">`
        : `<div class="logo-fallback">GPRESS</div>`
    )
    .replace("{{CATEGORY}}", escapeHtml(decodeHtml(post.category || "Вести").toUpperCase()))
    .replace("{{DATE}}", escapeHtml(formatDateDDMMYYYY(post.date)))
    .replace("{{TITLE_CLASS}}", titleSizeClass(title))
    .replace("{{TITLE}}", escapeHtml(title))
    .replace(
      "{{EXCERPT}}",
      showExcerpt ? `<p class="excerpt">${escapeHtml(excerpt)}</p>` : ""
    );
}

async function fitTitle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".title");
    if (!title) return;

    const maxHeight = Number(title.dataset.maxHeight || "520");
    const minSize = 50;
    let size = Number.parseFloat(getComputedStyle(title).fontSize);

    while (size > minSize && title.scrollHeight > maxHeight) {
      size -= 2;
      title.style.fontSize = `${size}px`;
    }

    if (title.scrollHeight <= maxHeight) return;

    const original = title.textContent || "";
    let low = 0;
    let high = original.length;
    let best = original;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      title.textContent = `${original.slice(0, mid).trim()}...`;
      if (title.scrollHeight <= maxHeight) {
        best = title.textContent;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    title.textContent = best;
  });
}

async function toImageSrc(input: string): Promise<string> {
  if (/^https?:\/\//i.test(input) || input.startsWith("data:") || input.startsWith("file:")) {
    return input;
  }

  const resolved = path.resolve(input);
  const ext = path.extname(resolved).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const buffer = await fs.readFile(resolved);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
