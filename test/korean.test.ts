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
