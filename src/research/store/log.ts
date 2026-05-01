import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { stagingDir } from "../topic/paths.js";

export type LogEvent =
  | { kind: "fetch_ok"; url: string; bytes: number }
  | { kind: "fetch_skip"; url: string; reason: string }
  | { kind: "fetch_error"; url: string; code: string; detail?: string }
  | { kind: "card_skip"; source_id: string; reason: string }
  | { kind: "card_ok"; source_id: string }
  | { kind: "budget_halt"; reason: string }
  | { kind: "synth_ok"; subtopic: string; cost_usd: number }
  | { kind: "draft_ok"; slug: string; cost_usd: number };

export class RunLog {
  private path: string;

  constructor(vault: string, topicId: string) {
    const dir = stagingDir(vault, topicId);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "run-log.jsonl");
  }

  emit(ev: LogEvent): void {
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n";
    appendFileSync(this.path, line);
  }
}
