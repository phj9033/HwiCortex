import type { Database } from "./db.js";
import type { AstSymbol, AstRelation } from "./ast.js";

// --- Types ---
export interface RelationRow {
  id: number;
  source_hash: string;
  target_hash: string | null;
  target_ref: string;
  type: string;
  source_symbol: string | null;
  target_symbol: string | null;
  confidence: number;
}

export interface SymbolRow {
  id: number;
  hash: string;
  name: string;
  kind: string;
  line: number | null;
}

export interface FileGraphInfo {
  imports: RelationRow[];
  importedBy: RelationRow[];
  extends: RelationRow[];
  extendedBy: RelationRow[];
  implements: RelationRow[];
  implementedBy: RelationRow[];
  calls: RelationRow[];
  calledBy: RelationRow[];
  wikiLinks: RelationRow[];
  wikiLinkedBy: RelationRow[];
  cluster?: string;
}

export interface ClusterResult {
  members: string[];  // array of content hashes
}

export interface NamedCluster {
  name: string;
  members: string[];
}

// --- Storage ---
export function saveSymbols(db: Database, hash: string, symbols: AstSymbol[]): void {
  db.prepare("DELETE FROM symbols WHERE hash = ?").run(hash);
  const insert = db.prepare("INSERT INTO symbols (hash, name, kind, line) VALUES (?, ?, ?, ?)");
  for (const s of symbols) {
    insert.run(hash, s.name, s.kind, s.line);
  }
}

export function saveRelations(db: Database, hash: string, relations: AstRelation[]): void {
  db.prepare("DELETE FROM relations WHERE source_hash = ?").run(hash);
  const insert = db.prepare(
    "INSERT INTO relations (source_hash, target_ref, type, source_symbol, target_symbol, confidence) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const r of relations) {
    insert.run(hash, r.targetRef, r.type, r.sourceSymbol ?? null, r.targetSymbol ?? null, 1.0);
  }
}

// --- Queries ---
export function getRelationsForHash(db: Database, hash: string): RelationRow[] {
  return db.prepare("SELECT * FROM relations WHERE source_hash = ? OR target_hash = ?").all(hash, hash) as RelationRow[];
}

export function getSymbolUsages(db: Database, symbolName: string): { defined: SymbolRow[]; usedBy: RelationRow[] } {
  const defined = db.prepare("SELECT * FROM symbols WHERE name = ?").all(symbolName) as SymbolRow[];
  const usedBy = db.prepare("SELECT * FROM relations WHERE target_symbol = ?").all(symbolName) as RelationRow[];
  return { defined, usedBy };
}

// --- Resolution ---
export function resolveTargetHashes(db: Database, collection: string): number {
  // Match target_ref against documents.path in the same collection
  // Handle relative paths: "./b" should match "src/b.ts", "src/b/index.ts", etc.
  const unresolved = db.prepare(`
    SELECT r.id, r.source_hash, r.target_ref, r.type, r.target_symbol
    FROM relations r
    WHERE r.target_hash IS NULL
  `).all() as { id: number; source_hash: string; target_ref: string; type: string; target_symbol: string | null }[];

  let resolved = 0;
  const update = db.prepare("UPDATE relations SET target_hash = ? WHERE id = ?");

  // Build symbol → hash lookup for symbol-name fallback (used by C# extends/implements/calls)
  const symbolLookup = new Map<string, string>();
  const allSymbols = db.prepare(`
    SELECT s.name, s.hash FROM symbols s
    JOIN documents d ON s.hash = d.hash
    WHERE d.collection = ? AND d.active = 1
  `).all(collection) as { name: string; hash: string }[];
  for (const s of allSymbols) {
    if (!symbolLookup.has(s.name)) symbolLookup.set(s.name, s.hash);
  }

  // Build stem → hash lookup for wiki-link resolution
  const stemLookup = new Map<string, string>();      // stem → hash
  const pathStemLookup = new Map<string, string>();   // "dir/stem" → hash
  const allDocs = db.prepare(
    "SELECT path, hash FROM documents WHERE collection = ? AND active = 1"
  ).all(collection) as { path: string; hash: string }[];
  for (const d of allDocs) {
    const lastSlash = d.path.lastIndexOf("/");
    const filename = lastSlash >= 0 ? d.path.substring(lastSlash + 1) : d.path;
    const dotIdx = filename.lastIndexOf(".");
    const stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
    if (!stemLookup.has(stem)) stemLookup.set(stem, d.hash);
    // Also store path without extension for path-suffix matching
    const pathWithoutExt = dotIdx > 0 ? d.path.substring(0, d.path.lastIndexOf(".")) : d.path;
    pathStemLookup.set(pathWithoutExt, d.hash);
  }

  for (const rel of unresolved) {
    // Wiki-link resolution: match against document filename stems
    if (rel.type === "wiki_link") {
      // Try path suffix first (for [[specs/achievement]] style)
      const byPath = pathStemLookup.get(rel.target_ref);
      if (byPath && byPath !== rel.source_hash) {
        update.run(byPath, rel.id);
        resolved++;
        continue;
      }
      // Then try stem match (for [[settings]] style)
      const byStem = stemLookup.get(rel.target_ref);
      if (byStem && byStem !== rel.source_hash) {
        update.run(byStem, rel.id);
        resolved++;
      }
      continue;
    }

    // Get the source document's path to resolve relative imports
    const sourceDoc = db.prepare(
      "SELECT path FROM documents WHERE hash = ? AND collection = ? AND active = 1 LIMIT 1"
    ).get(rel.source_hash, collection) as { path: string } | undefined;

    if (!sourceDoc) continue;

    // Resolve relative path
    const sourceDir = sourceDoc.path.substring(0, sourceDoc.path.lastIndexOf("/"));
    const targetRef = rel.target_ref;

    let candidatePath: string;
    if (targetRef.startsWith("./") || targetRef.startsWith("../")) {
      candidatePath = resolvePath(sourceDir, targetRef);
    } else {
      candidatePath = targetRef;
    }

    // Try to find a matching document (with various extensions)
    let found = false;
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".cs", "/index.ts", "/index.js"];
    for (const ext of extensions) {
      const doc = db.prepare(
        "SELECT hash FROM documents WHERE path = ? AND collection = ? AND active = 1 LIMIT 1"
      ).get(candidatePath + ext, collection) as { hash: string } | undefined;

      if (doc) {
        update.run(doc.hash, rel.id);
        resolved++;
        found = true;
        break;
      }
    }

    // Symbol-name fallback (only if path resolution didn't find it)
    if (!found && rel.type !== "imports" && rel.type !== "wiki_link") {
      const targetHash = symbolLookup.get(rel.target_ref) ?? symbolLookup.get(rel.target_symbol ?? "");
      if (targetHash && targetHash !== rel.source_hash) {
        update.run(targetHash, rel.id);
        resolved++;
      }
    }
  }

  return resolved;
}

// Simple path resolution helper
function resolvePath(base: string, relative: string): string {
  const parts = base.split("/").filter(Boolean);
  const relParts = relative.split("/");
  for (const part of relParts) {
    if (part === ".") continue;
    if (part === "..") { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join("/");
}

// --- Graph Info ---
export function getFileGraph(db: Database, hash: string): FileGraphInfo {
  const outgoing = db.prepare("SELECT * FROM relations WHERE source_hash = ?").all(hash) as RelationRow[];
  const incoming = db.prepare("SELECT * FROM relations WHERE target_hash = ?").all(hash) as RelationRow[];

  // Get cluster membership
  const clusterRow = db.prepare(`
    SELECT c.name FROM clusters c
    JOIN cluster_members cm ON c.id = cm.cluster_id
    WHERE cm.hash = ? LIMIT 1
  `).get(hash) as { name: string } | undefined;

  return {
    imports: outgoing.filter(r => r.type === "imports"),
    importedBy: incoming.filter(r => r.type === "imports"),
    extends: outgoing.filter(r => r.type === "extends"),
    extendedBy: incoming.filter(r => r.type === "extends"),
    implements: outgoing.filter(r => r.type === "implements"),
    implementedBy: incoming.filter(r => r.type === "implements"),
    calls: outgoing.filter(r => r.type === "calls"),
    calledBy: incoming.filter(r => r.type === "calls"),
    wikiLinks: outgoing.filter(r => r.type === "wiki_link"),
    wikiLinkedBy: incoming.filter(r => r.type === "wiki_link"),
    cluster: clusterRow?.name,
  };
}

// --- Path Finding (BFS) ---
export function findPath(db: Database, fromHash: string, toHash: string): string[] | null {
  if (fromHash === toHash) return [fromHash];

  // Build adjacency from relations (follow both directions)
  const allRelations = db.prepare("SELECT source_hash, target_hash FROM relations WHERE target_hash IS NOT NULL").all() as { source_hash: string; target_hash: string }[];

  const adj = new Map<string, Set<string>>();
  for (const r of allRelations) {
    if (!adj.has(r.source_hash)) adj.set(r.source_hash, new Set());
    adj.get(r.source_hash)!.add(r.target_hash);
    // Bidirectional for path finding
    if (!adj.has(r.target_hash)) adj.set(r.target_hash, new Set());
    adj.get(r.target_hash)!.add(r.source_hash);
  }

  // BFS
  const visited = new Set<string>([fromHash]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromHash];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current);
    if (!neighbors) continue;

    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, current);

      if (next === toHash) {
        // Reconstruct path
        const path: string[] = [toHash];
        let node = toHash;
        while (parent.has(node)) {
          node = parent.get(node)!;
          path.unshift(node);
        }
        return path;
      }

      queue.push(next);
    }
  }

  return null;
}

// --- Clustering ---
export function detectClusters(db: Database, collection: string, opts?: { relationTypes?: string[] }): ClusterResult[] {
  // 1. Get all hashes in this collection
  const docs = db.prepare(
    "SELECT DISTINCT d.hash FROM documents d WHERE d.collection = ? AND d.active = 1"
  ).all(collection) as { hash: string }[];

  const allHashes = new Set(docs.map(d => d.hash));
  if (allHashes.size === 0) return [];

  // 2. Build adjacency from resolved relations within this collection
  let relQuery = `
    SELECT r.source_hash, r.target_hash FROM relations r
    WHERE r.target_hash IS NOT NULL
    AND r.source_hash IN (SELECT hash FROM documents WHERE collection = ? AND active = 1)
    AND r.target_hash IN (SELECT hash FROM documents WHERE collection = ? AND active = 1)
  `;
  const params: any[] = [collection, collection];

  if (opts?.relationTypes && opts.relationTypes.length > 0) {
    const placeholders = opts.relationTypes.map(() => "?").join(", ");
    relQuery += ` AND r.type IN (${placeholders})`;
    params.push(...opts.relationTypes);
  }

  const relations = db.prepare(relQuery).all(...params) as { source_hash: string; target_hash: string }[];

  const adj = new Map<string, Set<string>>();
  for (const hash of allHashes) adj.set(hash, new Set());

  for (const r of relations) {
    adj.get(r.source_hash)?.add(r.target_hash);
    adj.get(r.target_hash)?.add(r.source_hash);
  }

  // 3. Label propagation
  const labels = new Map<string, string>();
  for (const hash of allHashes) labels.set(hash, hash); // each node starts with own label

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 100) {
    changed = false;
    iterations++;

    for (const hash of allHashes) {
      const neighbors = adj.get(hash);
      if (!neighbors || neighbors.size === 0) continue;

      // Count neighbor labels
      const labelCounts = new Map<string, number>();
      for (const neighbor of neighbors) {
        const label = labels.get(neighbor)!;
        labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
      }

      // Find most frequent label
      let maxCount = 0;
      let maxLabel = labels.get(hash)!;
      for (const [label, count] of labelCounts) {
        if (count > maxCount) {
          maxCount = count;
          maxLabel = label;
        }
      }

      if (maxLabel !== labels.get(hash)) {
        labels.set(hash, maxLabel);
        changed = true;
      }
    }
  }

  // 4. Group by label, filter singletons
  const groups = new Map<string, string[]>();
  for (const [hash, label] of labels) {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(hash);
  }

  return Array.from(groups.values())
    .filter(members => members.length >= 2)
    .map(members => ({ members }));
}

export function nameClusters(db: Database, clusters: ClusterResult[]): NamedCluster[] {
  return clusters.map((cluster, i) => {
    // Find most-imported symbol in this cluster
    const placeholders = cluster.members.map(() => "?").join(",");
    const topSymbol = db.prepare(`
      SELECT r.target_symbol, COUNT(*) as cnt
      FROM relations r
      WHERE r.target_hash IN (${placeholders})
      AND r.target_symbol IS NOT NULL
      GROUP BY r.target_symbol
      ORDER BY cnt DESC
      LIMIT 1
    `).get(...cluster.members) as { target_symbol: string; cnt: number } | undefined;

    if (topSymbol) {
      return { name: topSymbol.target_symbol, members: cluster.members };
    }

    // Fallback: use most common filename stem
    const docs = db.prepare(`
      SELECT path FROM documents WHERE hash IN (${placeholders}) AND active = 1
    `).all(...cluster.members) as { path: string }[];

    const stems = docs.map(d => {
      const parts = d.path.split("/");
      const file = parts[parts.length - 1] || "";
      return file.replace(/\.[^.]+$/, "");
    });

    // Most common stem
    const stemCounts = new Map<string, number>();
    for (const s of stems) stemCounts.set(s, (stemCounts.get(s) || 0) + 1);
    let bestStem = `cluster-${i}`;
    let bestCount = 0;
    for (const [stem, count] of stemCounts) {
      if (count > bestCount) { bestCount = count; bestStem = stem; }
    }

    return { name: bestStem, members: cluster.members };
  });
}

export function saveClusters(db: Database, collection: string, clusters: NamedCluster[], kind: "code" | "doc" = "code"): void {
  // Delete existing clusters for collection and kind
  const existingClusters = db.prepare(
    "SELECT id FROM clusters WHERE collection = ? AND kind = ?"
  ).all(collection, kind) as { id: number }[];
  for (const c of existingClusters) {
    db.prepare("DELETE FROM cluster_members WHERE cluster_id = ?").run(c.id);
  }
  db.prepare("DELETE FROM clusters WHERE collection = ? AND kind = ?").run(collection, kind);

  // Insert new clusters
  const insertCluster = db.prepare("INSERT INTO clusters (collection, name, kind) VALUES (?, ?, ?)");
  const insertMember = db.prepare("INSERT INTO cluster_members (cluster_id, hash) VALUES (?, ?)");

  for (const cluster of clusters) {
    const result = insertCluster.run(collection, cluster.name, kind);
    const clusterId = result.lastInsertRowid;
    for (const hash of cluster.members) {
      insertMember.run(clusterId, hash);
    }
  }
}

// --- Search Result Enrichment ---
export interface EnrichedResult {
  cluster?: string;
  importedByCount: number;
  [key: string]: any;  // preserve original fields
}

export function enrichSearchResults(db: Database, results: { hash?: string; [key: string]: any }[]): EnrichedResult[] {
  return results.map(result => {
    // Skip enrichment if no hash
    if (!result.hash) {
      return {
        ...result,
        cluster: undefined,
        importedByCount: 0,
      };
    }

    // Get cluster
    const clusterRow = db.prepare(`
      SELECT c.name FROM clusters c
      JOIN cluster_members cm ON c.id = cm.cluster_id
      WHERE cm.hash = ? LIMIT 1
    `).get(result.hash) as { name: string } | undefined;

    // Count files that import this one
    const importCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM relations WHERE target_hash = ? AND type = 'imports'"
    ).get(result.hash) as { cnt: number };

    return {
      ...result,
      cluster: clusterRow?.name,
      importedByCount: importCount?.cnt ?? 0,
    };
  });
}
