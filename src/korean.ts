/**
 * korean.ts - Korean text tokenization via mecab-ko
 *
 * This module provides Korean morphological analysis for FTS5 indexing.
 * When mecab is available, Korean text is split into content morphemes.
 * When mecab is not installed, text passes through unchanged (fallback mode).
 */

import { execSync } from "child_process";

let mecabAvailable: boolean | null = null;
let fallbackMode = false;

/**
 * Check if mecab binary is available on PATH.
 * Result is cached after first call.
 */
export function isMecabAvailable(): boolean {
  if (fallbackMode) return false;
  if (mecabAvailable !== null) return mecabAvailable;
  try {
    execSync("which mecab", { stdio: "ignore" });
    mecabAvailable = true;
  } catch {
    mecabAvailable = false;
  }
  return mecabAvailable;
}

/** Print install instructions when mecab is missing. Called once. */
let warnedOnce = false;
export function warnMecabMissing(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    `⚠ mecab not found — Korean search quality will be limited.\n` +
    `  Install for better results:\n` +
    `    macOS:  brew install mecab mecab-ko-dic\n` +
    `    Ubuntu: sudo apt install mecab libmecab-dev && install-mecab-ko-dic\n`
  );
}

/**
 * Tokenize text for FTS5 indexing. Korean text is split into content morphemes
 * via mecab-ko. Non-Korean text passes through unchanged.
 *
 * In fallback mode (mecab not installed), returns input unchanged.
 */
export async function tokenizeKorean(text: string): Promise<string> {
  if (!isMecabAvailable()) {
    if (!fallbackMode) warnMecabMissing();
    return text;
  }
  // Placeholder — implemented in Task 2
  return text;
}

/** For testing only: force fallback mode on/off. */
export function _setFallbackMode(enabled: boolean): void {
  fallbackMode = enabled;
  if (enabled) mecabAvailable = false;
  else mecabAvailable = null;
}

/** Reset cached state. For testing. */
export function _resetState(): void {
  mecabAvailable = null;
  fallbackMode = false;
  warnedOnce = false;
}
