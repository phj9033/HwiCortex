import type { Database } from "../db.js";
import { getRelationsForHash, getSymbolUsages, getFileGraph, findPath } from "../graph.js";

interface GraphOpts {
  collection?: string;
  json?: boolean;
}

function resolveFileHash(db: Database, filePath: string, collection?: string): { hash: string; path: string; collection: string } | null {
  let query = "SELECT hash, path, collection FROM documents WHERE active = 1 AND path LIKE ?";
  const params: any[] = [`%${filePath}%`];
  if (collection) {
    query += " AND collection = ?";
    params.push(collection);
  }
  query += " LIMIT 1";
  return db.prepare(query).get(...params) as any || null;
}

export function handleGraph(db: Database, file: string, opts: GraphOpts): string {
  const doc = resolveFileHash(db, file, opts.collection);
  if (!doc) return `File "${file}" not found in index.`;

  const graph = getFileGraph(db as any, doc.hash);
  const lines: string[] = [`Graph for ${doc.path} (${doc.collection})`];
  lines.push("");

  if (graph.imports.length > 0) {
    lines.push(`  imports: ${graph.imports.map(r => resolveHashToPath(db, r.target_hash) || r.target_ref).join(", ")}`);
  }
  if (graph.importedBy.length > 0) {
    lines.push(`  imported by: ${graph.importedBy.map(r => resolveHashToPath(db, r.source_hash)).join(", ")}`);
  }
  if (graph.extends.length > 0) {
    lines.push(`  extends: ${graph.extends.map(r => r.target_ref).join(", ")}`);
  }
  if (graph.implements.length > 0) {
    lines.push(`  implements: ${graph.implements.map(r => r.target_ref).join(", ")}`);
  }
  if (graph.calls.length > 0) {
    lines.push(`  calls: ${graph.calls.map(r => r.target_symbol || r.target_ref).join(", ")}`);
  }
  if (graph.calledBy.length > 0) {
    lines.push(`  called by: ${graph.calledBy.map(r => resolveHashToPath(db, r.source_hash)).join(", ")}`);
  }
  if (graph.cluster) {
    lines.push(`  cluster: ${graph.cluster}`);
  }

  if (lines.length === 2) lines.push("  (no relations found)");
  return lines.join("\n");
}

export function handlePath(db: Database, fileA: string, fileB: string, opts: GraphOpts): string {
  const docA = resolveFileHash(db, fileA, opts.collection);
  const docB = resolveFileHash(db, fileB, opts.collection);
  if (!docA) return `File "${fileA}" not found in index.`;
  if (!docB) return `File "${fileB}" not found in index.`;

  const path = findPath(db as any, docA.hash, docB.hash);
  if (!path) return `no path found between ${docA.path} and ${docB.path}`;

  const pathNames = path.map(hash => resolveHashToPath(db, hash) || hash);
  return pathNames.join(" → ");
}

export function handleRelated(db: Database, file: string, opts: GraphOpts): string {
  const doc = resolveFileHash(db, file, opts.collection);
  if (!doc) return `File "${file}" not found in index.`;

  const graph = getFileGraph(db as any, doc.hash);
  const related = new Set<string>();

  // Direct relations
  for (const r of [...graph.imports, ...graph.calls]) {
    if (r.target_hash) {
      const p = resolveHashToPath(db, r.target_hash);
      if (p) related.add(p);
    }
  }
  for (const r of [...graph.importedBy, ...graph.calledBy]) {
    const p = resolveHashToPath(db, r.source_hash);
    if (p) related.add(p);
  }

  // Same cluster members
  if (graph.cluster) {
    const members = db.prepare(`
      SELECT d.path FROM cluster_members cm
      JOIN clusters c ON cm.cluster_id = c.id
      JOIN documents d ON cm.hash = d.hash AND d.active = 1
      WHERE c.name = ? AND cm.hash != ?
    `).all(graph.cluster, doc.hash) as { path: string }[];
    for (const m of members) related.add(m.path);
  }

  related.delete(doc.path);
  if (related.size === 0) return `No related files found for ${doc.path}`;

  const lines = [`Related to ${doc.path}:`, ""];
  for (const p of related) lines.push(`  ${p}`);
  return lines.join("\n");
}

export function handleSymbol(db: Database, name: string, opts: GraphOpts): string {
  const usages = getSymbolUsages(db as any, name);
  if (usages.defined.length === 0 && usages.usedBy.length === 0) {
    return `Symbol "${name}" not found.`;
  }

  const lines: string[] = [`Symbol: ${name}`, ""];

  if (usages.defined.length > 0) {
    lines.push("  defined in:");
    for (const s of usages.defined) {
      const path = resolveHashToPath(db, s.hash) || s.hash;
      lines.push(`    ${path}:${s.line} (${s.kind})`);
    }
  }

  if (usages.usedBy.length > 0) {
    lines.push("  used by:");
    for (const r of usages.usedBy) {
      const path = resolveHashToPath(db, r.source_hash) || r.source_hash;
      lines.push(`    ${path} (${r.type})`);
    }
  }

  return lines.join("\n");
}

export function handleClusters(db: Database, opts: GraphOpts): string {
  let query = "SELECT c.id, c.name, c.collection, COUNT(cm.hash) as member_count FROM clusters c JOIN cluster_members cm ON c.id = cm.cluster_id";
  const params: any[] = [];
  if (opts.collection) {
    query += " WHERE c.collection = ?";
    params.push(opts.collection);
  }
  query += " GROUP BY c.id ORDER BY member_count DESC";

  const clusters = db.prepare(query).all(...params) as { id: number; name: string; collection: string; member_count: number }[];

  if (clusters.length === 0) return "No clusters found.";

  const lines = ["Clusters:", ""];
  for (const c of clusters) {
    lines.push(`  ${c.name} (${c.collection}) — ${c.member_count} files`);
    // List members
    const members = db.prepare(`
      SELECT d.path FROM cluster_members cm
      JOIN documents d ON cm.hash = d.hash AND d.active = 1
      WHERE cm.cluster_id = ?
    `).all(c.id) as { path: string }[];
    for (const m of members) lines.push(`    ${m.path}`);
  }
  return lines.join("\n");
}

// Helper
function resolveHashToPath(db: Database, hash: string | null): string | null {
  if (!hash) return null;
  const doc = db.prepare("SELECT path FROM documents WHERE hash = ? AND active = 1 LIMIT 1").get(hash) as { path: string } | undefined;
  return doc?.path ?? null;
}
