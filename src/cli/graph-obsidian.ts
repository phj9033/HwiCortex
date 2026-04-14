import type { Database } from "../db.js";
import { getFileGraph } from "../graph.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Generate Obsidian-compatible markdown for a cluster index page.
 */
export function generateClusterPage(db: Database, clusterName: string, memberHashes: string[]): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`title: "Cluster: ${clusterName}"`);
  lines.push("tags: [cluster, auto-generated]");
  lines.push("---");
  lines.push("");
  lines.push(`## ${clusterName}`);
  lines.push("");

  // Get member file info
  const members: { path: string; hash: string }[] = [];
  for (const hash of memberHashes) {
    const doc = db.prepare("SELECT path FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(hash) as { path: string } | undefined;
    if (doc) members.push({ path: doc.path, hash });
  }

  lines.push(`**파일 수:** ${members.length}`);
  lines.push("");
  lines.push("### 파일 목록");

  for (const m of members) {
    const stem = m.path.replace(/\.[^.]+$/, "").split("/").pop() || m.path;
    // Get this file's imports
    const imports = db.prepare(
      "SELECT target_ref FROM relations WHERE source_hash = ? AND type = 'imports'"
    ).all(m.hash) as { target_ref: string }[];
    const importList = imports.length > 0
      ? ` — imports: ${imports.map(i => i.target_ref).join(", ")}`
      : "";
    lines.push(`- [[${stem}]]${importList}`);
  }

  // Relation summary
  const internalRels = db.prepare(`
    SELECT COUNT(*) as cnt FROM relations
    WHERE source_hash IN (${memberHashes.map(() => "?").join(",")})
    AND target_hash IN (${memberHashes.map(() => "?").join(",")})
  `).get(...memberHashes, ...memberHashes) as { cnt: number };

  const externalRels = db.prepare(`
    SELECT COUNT(*) as cnt FROM relations
    WHERE source_hash IN (${memberHashes.map(() => "?").join(",")})
    AND (target_hash IS NULL OR target_hash NOT IN (${memberHashes.map(() => "?").join(",")}))
  `).get(...memberHashes, ...memberHashes) as { cnt: number };

  lines.push("");
  lines.push("### 관계 요약");
  lines.push(`- 내부 연결: ${internalRels.cnt}`);
  lines.push(`- 외부 의존: ${externalRels.cnt}`);

  return lines.join("\n");
}

/**
 * Generate Obsidian-compatible markdown for a file's relations.
 */
export function generateRelationPage(db: Database, hash: string): string {
  const doc = db.prepare("SELECT path, collection FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(hash) as { path: string; collection: string } | undefined;
  if (!doc) return "";

  const stem = doc.path.replace(/\.[^.]+$/, "").split("/").pop() || doc.path;
  const graph = getFileGraph(db, hash);

  // Get symbols
  const symbols = db.prepare("SELECT name, kind FROM symbols WHERE hash = ?").all(hash) as { name: string; kind: string }[];

  const lines: string[] = [];

  // Frontmatter
  const tags = ["graph"];
  if (graph.cluster) tags.push(graph.cluster);
  const relatedLinks = [...new Set([
    ...graph.imports.map(r => resolveToStem(db, r.target_hash)),
    ...graph.importedBy.map(r => resolveToStem(db, r.source_hash)),
  ])].filter(Boolean);

  lines.push("---");
  lines.push(`title: "${doc.path}"`);
  lines.push(`tags: [${tags.join(", ")}]`);
  if (relatedLinks.length > 0) {
    lines.push(`related: [${relatedLinks.map(l => `[[${l}]]`).join(", ")}]`);
  }
  lines.push("---");
  lines.push("");

  // Symbols
  if (symbols.length > 0) {
    lines.push("## 심볼");
    for (const s of symbols) {
      lines.push(`- \`${s.name}\` (${s.kind})`);
    }
    lines.push("");
  }

  // Relations
  lines.push("## 관계");

  if (graph.imports.length > 0) {
    const importLinks = graph.imports.map(r => {
      const s = resolveToStem(db, r.target_hash);
      return s ? `[[${s}]]` : r.target_ref;
    });
    lines.push(`- imports: ${importLinks.join(", ")}`);
  }

  if (graph.importedBy.length > 0) {
    const byLinks = graph.importedBy.map(r => {
      const s = resolveToStem(db, r.source_hash);
      return s ? `[[${s}]]` : "unknown";
    });
    lines.push(`- imported by: ${byLinks.join(", ")}`);
  }

  if (graph.extends.length > 0) {
    lines.push(`- extends: ${graph.extends.map(r => r.target_ref).join(", ")}`);
  }

  if (graph.implements.length > 0) {
    lines.push(`- implements: ${graph.implements.map(r => r.target_ref).join(", ")}`);
  }

  if (graph.imports.length === 0 && graph.importedBy.length === 0 && graph.extends.length === 0 && graph.implements.length === 0) {
    lines.push("- (no relations)");
  }

  return lines.join("\n");
}

function resolveToStem(db: Database, hash: string | null): string | null {
  if (!hash) return null;
  const doc = db.prepare("SELECT path FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(hash) as { path: string } | undefined;
  if (!doc) return null;
  return doc.path.replace(/\.[^.]+$/, "").split("/").pop() || null;
}

/**
 * Write full Obsidian graph to vault.
 */
export async function writeObsidianGraph(db: Database, vaultPath: string, project: string): Promise<void> {
  const clusterDir = join(vaultPath, "wiki", project, "_clusters");
  const graphDir = join(vaultPath, "wiki", project, "_graph");
  mkdirSync(clusterDir, { recursive: true });
  mkdirSync(graphDir, { recursive: true });

  // Write cluster pages
  const clusters = db.prepare("SELECT id, name FROM clusters WHERE collection = ?").all(project) as { id: number; name: string }[];
  for (const cluster of clusters) {
    const members = db.prepare("SELECT hash FROM cluster_members WHERE cluster_id = ?").all(cluster.id) as { hash: string }[];
    const page = generateClusterPage(db, cluster.name, members.map(m => m.hash));
    writeFileSync(join(clusterDir, `${cluster.name}.md`), page);
  }

  // Write file relation pages
  const docs = db.prepare("SELECT DISTINCT hash, path FROM documents WHERE collection = ? AND active = 1").all(project) as { hash: string; path: string }[];
  let relPages = 0;
  for (const doc of docs) {
    const hasRelations = db.prepare(
      "SELECT 1 FROM relations WHERE source_hash = ? OR target_hash = ? LIMIT 1"
    ).get(doc.hash, doc.hash);
    if (hasRelations) {
      const page = generateRelationPage(db, doc.hash);
      if (page) {
        const stem = doc.path.replace(/\.[^.]+$/, "").split("/").pop() || doc.hash;
        writeFileSync(join(graphDir, `${stem}.md`), page);
        relPages++;
      }
    }
  }

  console.log(`Generated ${clusters.length} cluster pages → ${clusterDir}`);
  console.log(`Generated ${relPages} relation pages → ${graphDir}`);
}
