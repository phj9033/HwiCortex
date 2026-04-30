import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { stagingDir } from "../topic/paths.js";

type CacheEntry = { etag?: string; lm?: string; blob?: string };

export class FetchCache {
  private dir: string;
  private etagFile: string;
  private etags: Record<string, CacheEntry>;

  constructor(vault: string, topicId: string) {
    this.dir = join(stagingDir(vault, topicId), "cache");
    mkdirSync(join(this.dir, "blobs"), { recursive: true });
    this.etagFile = join(this.dir, "etag.json");
    this.etags = existsSync(this.etagFile)
      ? JSON.parse(readFileSync(this.etagFile, "utf-8"))
      : {};
  }

  getValidators(url: string): CacheEntry {
    const e = this.etags[url];
    return e ? { etag: e.etag, lm: e.lm, blob: e.blob } : {};
  }

  store(url: string, body: Buffer, etag?: string, lm?: string): string {
    const hash = createHash("sha256").update(body).digest("hex");
    const blob = join(this.dir, "blobs", hash);
    if (!existsSync(blob)) writeFileSync(blob, body);
    this.etags[url] = { etag, lm, blob };
    writeFileSync(this.etagFile, JSON.stringify(this.etags, null, 2));
    return blob;
  }

  read(blob: string): Buffer {
    return readFileSync(blob);
  }
}
