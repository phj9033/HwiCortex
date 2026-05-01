import { appendFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { stagingDir } from "../topic/paths.js";
import type { RawRecord } from "../core/types.js";
import { DedupIndex } from "../core/dedup.js";

export class StagingStore {
  private path: string;
  private index = new DedupIndex();
  private existing: number;

  constructor(vault: string, topicId: string) {
    const dir = stagingDir(vault, topicId);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "raw.jsonl");
    this.existing = 0;
    if (existsSync(this.path)) {
      for (const line of readFileSync(this.path, "utf-8").split("\n")) {
        if (!line) continue;
        try {
          const r = JSON.parse(line) as RawRecord;
          this.index.record({
            canonical_url: r.canonical_url,
            body_hash: r.body_hash,
          });
          this.existing += 1;
        } catch {
          /* skip malformed lines */
        }
      }
    }
  }

  has(rec: { canonical_url: string; body_hash?: string }): boolean {
    return this.index.seen(rec);
  }

  append(rec: RawRecord): void {
    if (
      this.index.seen({
        canonical_url: rec.canonical_url,
        body_hash: rec.body_hash,
      })
    ) {
      return;
    }
    appendFileSync(this.path, JSON.stringify(rec) + "\n");
    this.index.record({
      canonical_url: rec.canonical_url,
      body_hash: rec.body_hash,
    });
  }

  count(): number {
    return this.index.size();
  }

  preExistingCount(): number {
    return this.existing;
  }

  *all(): Iterable<RawRecord> {
    if (!existsSync(this.path)) return;
    for (const line of readFileSync(this.path, "utf-8").split("\n")) {
      if (!line) continue;
      try {
        yield JSON.parse(line) as RawRecord;
      } catch {
        /* skip */
      }
    }
  }
}
