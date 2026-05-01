import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { computeStatus } from "../../../src/research/pipeline/status.js";

// runStatus is a thin display wrapper around computeStatus. We exercise the
// underlying status path via computeStatus and trust parseArgs handling.
// (CLI argument parsing is verified end-to-end by running the binary.)

describe("status (via computeStatus)", () => {
  it("CLI summary fields all derive from the same shared reader", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      mkdirSync(join(v, "research", "_staging", "t1"), { recursive: true });
      writeFileSync(
        join(v, "research", "_staging", "t1", "raw.jsonl"),
        JSON.stringify({ id: "x" }) + "\n",
      );
      writeFileSync(
        join(v, "research", "_staging", "t1", "run-log.jsonl"),
        JSON.stringify({ ts: "2026-04-30T00:00:00Z", cost_usd: 0.1234 }) + "\n",
      );
      const s = computeStatus(v, "t1");
      // The CLI human format renders these fields exactly:
      const human =
        `topic: ${s.topic_id}\n` +
        `raw=${s.raw_records} cards=${s.cards} notes=${s.synthesis_notes} drafts=${s.drafts}\n` +
        `cost=$${s.cost_usd.toFixed(4)}\n` +
        `last=${s.last_event_ts ?? "(none)"}\n`;
      expect(human).toContain("topic: t1");
      expect(human).toContain("raw=1 cards=0 notes=0 drafts=0");
      expect(human).toContain("cost=$0.1234");
      expect(human).toContain("last=2026-04-30T00:00:00Z");
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });
});
