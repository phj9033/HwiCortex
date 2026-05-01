type FilterCfg = {
  min_words: number;
  max_words: number;
  exclude_domains: string[];
  require_lang: string | null;
};

const PAYWALL_HINTS = /\b(subscribe to read|paywall|sign up to continue|members only)\b/i;

export function evaluateQuality(
  doc: { body_md: string; canonical_url: string; language: string | null },
  cfg: FilterCfg,
): { accept: boolean; reason?: string } {
  const wc = doc.body_md.split(/\s+/).filter(Boolean).length;
  if (wc < cfg.min_words) return { accept: false, reason: `min_words<${cfg.min_words}` };
  if (wc > cfg.max_words) return { accept: false, reason: `max_words>${cfg.max_words}` };

  const host = new URL(doc.canonical_url).hostname;
  if (cfg.exclude_domains.some((d) => host === d || host.endsWith("." + d))) {
    return { accept: false, reason: "excluded_domain" };
  }

  if (cfg.require_lang && doc.language && doc.language !== cfg.require_lang) {
    return { accept: false, reason: "lang_mismatch" };
  }

  if (PAYWALL_HINTS.test(doc.body_md.slice(0, 2000))) {
    return { accept: false, reason: "paywall" };
  }

  return { accept: true };
}
