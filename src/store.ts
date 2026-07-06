import fs from "node:fs/promises";
import path from "node:path";
import { PublishedRecord } from "./types.js";
import { ensureDir } from "./utils.js";

type StoreShape = {
  records: PublishedRecord[];
};

export class PublishedStore {
  constructor(private readonly dataFile: string) {}

  async list(): Promise<PublishedRecord[]> {
    return (await this.read()).records;
  }

  async find(postId: number): Promise<PublishedRecord | undefined> {
    return (await this.list()).find((record) => record.post_id === postId);
  }

  async isPublished(postId: number): Promise<boolean> {
    return (await this.find(postId))?.status === "published";
  }

  async upsert(record: Omit<PublishedRecord, "updated_at"> & { updated_at?: string }): Promise<PublishedRecord> {
    const store = await this.read();
    const fullRecord: PublishedRecord = {
      ...record,
      updated_at: record.updated_at || new Date().toISOString()
    };

    const index = store.records.findIndex((item) => item.post_id === fullRecord.post_id);
    if (index >= 0) {
      store.records[index] = { ...store.records[index], ...fullRecord };
    } else {
      store.records.unshift(fullRecord);
    }

    await this.write(store);
    return fullRecord;
  }

  private async read(): Promise<StoreShape> {
    try {
      const raw = await fs.readFile(this.dataFile, "utf8");
      const parsed = JSON.parse(raw) as StoreShape;
      return { records: Array.isArray(parsed.records) ? parsed.records : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { records: [] };
      }
      throw error;
    }
  }

  private async write(store: StoreShape): Promise<void> {
    await ensureDir(path.dirname(this.dataFile));
    await fs.writeFile(this.dataFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}
