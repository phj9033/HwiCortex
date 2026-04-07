/**
 * korean.test.ts - Unit tests for Korean tokenizer module
 *
 * Run with: bun test test/korean.test.ts
 * or: npx vitest run test/korean.test.ts --reporter=verbose
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";

describe("korean tokenizer", () => {
  describe("mecab detection", () => {
    test("detects mecab when available", async () => {
      const { isMecabAvailable } = await import("../src/korean.js");
      // This test passes if mecab is installed, skip otherwise
      try {
        execSync("which mecab", { stdio: "ignore" });
        expect(isMecabAvailable()).toBe(true);
      } catch {
        expect(isMecabAvailable()).toBe(false);
      }
    });
  });

  describe("fallback mode", () => {
    test("returns input unchanged when mecab is not available", async () => {
      const { tokenizeKorean, _setFallbackMode } = await import("../src/korean.js");
      _setFallbackMode(true);
      expect(await tokenizeKorean("검색했다")).toBe("검색했다");
      _setFallbackMode(false);
    });
  });
});

describe("Korean text detection", () => {
  test("detects Korean characters", async () => {
    const { containsKorean } = await import("../src/korean.js");
    expect(containsKorean("검색")).toBe(true);
    expect(containsKorean("hello")).toBe(false);
    expect(containsKorean("React컴포넌트")).toBe(true);
    expect(containsKorean("12345")).toBe(false);
    expect(containsKorean("")).toBe(false);
  });

  test("splits text into Korean and non-Korean segments", async () => {
    const { splitByScript } = await import("../src/korean.js");
    const segments = splitByScript("React컴포넌트 검색");
    expect(segments).toEqual([
      { text: "React", isKorean: false },
      { text: "컴포넌트", isKorean: true },
      { text: " ", isKorean: false },
      { text: "검색", isKorean: true },
    ]);
  });

  test("handles pure English text", async () => {
    const { splitByScript } = await import("../src/korean.js");
    const segments = splitByScript("hello world");
    expect(segments).toEqual([
      { text: "hello world", isKorean: false },
    ]);
  });

  test("handles pure Korean text", async () => {
    const { splitByScript } = await import("../src/korean.js");
    const segments = splitByScript("검색했다");
    expect(segments).toEqual([
      { text: "검색했다", isKorean: true },
    ]);
  });
});

describe("mecab output parsing", () => {
  test("parses mecab output keeping content POS tags", async () => {
    const { parseMecabOutput } = await import("../src/korean.js");
    const mecabOutput = [
      "검색\tNNG,*,T,검색,*,*,*,*",
      "했\tXSV+EP,*,T,했,하/XSV/*+았/EP/*,*,*,*",
      "다\tEF,*,F,다,*,*,*,*",
      "EOS",
    ].join("\n");
    expect(parseMecabOutput(mecabOutput)).toBe("검색");
  });

  test("keeps nouns, verbs, adjectives, adverbs", async () => {
    const { parseMecabOutput } = await import("../src/korean.js");
    const mecabOutput = [
      "빠른\tVA+ETM,*,T,빠른,빠르/VA/*+ㄴ/ETM/*,*,*,*",
      "검색\tNNG,*,T,검색,*,*,*,*",
      "을\tJKO,*,T,을,*,*,*,*",
      "시작\tNNG,*,T,시작,*,*,*,*",
      "합니다\tXSV+EF,*,F,합니다,하/XSV/*+ㅂ니다/EF/*,*,*,*",
      "EOS",
    ].join("\n");
    expect(parseMecabOutput(mecabOutput)).toBe("빠른 검색 시작");
  });

  test("returns empty string for grammar-only input", async () => {
    const { parseMecabOutput } = await import("../src/korean.js");
    const mecabOutput = [
      "을\tJKO,*,T,을,*,*,*,*",
      "EOS",
    ].join("\n");
    expect(parseMecabOutput(mecabOutput)).toBe("");
  });
});
