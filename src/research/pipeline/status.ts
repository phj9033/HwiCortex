import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { stagingDir, sourcesDir, notesDir, draftsDir } from "../topic/paths.js";

export type StatusEvent = Record<string, unknown> & { ts?: string; cost_usd?: number };

export type TopicStatus = {
  topic_id: string;
  raw_records: number;
  cards: number;
  synthesis_notes: number;
  drafts: number;
  cost_usd: number;
  last_event_ts: string | null;
  recent_events: StatusEvent[];
};

export function computeStatus(vault: string, topicId: string): TopicStatus {
  const raw = countLines(join(stagingDir(vault, topicId), "raw.jsonl"));
  const cards = countMd(sourcesDir(vault, topicId));
  const notes = countMdShallow(notesDir(vault, topicId));
  const drafts = countMd(draftsDir(vault, topicId));

  const log = join(stagingDir(vault, topicId), "run-log.jsonl");
  const events: StatusEvent[] = existsSync(log)
    ? readFileSync(log, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map(safeJson)
        .filter((x): x is StatusEvent => x !== null)
    : [];
  const cost_usd = events
    .filter(e => typeof e.cost_usd === "number")
    .reduce((s, e) => s + (e.cost_usd as number), 0);

  return {
    topic_id: topicId,
    raw_records: raw,
    cards,
    synthesis_notes: notes,
    drafts,
    cost_usd,
    last_event_ts:
      events.length && typeof events[events.length - 1]?.ts === "string"
        ? (events[events.length - 1]!.ts as string)
        : null,
    recent_events: events.slice(-10),
  };
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf-8").split("\n").filter(Boolean).length;
}

function countMd(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith(".md")).length;
}

function countMdShallow(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith(".md")).length;
}

function safeJson(s: string): StatusEvent | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
