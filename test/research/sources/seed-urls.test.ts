import { describe, it, expect } from "vitest";
import { seedUrls } from "../../../src/research/sources/seed-urls.js";
import type { DiscoveryItem } from "../../../src/research/sources/types.js";
import type { SourceSpec } from "../../../src/research/topic/schema.js";

describe("seedUrls", () => {
  it("yields the input URLs in order", async () => {
    const spec: SourceSpec = {
      type: "seed-urls",
      urls: ["https://a.com", "https://b.com"],
    };
    const out: DiscoveryItem[] = [];
    for await (const it of seedUrls.discover(spec, { topic_id: "t", vault: "/tmp/v" })) {
      out.push(it);
    }
    expect(out).toHaveLength(2);
    expect(out[0]?.url).toBe("https://a.com");
    expect(out[1]?.url).toBe("https://b.com");
    expect(out[0]?.source_meta?.adapter).toBe("seed-urls");
  });

  it("yields nothing for non-seed-urls spec", async () => {
    const spec: SourceSpec = {
      type: "from-document",
      path: "x.md",
      mode: "seeds-only",
      refetch: false,
    };
    const out: DiscoveryItem[] = [];
    for await (const it of seedUrls.discover(spec, { topic_id: "t", vault: "/tmp/v" })) {
      out.push(it);
    }
    expect(out).toHaveLength(0);
  });
});
