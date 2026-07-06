import "dotenv/config";
import path from "node:path";

export type AppConfig = {
  igUserId?: string;
  igAccessToken?: string;
  siteUrl: string;
  publicStoriesBaseUrl?: string;
  dataFile: string;
  publicStoriesDir: string;
  logoPath: string;
};

const cwd = process.cwd();

function resolveLocalPath(value: string | undefined, fallback: string): string {
  return path.resolve(cwd, value || fallback);
}

export function getConfig(): AppConfig {
  return {
    igUserId: process.env.IG_USER_ID,
    igAccessToken: process.env.IG_ACCESS_TOKEN,
    siteUrl: process.env.SITE_URL || "https://gostivarpress.mk",
    publicStoriesBaseUrl: process.env.PUBLIC_STORIES_BASE_URL,
    dataFile: resolveLocalPath(process.env.DATA_FILE, "./data/published.json"),
    publicStoriesDir: resolveLocalPath(process.env.PUBLIC_STORIES_DIR, "./public/stories"),
    logoPath: resolveLocalPath(process.env.LOGO_PATH, "./assets/gpress-logo-white.png")
  };
}

export function requireInstagramConfig(config: AppConfig): asserts config is AppConfig & {
  igUserId: string;
  igAccessToken: string;
  publicStoriesBaseUrl: string;
} {
  const missing = [
    !config.igUserId && "IG_USER_ID",
    !config.igAccessToken && "IG_ACCESS_TOKEN",
    !config.publicStoriesBaseUrl && "PUBLIC_STORIES_BASE_URL"
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for publishing: ${missing.join(", ")}`);
  }
}
