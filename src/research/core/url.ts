import { createHash } from "crypto";

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|ref$|ref_)/;

export function canonicalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const [k] of [...u.searchParams.entries()]) {
    if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  }
  let s = u.toString();
  if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
  return s;
}

export function sourceIdFor(url: string): string {
  return createHash("sha256").update(canonicalize(url)).digest("hex").slice(0, 12);
}
