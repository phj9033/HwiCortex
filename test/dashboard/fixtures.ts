import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createStore, type Store } from "../../src/store.js";

export function makeTempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "hwicortex-dash-vault-"));
  mkdirSync(join(dir, "wiki", "bb3wiki"), { recursive: true });
  return dir;
}

export function makeTempStore(): { store: Store; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hwicortex-dash-db-"));
  const dbPath = join(dir, "index.sqlite");
  process.env.INDEX_PATH = dbPath;
  const store = createStore(dbPath);
  return { store, dbPath, cleanup: () => store.db.close() };
}

export function writeWikiPage(
  vaultDir: string,
  project: string,
  title: string,
  body: string,
  meta: Record<string, unknown> = {}
): string {
  const slug = title.toLowerCase().replace(/[^\w가-힣]+/g, "-");
  const path = join(vaultDir, "wiki", project, `${slug}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const fm = [
    "---",
    `title: ${title}`,
    `project: ${project}`,
    ...Object.entries(meta).map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}: ${v}`;
      if (typeof v === "string") return `${k}: ${v}`;  // unquoted — matches buildFrontmatter
      return `${k}: ${JSON.stringify(v)}`;
    }),
    "---",
    "",
    body,
  ].join("\n");
  writeFileSync(path, fm);
  return path;
}
