import { describe, it, expect } from "vitest";
import { evaluateQuality } from "../../../src/research/core/quality.js";

const filt = {
  min_words: 50,
  max_words: 1000,
  exclude_domains: ["bad.com"],
  require_lang: null as string | null,
};

describe("evaluateQuality", () => {
  it("rejects too-short body", () => {
    expect(
      evaluateQuality(
        { body_md: "short", canonical_url: "https://x.com/a", language: "en" },
        filt,
      ).accept,
    ).toBe(false);
  });

  it("rejects excluded domains (exact host)", () => {
    const body = "x ".repeat(60);
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://bad.com/a", language: "en" },
        filt,
      ).accept,
    ).toBe(false);
  });

  it("rejects excluded domains (subdomain)", () => {
    const body = "x ".repeat(60);
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://news.bad.com/a", language: "en" },
        filt,
      ).accept,
    ).toBe(false);
  });

  it("rejects when language mismatched and required", () => {
    const body = "x ".repeat(60);
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://x.com/a", language: "fr" },
        { ...filt, require_lang: "ko" },
      ).accept,
    ).toBe(false);
  });

  it("accepts when language unknown even if required", () => {
    const body = "x ".repeat(60);
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://x.com/a", language: null },
        { ...filt, require_lang: "ko" },
      ).accept,
    ).toBe(true);
  });

  it("rejects too-long body", () => {
    const body = "x ".repeat(1500);
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://x.com/a", language: "en" },
        filt,
      ).accept,
    ).toBe(false);
  });

  it("rejects paywall pages", () => {
    const body = "x ".repeat(60) + " subscribe to read the rest of this article";
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://x.com/a", language: "en" },
        filt,
      ).accept,
    ).toBe(false);
  });

  it("accepts a normal page", () => {
    const body = "x ".repeat(60);
    expect(
      evaluateQuality(
        { body_md: body, canonical_url: "https://x.com/a", language: "en" },
        filt,
      ).accept,
    ).toBe(true);
  });

  it("returns reason on rejection", () => {
    const r = evaluateQuality(
      { body_md: "short", canonical_url: "https://x.com/a", language: "en" },
      filt,
    );
    expect(r.accept).toBe(false);
    expect(r.reason).toBe(`min_words<${filt.min_words}`);
  });
});
