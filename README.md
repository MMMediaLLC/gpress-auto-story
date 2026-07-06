# GPress Story Publisher

Node.js/TypeScript CLI that fetches new Gostivarpress.mk WordPress posts, renders 1080x1920 Instagram Story JPG cards, publishes them through the Instagram Graph API, and tracks duplicate publishing locally.

## Setup

1. Install Node.js 20+.
2. Install dependencies:

```bash
npm install
```

3. Install Playwright browsers:

```bash
npx playwright install chromium
```

4. Copy `.env.example` to `.env` and fill in:

```bash
IG_USER_ID=...
IG_ACCESS_TOKEN=...
SITE_URL=https://gostivarpress.mk
PUBLIC_STORIES_BASE_URL=https://your-public-domain.example/stories
```

5. Add the transparent white GPRESS logo at:

```text
assets/gpress-logo-white.png
```

If the logo file is missing, generated cards will fall back to a text GPRESS mark.

## Public Story Images

Instagram must be able to download `image_url` from the public internet. This app writes generated files to `PUBLIC_STORIES_DIR`, defaulting to `./public/stories`, and builds public URLs using `PUBLIC_STORIES_BASE_URL`.

Deploy or serve that folder from your web server so a file like:

```text
./public/stories/story-123.jpg
```

is reachable at:

```text
https://your-public-domain.example/stories/story-123.jpg
```

Never put `IG_ACCESS_TOKEN` in browser/frontend code. This app only reads it server-side from `.env`.

## Commands

Fetch the latest WordPress posts:

```bash
npm run fetch
```

Generate one story image:

```bash
npm run generate -- --postId=POST_ID
```

Publish the newest unpublished post:

```bash
npm run publish-latest
```

Publish one post:

```bash
npm run publish -- --postId=POST_ID
```

## Tracking

Published posts are stored in `DATA_FILE`, defaulting to:

```text
./data/published.json
```

Each record includes:

- `post_id`
- `post_link`
- `story_image_url`
- `instagram_container_id`
- `instagram_story_id`
- `status`
- `published_at`

Posts with `status: "published"` are skipped by publish commands for duplicate protection.
