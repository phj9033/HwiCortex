import { createHash } from "crypto";

export function bodyHash(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export class DedupIndex {
  private urls = new Set<string>();
  private hashes = new Set<string>();

  seen(rec: { canonical_url: string; body_hash?: string }): boolean {
    if (this.urls.has(rec.canonical_url)) return true;
    if (rec.body_hash && this.hashes.has(rec.body_hash)) return true;
    return false;
  }

  record(rec: { canonical_url: string; body_hash?: string }): void {
    this.urls.add(rec.canonical_url);
    if (rec.body_hash) this.hashes.add(rec.body_hash);
  }

  size(): number {
    return this.urls.size;
  }
}
