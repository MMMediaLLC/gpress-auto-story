import { AppConfig } from "./config.js";
import { StoryPost } from "./types.js";
import { decodeHtml } from "./utils.js";

type WordPressPost = {
  id: number;
  date: string;
  link: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  _embedded?: {
    "wp:featuredmedia"?: Array<{ source_url?: string }>;
    "wp:term"?: Array<Array<{ name?: string; taxonomy?: string }>>;
  };
};

export async function fetchLatestPosts(config: AppConfig, perPage = 10): Promise<StoryPost[]> {
  const url = new URL("/wp-json/wp/v2/posts", config.siteUrl);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("_embed", "");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WordPress fetch failed: ${response.status} ${response.statusText}`);
  }

  const posts = (await response.json()) as WordPressPost[];
  return posts.map(normalizePost);
}

export async function fetchPostById(config: AppConfig, postId: number): Promise<StoryPost> {
  const url = new URL(`/wp-json/wp/v2/posts/${postId}`, config.siteUrl);
  url.searchParams.set("_embed", "");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WordPress post fetch failed for ${postId}: ${response.status} ${response.statusText}`);
  }

  return normalizePost((await response.json()) as WordPressPost);
}

function normalizePost(post: WordPressPost): StoryPost {
  const termGroups = post._embedded?.["wp:term"] || [];
  const categories = termGroups
    .flat()
    .filter((term) => term.taxonomy === "category" && term.name)
    .map((term) => decodeHtml(term.name || ""));

  return {
    id: post.id,
    title: decodeHtml(post.title?.rendered || ""),
    link: post.link,
    date: post.date,
    categories,
    featuredImageUrl: post._embedded?.["wp:featuredmedia"]?.[0]?.source_url,
    excerpt: decodeHtml(post.excerpt?.rendered || "")
  };
}
