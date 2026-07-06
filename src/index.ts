import { getConfig, requireInstagramConfig } from "./config.js";
import { publishStoryToInstagram } from "./instagram.js";
import { generateSampleCards } from "./sampleCards.js";
import { PublishedStore } from "./store.js";
import { generateStoryImage } from "./storyRenderer.js";
import { StoryPost } from "./types.js";
import { fetchLatestPosts, fetchPostById } from "./wordpress.js";

const config = getConfig();
const store = new PublishedStore(config.dataFile);

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  try {
    switch (command) {
      case "fetch":
        await fetchCommand();
        break;
      case "generate":
        await generateCommand();
        break;
      case "generate:test":
      case "generate:samples":
        await generateSamplesCommand();
        break;
      case "publish-latest":
        await publishLatestCommand();
        break;
      case "publish":
        await publishCommand();
        break;
      default:
        printHelp();
        process.exitCode = command ? 1 : 0;
    }
  } catch (error) {
    console.error(`[error] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

async function fetchCommand(): Promise<void> {
  const posts = await fetchLatestPosts(config);
  for (const post of posts) {
    const published = await store.isPublished(post.id);
    console.log(`${published ? "published" : "new      "} #${post.id} ${post.date.slice(0, 10)} ${post.title}`);
  }
}

async function generateCommand(): Promise<void> {
  const postId = requirePostId();
  const post = await fetchPostById(config, postId);
  const generated = await generateStoryImage(post, config);

  await store.upsert({
    post_id: post.id,
    post_link: post.link,
    story_image_url: generated.publicUrl,
    status: "generated"
  });

  console.log(`[generated] ${generated.filePath}`);
  if (generated.publicUrl) {
    console.log(`[public-url] ${generated.publicUrl}`);
  } else {
    console.log("[public-url] not set. Add PUBLIC_STORIES_BASE_URL before publishing.");
  }
}

async function generateSamplesCommand(): Promise<void> {
  const paths = await generateSampleCards();
  for (const filePath of paths) {
    console.log(`[sample] ${filePath}`);
  }
}

async function publishLatestCommand(): Promise<void> {
  const posts = await fetchLatestPosts(config);
  const post = await firstUnpublished(posts);
  if (!post) {
    console.log("[skip] No unpublished posts found in the latest feed.");
    return;
  }

  await publishPost(post);
}

async function publishCommand(): Promise<void> {
  const postId = requirePostId();
  if (await store.isPublished(postId)) {
    console.log(`[skip] Post ${postId} is already marked as published.`);
    return;
  }

  const post = await fetchPostById(config, postId);
  await publishPost(post);
}

async function firstUnpublished(posts: StoryPost[]): Promise<StoryPost | undefined> {
  for (const post of posts) {
    if (!(await store.isPublished(post.id))) {
      return post;
    }
  }
  return undefined;
}

async function publishPost(post: StoryPost): Promise<void> {
  if (await store.isPublished(post.id)) {
    console.log(`[skip] Post ${post.id} is already marked as published.`);
    return;
  }

  requireInstagramConfig(config);
  console.log(`[generate] #${post.id} ${post.title}`);
  const generated = await generateStoryImage(post, config);

  if (!generated.publicUrl) {
    throw new Error("Cannot publish without PUBLIC_STORIES_BASE_URL.");
  }

  await store.upsert({
    post_id: post.id,
    post_link: post.link,
    story_image_url: generated.publicUrl,
    status: "generated"
  });

  try {
    console.log(`[instagram] Creating story media container for ${generated.publicUrl}`);
    const result = await publishStoryToInstagram({
      igUserId: config.igUserId,
      accessToken: config.igAccessToken,
      imageUrl: generated.publicUrl
    });

    await store.upsert({
      post_id: post.id,
      post_link: post.link,
      story_image_url: generated.publicUrl,
      instagram_container_id: result.containerId,
      instagram_story_id: result.storyId,
      status: "published",
      published_at: new Date().toISOString()
    });

    console.log(`[published] post=${post.id} story=${result.storyId}`);
  } catch (error) {
    await store.upsert({
      post_id: post.id,
      post_link: post.link,
      story_image_url: generated.publicUrl,
      status: "failed",
      error: (error as Error).message
    });
    throw error;
  }
}

function requirePostId(): number {
  const raw = readArg("postId");
  const postId = Number(raw);
  if (!raw || !Number.isInteger(postId) || postId <= 0) {
    throw new Error("Missing or invalid --postId=POST_ID argument.");
  }
  return postId;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function printHelp(): void {
  console.log(`GPress Story Publisher

Commands:
  npm run fetch
  npm run generate -- --postId=POST_ID
  npm run generate:test
  npm run generate:samples
  npm run publish-latest
  npm run publish -- --postId=POST_ID
`);
}

await main();
