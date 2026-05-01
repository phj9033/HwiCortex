import { describe, it, expect } from "vitest";
import { canonicalize, sourceIdFor } from "../../../src/research/core/url.js";

describe("canonicalize", () => {
  it("strips fragments", () => {
    expect(canonicalize("https://x.com/a#foo")).toBe("https://x.com/a");
  });
  it("strips utm_ params", () => {
    expect(canonicalize("https://x.com/a?utm_source=foo&id=1")).toBe("https://x.com/a?id=1");
  });
  it("lowercases host", () => {
    expect(canonicalize("https://EXAMPLE.com/A")).toBe("https://example.com/A");
  });
  it("removes trailing slash on path /", () => {
    expect(canonicalize("https://x.com/")).toBe("https://x.com");
  });
});

describe("sourceIdFor", () => {
  it("returns 12-char hex", () => {
    expect(sourceIdFor("https://x.com/a")).toMatch(/^[0-9a-f]{12}$/);
  });
});
