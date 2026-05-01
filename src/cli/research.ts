import { parseArgs } from "util";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { fetchTopic } from "../research/pipeline/fetch.js";
import { searchTopic, defaultDraftDbPath } from "../research/pipeline/draft.js";
import { loadTopic, adhocTopicFromPrompt } from "../research/topic/loader.js";
import { scaffoldTopic, listTopicIds } from "../research/topic/scaffold.js";
import { computeStatus } from "../research/pipeline/status.js";
import type { ResearchConfig } from "../research/pipeline/fetch.js";
import type { SourceSpec } from "../research/topic/schema.js";

const SOURCE_TYPES: ReadonlySet<SourceSpec["type"]> = new Set([
  "seed-urls",
  "from-document",
  "arxiv",
  "rss",
  "web-search",
]);

export async function runResearchCli(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "fetch":
      await runFetch(rest);
      return;
    case "search":
      await runSearch(rest);
      return;
    case "topic":
      await runTopic(rest);
      return;
    case "import":
      await runImport(rest);
      return;
    case "status":
      await runStatus(rest);
      return;
    default:
      console.error(
        "usage: hwicortex research <fetch|search|topic|import|status> ...\n" +
          "  Synthesis and draft writing are now agent-driven; see\n" +
          "  docs/research/agent-guide.md and the /research-build / /research-draft skills.",
      );
      process.exitCode = 1;
  }
}

async function runFetch(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      refresh: { type: "boolean", default: false },
      "max-new": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      source: { type: "string" },
      vault: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const target = positionals[0];
  if (!target) {
    console.error("usage: hwicortex research fetch <topic-id|prompt>");
    process.exitCode = 1;
    return;
  }

  const vault = values.vault ?? loadVaultPath();
  const config = loadResearchConfig();

  let topic;
  try {
    topic = await loadTopic(target, vault);
  } catch {
    topic = adhocTopicFromPrompt(target);
  }

  let source: SourceSpec["type"] | undefined;
  if (values.source !== undefined) {
    if (!SOURCE_TYPES.has(values.source as SourceSpec["type"])) {
      console.error(
        `--source must be one of: ${[...SOURCE_TYPES].join(", ")}`,
      );
      process.exitCode = 2;
      return;
    }
    source = values.source as SourceSpec["type"];
  }

  const r = await fetchTopic({
    topic,
    vault,
    config,
    refresh: values["refresh"],
    maxNew: values["max-new"] ? Number(values["max-new"]) : undefined,
    source,
    dryRun: values["dry-run"],
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Fetched ${r.fetched}/${r.discovered} (skipped ${r.skipped}, errored ${r.errored}); +${r.records_added} records.\n`,
    );
  }
}

async function runSearch(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      query: { type: "string" },
      "top-k": { type: "string" },
      "include-vault": { type: "boolean", default: false },
      vault: { type: "string" },
      "db-path": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const id = positionals[0];
  if (!id || !values.query) {
    console.error("usage: hwicortex research search <topic-id> --query <text> [--top-k N] [--include-vault]");
    process.exitCode = 1;
    return;
  }

  const vault = values.vault ?? loadVaultPath();
  const topic = await loadTopic(id, vault);
  const r = await searchTopic({
    topic,
    vault,
    query: values.query,
    topK: values["top-k"] ? Number(values["top-k"]) : undefined,
    includeVault: values["include-vault"],
    dbPath: values["db-path"] ?? defaultDraftDbPath(vault, topic.id),
  });

  if (values.json) {
    // Strip the verbose hits payload from the default JSON; agents that need
    // raw hits can re-run with --json --raw (not yet implemented) or use the SDK.
    process.stdout.write(JSON.stringify({ context: r.context }, null, 2) + "\n");
  } else {
    if (r.context.length === 0) {
      process.stdout.write("(no context hits)\n");
    } else {
      for (const c of r.context) {
        process.stdout.write(`- [${c.source_id}] ${c.title} — ${c.path}\n`);
      }
    }
  }
}

async function runStatus(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const id = positionals[0];
  if (!id) {
    console.error("usage: hwicortex research status <topic-id>");
    process.exitCode = 1;
    return;
  }
  const vault = values.vault ?? loadVaultPath();
  const s = computeStatus(vault, id);
  if (values.json) {
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
  } else {
    process.stdout.write(
      `topic: ${s.topic_id}\n` +
        `raw=${s.raw_records} cards=${s.cards} notes=${s.synthesis_notes} drafts=${s.drafts}\n` +
        `last=${s.last_event_ts ?? "(none)"}\n`,
    );
  }
}

async function runImport(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const [topicId, docPath] = positionals;
  if (!topicId || !docPath) {
    console.error(
      "usage: hwicortex research import <topic-id> <doc-path>",
    );
    process.exitCode = 1;
    return;
  }

  const vault = values.vault ?? loadVaultPath();
  const config = loadResearchConfig();

  let topic;
  try {
    topic = await loadTopic(topicId, vault);
  } catch {
    scaffoldTopic(vault, topicId);
    topic = await loadTopic(topicId, vault);
  }

  // Append (in-memory only) a from-document source to drive this single run.
  const augmented = {
    ...topic,
    sources: [
      ...topic.sources,
      { type: "from-document" as const, path: docPath },
    ],
  };

  const r = await fetchTopic({
    topic: augmented,
    vault,
    config,
    source: "from-document",
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Imported from ${docPath}: +${r.records_added} records, ${r.fetched}/${r.discovered} fetched.\n`,
    );
  }
}

async function runTopic(argv: string[]): Promise<void> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "new":
      return runTopicNew(rest);
    case "list":
      return runTopicList(rest);
    case "show":
      return runTopicShow(rest);
    default:
      console.error("usage: hwicortex research topic <new|list|show> ...");
      process.exitCode = 1;
  }
}

async function runTopicNew(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "from-prompt": { type: "string" },
      vault: { type: "string" },
    },
  });
  const id = positionals[0];
  if (!id) {
    console.error("usage: hwicortex research topic new <id> [--from-prompt \"...\"]");
    process.exitCode = 1;
    return;
  }
  const vault = values.vault ?? loadVaultPath();
  try {
    const path = scaffoldTopic(vault, id, values["from-prompt"]);
    process.stdout.write(`Created ${path}\n`);
  } catch (e: any) {
    console.error(e.message);
    process.exitCode = 2;
  }
}

async function runTopicList(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      vault: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const vault = values.vault ?? loadVaultPath();
  const ids = listTopicIds(vault);
  if (values.json) {
    process.stdout.write(JSON.stringify(ids, null, 2) + "\n");
  } else {
    if (ids.length === 0) process.stdout.write("(no topics)\n");
    else for (const id of ids) process.stdout.write(id + "\n");
  }
}

async function runTopicShow(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const id = positionals[0];
  if (!id) {
    console.error("usage: hwicortex research topic show <id>");
    process.exitCode = 1;
    return;
  }
  const vault = values.vault ?? loadVaultPath();
  try {
    const t = await loadTopic(id, vault);
    process.stdout.write(
      values.json
        ? JSON.stringify(t, null, 2) + "\n"
        : `id: ${t.id}\ntitle: ${t.title}\nsources: ${t.sources.length}\nbudget.max_new_urls: ${t.budget.max_new_urls}\n`,
    );
  } catch (e: any) {
    console.error(e.message);
    process.exitCode = 2;
  }
}

function loadVaultPath(): string {
  const cfg = loadConfigFile();
  const vp = cfg?.vault?.path as string | undefined;
  return expandHome(vp ?? "~/hwicortex-vault");
}

function loadResearchConfig(): ResearchConfig {
  const cfg = loadConfigFile();
  const r = (cfg?.research ?? {}) as Record<string, any>;
  return {
    fetch: {
      user_agent: r.fetch?.user_agent ?? "hwicortex-research/0.1",
      rate_limit_per_domain_qps: r.fetch?.rate_limit_per_domain_qps ?? 1,
      timeout_ms: r.fetch?.timeout_ms ?? 30000,
      max_redirects: r.fetch?.max_redirects ?? 5,
    },
    budget: {
      max_new_urls: r.budget?.max_new_urls ?? 100,
      max_total_bytes: r.budget?.max_total_bytes ?? 50_000_000,
    },
    search: r.search,
  };
}

function loadConfigFile(): Record<string, any> {
  const userCfg = expandHome("~/.config/hwicortex/config.yml");
  try {
    return mergeYaml([readPkgDefault(), readMaybe(userCfg)]);
  } catch {
    return {};
  }
}

function readPkgDefault(): string {
  return readFileSync(
    new URL("../../config/default.yml", import.meta.url),
    "utf-8",
  );
}

function readMaybe(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function mergeYaml(layers: (string | null)[]): Record<string, any> {
  let out: Record<string, any> = {};
  for (const layer of layers) {
    if (!layer) continue;
    out = deepMerge(out, parseYaml(interpolateEnv(layer)) ?? {});
  }
  return out;
}

function interpolateEnv(s: string): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? "");
}

function deepMerge(a: any, b: any): any {
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    !a ||
    !b ||
    Array.isArray(a) ||
    Array.isArray(b)
  ) {
    return b ?? a;
  }
  const out: Record<string, any> = { ...a };
  for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
  return out;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, process.env.HOME ?? "~") : p;
}
