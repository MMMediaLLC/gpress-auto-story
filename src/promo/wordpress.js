const PROMO_TAG = "gpress-launch";
const PROMO_CATEGORY = "промотивно";

async function fetchPostByUrl(postUrl) {
  const parsed = new URL(postUrl);
  const slug = parsed.pathname.split("/").filter(Boolean).pop();
  if (!slug) throw new Error(`Could not extract a post slug from URL: ${postUrl}`);

  const apiUrl = `${parsed.origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=1`;
  const response = await fetch(apiUrl, {
    headers: { "user-agent": "gpress-promo/1.0 (+https://gostivarpress.mk)" }
  });
  if (!response.ok) {
    throw new Error(`WordPress API request failed: ${response.status} ${response.statusText}`);
  }

  const posts = await response.json();
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error(`No WordPress post found for slug "${slug}".`);
  }

  const post = posts[0];
  const terms = (post._embedded?.["wp:term"] || []).flat().filter(Boolean);
  const categories = terms.filter((t) => t.taxonomy === "category").map((t) => cleanText(t.name));
  const tags = terms.filter((t) => t.taxonomy === "post_tag");
  const contentHtml = post.content?.rendered || "";

  return {
    slug,
    title: cleanText(post.title?.rendered),
    excerpt: cleanText(post.excerpt?.rendered).replace(/\s*\[…\]\s*$/u, "").replace(/\s*…\s*$/u, ""),
    contentHtml,
    contentText: cleanText(contentHtml),
    link: post.link || postUrl,
    date: post.date || "",
    categories,
    tags: tags.map((t) => ({ name: cleanText(t.name), slug: t.slug || "" })),
    featuredImage: post._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "",
    images: extractImages(contentHtml),
    listItems: extractListItems(contentHtml)
  };
}

function isPromoPost(post) {
  const hasTag = post.tags.some(
    (t) => t.slug.toLowerCase() === PROMO_TAG || t.name.toLowerCase() === PROMO_TAG
  );
  const hasCategory = post.categories.some((c) => c.toLowerCase() === PROMO_CATEGORY);
  return hasTag || hasCategory;
}

function extractImages(html) {
  const urls = [];
  const regex = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = decodeEntities(match[1]).replace(/-\d+x\d+(\.(?:jpg|jpeg|png|webp))(\?.*)?$/i, "$1$2");
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function extractListItems(html) {
  const items = [];
  const regex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = cleanText(match[1]);
    if (text) items.push(text);
  }
  return items;
}

function cleanText(input) {
  return decodeEntities(String(input || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(input) {
  return String(input || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, "\"");
}

function safeCodePoint(value) {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  return String.fromCodePoint(value);
}

module.exports = { fetchPostByUrl, isPromoPost, PROMO_TAG, PROMO_CATEGORY };
