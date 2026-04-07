/**
 * ingest.ts — CLI handler for `hwicortex ingest <path> --name <name> --pattern <pattern>`
 *
 * 1. Load HwiCortex config
 * 2. Scan path with pattern
 * 3. For .pdf files → PdfParser → save to vault/docs/
 * 4. For .md files → copy to vault/docs/
 * 5. Index all files (source_type: "docs")
 * 6. Report results
 */

import { resolve, basename, join, extname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import fastGlob from "fast-glob";
import { loadConfig } from "../config/config-loader.js";
import { PdfParser } from "../ingest/pdf-parser.js";
import {
  insertDocument,
  hashContent,
  insertContent,
  createStore,
} from "../store.js";

export interface IngestOptions {
  path: string;
  name?: string;
  pattern?: string;
  configPath?: string;
}

export async function handleIngest(options: IngestOptions): Promise<void> {
  const configPath = options.configPath ?? resolve("hwicortex.yaml");
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const vaultPath = resolve(config.vault.path);
  const docsDir = join(vaultPath, "docs");
  mkdirSync(docsDir, { recursive: true });

  const scanPath = resolve(options.path);
  const pattern = options.pattern ?? "**/*.{md,pdf}";
  const collectionName = options.name ?? basename(scanPath);

  console.log(`Scanning ${scanPath} with pattern "${pattern}" ...`);

  const files = await fastGlob(pattern, {
    cwd: scanPath,
    absolute: true,
    onlyFiles: true,
  });

  if (files.length === 0) {
    console.log("No files found matching the pattern.");
    return;
  }

  console.log(`Found ${files.length} file(s). Processing...`);

  const store = createStore();
  const db = store.db;
  const pdfParser = new PdfParser();

  let processed = 0;
  let errors = 0;

  for (const filePath of files) {
    const ext = extname(filePath).toLowerCase();
    const fileName = basename(filePath);

    try {
      let content: string;
      let destPath: string;

      if (ext === ".pdf") {
        const result = await pdfParser.parse(filePath);
        if (result.error) {
          console.error(`  [ERROR] ${fileName}: ${result.error}`);
          errors++;
          continue;
        }
        content = result.markdown;
        destPath = join(docsDir, fileName.replace(/\.pdf$/i, ".md"));
      } else {
        // .md or other text files — copy as-is
        content = readFileSync(filePath, "utf-8");
        destPath = join(docsDir, fileName);
      }

      // Write to vault/docs/
      mkdirSync(join(docsDir), { recursive: true });
      writeFileSync(destPath, content, "utf-8");

      // Index the document
      const now = new Date().toISOString();
      const hash = await hashContent(content);
      const title = fileName.replace(/\.[^.]+$/, "");

      insertContent(db, hash, content, now);
      insertDocument(db, collectionName, destPath, title, hash, now, now, {
        source_type: "docs",
      });

      processed++;
      console.log(`  [OK] ${fileName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] ${fileName}: ${msg}`);
      errors++;
    }
  }

  store.close();

  console.log(`\nDone: ${processed} processed, ${errors} errors.`);
}
