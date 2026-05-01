import { DomainRateLimiter } from "./rate-limit.js";
import { isAllowed } from "./robots.js";
import { FetchCache } from "./cache.js";
import { canonicalize } from "./url.js";
import type { FetchedDoc, ContentType } from "./types.js";

export type FetcherCfg = {
  user_agent: string;
  timeout_ms: number;
  max_redirects: number;
  rate_limiter: DomainRateLimiter;
  cache: FetchCache;
};

export class FetchError extends Error {
  constructor(
    public code: string,
    public url: string,
    public detail?: string,
  ) {
    super(`fetch ${code}: ${url}${detail ? ` — ${detail}` : ""}`);
  }
}

export async function fetchUrl(url: string, cfg: FetcherCfg): Promise<FetchedDoc> {
  const canonical = canonicalize(url);
  const u = new URL(canonical);

  const allowed = await isAllowed(canonical, cfg.user_agent);
  if (!allowed) throw new FetchError("ROBOTS_DISALLOWED", canonical);

  await cfg.rate_limiter.acquire(u.hostname);

  const validators = cfg.cache.getValidators(canonical);
  const headers: Record<string, string> = {
    "user-agent": cfg.user_agent,
    accept: "text/html,application/pdf,application/xhtml+xml,*/*;q=0.8",
  };
  if (validators.etag) headers["if-none-match"] = validators.etag;
  if (validators.lm) headers["if-modified-since"] = validators.lm;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), cfg.timeout_ms);
  let res: Response;
  try {
    res = await fetch(canonical, { headers, redirect: "follow", signal: ac.signal });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FetchError("NETWORK", canonical, msg);
  } finally {
    clearTimeout(t);
  }

  if (res.status === 304 && validators.blob) {
    const buf = cfg.cache.read(validators.blob);
    return makeDoc(canonical, 304, buf, res.headers, validators.blob);
  }
  if (!res.ok) throw new FetchError("HTTP_" + res.status, canonical);

  const buf = Buffer.from(await res.arrayBuffer());
  const blob = cfg.cache.store(
    canonical,
    buf,
    res.headers.get("etag") ?? undefined,
    res.headers.get("last-modified") ?? undefined,
  );
  return makeDoc(canonical, res.status, buf, res.headers, blob);
}

function makeDoc(
  url: string,
  status: number,
  body: Buffer,
  headers: Headers,
  blob: string | null,
): FetchedDoc {
  const ct = (headers.get("content-type") || "").toLowerCase();
  const content_type: ContentType = ct.includes("pdf") ? "pdf" : "html";
  return {
    url,
    canonical_url: url,
    status,
    fetched_at: new Date().toISOString(),
    content_type,
    body_bytes: body,
    cache_blob: blob,
  };
}
