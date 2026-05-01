import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PdfParseResult {
  content: string;
  markdown: string;
  frontmatter: { source_path: string; pages: number; parsed_at: string };
  error?: string;
  errorEntry?: string;
}

export async function parsePdfBuffer(buf: Buffer | Uint8Array): Promise<string> {
  // pdfjs rejects Node Buffers (Buffer extends Uint8Array but has a different
  // prototype). Always copy into a fresh Uint8Array.
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const pageText = tc.items
        .filter((item): item is { str: string } & (typeof item) => "str" in item)
        .map(item => item.str)
        .join(" ")
        .trim();
      if (pageText) pageTexts.push(pageText);
    }
    return pageTexts.join("\n\n");
  } finally {
    doc.destroy();
  }
}

export class PdfParser {
  async parse(filePath: string): Promise<PdfParseResult> {
    const absPath = resolve(filePath);
    const now = new Date().toISOString();

    try {
      const data = new Uint8Array(await readFile(absPath));

      // Use legacy build for Node.js compatibility (no DOMMatrix needed)
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

      const doc = await pdfjsLib.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;

      const numPages = doc.numPages;
      const pageTexts: string[] = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item): item is { str: string } & (typeof item) => "str" in item)
          .map((item) => item.str)
          .join(" ")
          .trim();
        if (pageText) {
          pageTexts.push(pageText);
        }
      }

      doc.destroy();

      const content = pageTexts.join("\n\n");
      const frontmatter = {
        source_path: absPath,
        pages: numPages,
        parsed_at: now,
      };

      const markdown = [
        "---",
        `source_path: "${frontmatter.source_path}"`,
        `pages: ${frontmatter.pages}`,
        `parsed_at: "${frontmatter.parsed_at}"`,
        "---",
        "",
        content,
      ].join("\n");

      return { content, markdown, frontmatter };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown PDF parse error";
      const frontmatter = { source_path: absPath, pages: 0, parsed_at: now };
      const errorEntry = `| ${absPath} | PDF parse error: ${message} | ${now} |`;

      return {
        content: "",
        markdown: "",
        frontmatter,
        error: message,
        errorEntry,
      };
    }
  }
}
