import fs from "node:fs/promises";
import path from "node:path";

export type CleanupResult = {
  scanned: number;
  deleted: number;
  skipped: number;
  candidates: string[];
};

export async function cleanupOldStories(params: {
  storiesDir: string;
  olderThanHours?: number;
  dryRun?: boolean;
}): Promise<CleanupResult> {
  const olderThanHours = params.olderThanHours ?? 48;
  if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
    throw new Error("--hours must be a positive number.");
  }

  const cutoffTime = Date.now() - olderThanHours * 60 * 60 * 1000;
  const result: CleanupResult = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    candidates: []
  };

  let entries: string[];
  try {
    entries = await fs.readdir(params.storiesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return result;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!/^story-.*\.jpg$/i.test(entry)) {
      result.skipped += 1;
      continue;
    }

    const filePath = path.join(params.storiesDir, entry);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      result.skipped += 1;
      continue;
    }

    result.scanned += 1;
    if (stat.mtimeMs > cutoffTime) {
      continue;
    }

    result.candidates.push(filePath);
    if (!params.dryRun) {
      await fs.rm(filePath, { force: true });
      result.deleted += 1;
    }
  }

  return result;
}
