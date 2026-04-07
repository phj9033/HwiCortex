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

// Hangul Syllables range: U+AC00 to U+D7AF
const HANGUL_RE = /[\uAC00-\uD7AF]/;
const HANGUL_BLOCK_RE = /[\uAC00-\uD7AF]+/g;

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

/** Check if text contains any Korean (Hangul Syllables) characters. */
export function containsKorean(text: string): boolean {
  return HANGUL_RE.test(text);
}

export type ScriptSegment = { text: string; isKorean: boolean };

/**
 * Split text into alternating Korean and non-Korean segments.
 * Korean = Hangul Syllables (U+AC00-U+D7AF) only.
 */
export function splitByScript(text: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(HANGUL_BLOCK_RE)) {
    const start = match.index!;
    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), isKorean: false });
    }
    segments.push({ text: match[0], isKorean: true });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isKorean: false });
  }

  return segments;
}

// POS tags to keep (content words)
const CONTENT_POS = new Set([
  "NNG",  // 일반명사
  "NNP",  // 고유명사
  "NNB",  // 의존명사
  "VV",   // 동사
  "VA",   // 형용사
  "MAG",  // 일반부사
  "XR",   // 어근
]);

/**
 * Parse mecab output, keeping only content-word morphemes.
 * Returns space-separated surface forms of content words.
 */
export function parseMecabOutput(output: string): string {
  const morphemes: string[] = [];
  for (const line of output.split("\n")) {
    if (line === "EOS" || line === "") continue;
    const [surface, features] = line.split("\t");
    if (!surface || !features) continue;
    const posTag = features.split(",")[0]!;
    const primaryPos = posTag.split("+")[0]!;
    if (CONTENT_POS.has(primaryPos)) {
      morphemes.push(surface);
    }
  }
  return morphemes.join(" ");
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
