const cache = new Map<string, string>();
const ROBOTS_TIMEOUT_MS = 5000;

export async function isAllowed(url: string, userAgent: string): Promise<boolean> {
  const u = new URL(url);
  const robotsUrl = `${u.origin}/robots.txt`;
  let body = cache.get(robotsUrl);
  if (body === undefined) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ROBOTS_TIMEOUT_MS);
    try {
      const res = await fetch(robotsUrl, { signal: ac.signal });
      body = res.ok ? await res.text() : "";
    } catch {
      body = "";
    } finally {
      clearTimeout(t);
    }
    cache.set(robotsUrl, body);
  }
  return checkRobots(body, userAgent, u.pathname || "/");
}

export function _resetRobotsCacheForTests(): void {
  cache.clear();
}

function checkRobots(body: string, ua: string, path: string): boolean {
  const lines = body
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);

  type Group = { ua: string; rules: { type: "allow" | "disallow"; pat: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;

  for (const line of lines) {
    const parts = line.split(":");
    if (parts.length < 2) continue;
    const key = (parts[0] ?? "").trim().toLowerCase();
    const val = parts.slice(1).join(":").trim();
    if (key === "user-agent") {
      if (!cur) {
        cur = { ua: val, rules: [] };
        groups.push(cur);
      } else if (cur.rules.length === 0) {
        cur.ua = val;
      } else {
        cur = { ua: val, rules: [] };
        groups.push(cur);
      }
    } else if (key === "allow" && cur) {
      cur.rules.push({ type: "allow", pat: val });
    } else if (key === "disallow" && cur) {
      cur.rules.push({ type: "disallow", pat: val });
    }
  }

  const candidate =
    groups.find((g) => g.ua.toLowerCase() === ua.toLowerCase()) ??
    groups.find((g) => g.ua === "*");
  if (!candidate) return true;

  let best: { type: "allow" | "disallow"; len: number } | null = null;
  for (const r of candidate.rules) {
    if (r.pat === "" && r.type === "disallow") continue;
    if (
      path.startsWith(r.pat) &&
      (!best ||
        r.pat.length > best.len ||
        (r.pat.length === best.len && r.type === "allow"))
    ) {
      best = { type: r.type, len: r.pat.length };
    }
  }
  return best?.type !== "disallow";
}
