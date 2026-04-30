import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StagingStore } from "../../../src/research/store/staging.js";
import type { RawRecord } from "../../../src/research/core/types.js";

let vaults: string[] = [];
afterEach(() => {
  for (const v of vaults) rmSync(v, { recursive: true, force: true });
  vaults = [];
});

function makeVault(): string {
  const v = mkdtempSync(join(tmpdir(), "v-"));
  vaults.push(v);
  return v;
}

function rec(id: string, hash: string, url?: string): RawRecord {
  return {
    id,
    topic_id: "t",
    source_type: "seed-urls",
    url: url ?? "https://x/" + id,
    canonical_url: url ?? "https://x/" + id,
    title: null,
    author: null,
    published_at: null,
    fetched_at: "",
    content_type: "html",
    language: "en",
    body_md: "x",
    word_count: 1,
    body_hash: hash,
    source_meta: {},
    cache_blob: null,
  };
}

describe("StagingStore", () => {
  it("dedupes on append by canonical URL or body hash", () => {
    const v = makeVault();
    const s = new StagingStore(v, "t");
    s.append(rec("a", "h1"));
    s.append(rec("a", "h1"));
    s.append(rec("b", "h1", "https://other/page"));
    expect(s.count()).toBe(1);
  });

  it("persists across reopens via raw.jsonl", () => {
    const v = makeVault();
    const s1 = new StagingStore(v, "t");
    s1.append(rec("a", "h1"));
    s1.append(rec("c", "h2", "https://x/c"));
    const path = join(v, "research", "_staging", "t", "raw.jsonl");
    const lines = readFileSync(path, "utf-8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);

    const s2 = new StagingStore(v, "t");
    expect(s2.preExistingCount()).toBe(2);
    expect(s2.count()).toBe(2);
    s2.append(rec("a", "h1"));
    expect(s2.count()).toBe(2);
  });

  it("iterates appended records via all()", () => {
    const v = makeVault();
    const s = new StagingStore(v, "t");
    s.append(rec("a", "h1"));
    s.append(rec("b", "h2", "https://x/b"));
    const ids = [...s.all()].map((r) => r.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("skips malformed pre-existing lines without throwing", () => {
    const v = makeVault();
    const s1 = new StagingStore(v, "t");
    s1.append(rec("a", "h1"));
    const path = join(v, "research", "_staging", "t", "raw.jsonl");
    const original = readFileSync(path, "utf-8");
    writeFileSync(path, original + "{not json\n");

    const s2 = new StagingStore(v, "t");
    expect(s2.count()).toBe(1);
    expect(s2.preExistingCount()).toBe(1);
  });
});
