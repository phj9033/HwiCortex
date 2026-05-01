import { parseArgs } from "util";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { fetchTopic } from "../research/pipeline/fetch.js";
import { synthesize } from "../research/pipeline/synthesize.js";
import { draft, defaultDraftDbPath } from "../research/pipeline/draft.js";
import type { DraftStyle } from "../research/llm/draft.js";
import { loadTopic, adhocTopicFromPrompt } from "../research/topic/loader.js";
import { scaffoldTopic, listTopicIds } from "../research/topic/scaffold.js";
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
    case "synthesize":
      await runSynthesize(rest);
      return;
    case "draft":
      await runDraft(rest);
      return;
    case "topic":
      await runTopic(rest);
      return;
    default:
      console.error(
        "usage: hwicortex research <fetch|synthesize|draft|topic|import|status> ...",
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
      "no-cards": { type: "boolean", default: false },
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
    cardsEnabled: !values["no-cards"],
    source,
    dryRun: values["dry-run"],
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Fetched ${r.fetched}/${r.discovered} (skipped ${r.skipped}, errored ${r.errored}); +${r.records_added} records.\n` +
        `Cost: $${r.budget.cost_usd_total.toFixed(4)}\n`,
    );
  }
}

async function runSynthesize(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      subtopic: { type: "string" },
      refresh: { type: "boolean", default: false },
      model: { type: "string" },
      vault: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const target = positionals[0];
  if (!target) {
    console.error("usage: hwicortex research synthesize <topic-id|prompt>");
    process.exitCode = 1;
    return;
  }

  const vault = values.vault ?? loadVaultPath();
  const config = loadResearchConfig();
  const synthModel = values.model ?? config.models.synth;

  let topic;
  try {
    topic = await loadTopic(target, vault);
  } catch {
    topic = adhocTopicFromPrompt(target);
  }

  const r = await synthesize({
    topic,
    vault,
    config: { models: { synth: synthModel } },
    subtopic: values.subtopic,
    refresh: values.refresh,
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Wrote ${r.notes_written.length} synthesis note(s).\n` +
        `Cost: $${r.cost_usd.toFixed(4)}\n`,
    );
  }
}

async function runDraft(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      prompt: { type: "string" },
      slug: { type: "string" },
      "top-k": { type: "string" },
      "include-vault": { type: "boolean", default: false },
      style: { type: "string" },
      model: { type: "string" },
      "require-context": { type: "boolean", default: false },
      vault: { type: "string" },
      "db-path": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const target = positionals[0];
  if (!target) {
    console.error("usage: hwicortex research draft <topic-id|prompt> --prompt <text>");
    process.exitCode = 1;
    return;
  }
  if (!values.prompt) {
    console.error("--prompt is required");
    process.exitCode = 2;
    return;
  }

  const styleVal = values.style as string | undefined;
  if (styleVal && !["blog", "report", "qa"].includes(styleVal)) {
    console.error("--style must be one of: blog, report, qa");
    process.exitCode = 2;
    return;
  }

  const vault = values.vault ?? loadVaultPath();
  const config = loadResearchConfig();
  const draftModel = values.model ?? config.models.draft;

  let topic;
  try {
    topic = await loadTopic(target, vault);
  } catch {
    topic = adhocTopicFromPrompt(target);
  }

  const r = await draft({
    topic,
    vault,
    prompt: values.prompt,
    slug: values.slug,
    topK: values["top-k"] ? Number(values["top-k"]) : undefined,
    includeVault: values["include-vault"],
    style: styleVal as DraftStyle | undefined,
    model: draftModel,
    dbPath: values["db-path"] ?? defaultDraftDbPath(vault, topic.id),
    requireContext: values["require-context"],
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Wrote ${r.path}\n` +
        `Cited: ${r.cited.length} source(s)\n` +
        `Cost: $${r.cost_usd.toFixed(4)}\n`,
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
      max_llm_cost_usd: r.budget?.max_llm_cost_usd ?? 0.5,
    },
    search: r.search,
    models: {
      card: r.models?.card ?? "claude-haiku-4-5",
      synth: r.models?.synth ?? "claude-sonnet-4-6",
      draft: r.models?.draft ?? "claude-sonnet-4-6",
    },
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
