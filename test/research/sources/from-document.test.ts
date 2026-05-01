import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fromDocument } from "../../../src/research/sources/from-document.js";

describe("fromDocument", () => {
  it("extracts URLs and ignores fenced code blocks", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const doc = join(v, "b.md");
      writeFileSync(
        doc,
        "Read [A](https://a.com/x) and https://b.com/y\n```\nhttps://ignored.com\n```",
      );
      const out: any[] = [];
      for await (const it of fromDocument.discover(
        { type: "from-document", path: doc } as any,
        { topic_id: "t", vault: v },
      )) {
        out.push(it);
      }
      const urls = out.map(o => o.url).sort();
      expect(urls).toEqual(["https://a.com/x", "https://b.com/y"]);
      expect(out[0].source_meta).toMatchObject({ adapter: "from-document" });
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("strips trailing punctuation and dedupes", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const doc = join(v, "b.md");
      writeFileSync(
        doc,
        "Visit https://x.com/a, then https://x.com/a. Also (https://x.com/b).",
      );
      const out: any[] = [];
      for await (const it of fromDocument.discover(
        { type: "from-document", path: doc } as any,
        { topic_id: "t", vault: v },
      )) {
        out.push(it);
      }
      expect(out.map(o => o.url)).toEqual(["https://x.com/a", "https://x.com/b"]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("resolves relative paths against vault", async () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      writeFileSync(join(v, "rel.md"), "https://r.com/a");
      const out: any[] = [];
      for await (const it of fromDocument.discover(
        { type: "from-document", path: "rel.md" } as any,
        { topic_id: "t", vault: v },
      )) {
        out.push(it);
      }
      expect(out.map(o => o.url)).toEqual(["https://r.com/a"]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });
});
