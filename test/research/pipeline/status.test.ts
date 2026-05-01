import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { computeStatus } from "../../../src/research/pipeline/status.js";

function setupVault() {
  const v = mkdtempSync(join(tmpdir(), "v-"));
  mkdirSync(join(v, "research", "_staging", "t1"), { recursive: true });
  mkdirSync(join(v, "research", "notes", "t1", "sources"), { recursive: true });
  mkdirSync(join(v, "research", "drafts", "t1"), { recursive: true });
  return v;
}

describe("computeStatus", () => {
  it("counts raw, cards, synthesis notes (shallow), drafts; aggregates cost", () => {
    const v = setupVault();
    try {
      // raw.jsonl with 3 records
      writeFileSync(
        join(v, "research", "_staging", "t1", "raw.jsonl"),
        ["a", "b", "c"].map(x => JSON.stringify({ id: x })).join("\n") + "\n",
      );
      // 2 cards
      writeFileSync(join(v, "research", "notes", "t1", "sources", "abcdef012345.md"), "x");
      writeFileSync(join(v, "research", "notes", "t1", "sources", "112233445566.md"), "x");
      // 1 synthesis note (shallow only)
      writeFileSync(join(v, "research", "notes", "t1", "overview.md"), "x");
      mkdirSync(join(v, "research", "notes", "t1", "ignored"), { recursive: true });
      writeFileSync(join(v, "research", "notes", "t1", "ignored", "deep.md"), "x");
      // 1 draft
      writeFileSync(join(v, "research", "drafts", "t1", "2026-04-30-x.md"), "x");
      // run-log with cost events
      writeFileSync(
        join(v, "research", "_staging", "t1", "run-log.jsonl"),
        [
          JSON.stringify({ ts: "2026-04-30T00:00:01Z", kind: "fetch_ok", url: "u", bytes: 1 }),
          JSON.stringify({ ts: "2026-04-30T00:00:02Z", kind: "synth_ok", subtopic: "x", cost_usd: 0.01 }),
          JSON.stringify({ ts: "2026-04-30T00:00:03Z", kind: "draft_ok", slug: "y", cost_usd: 0.02 }),
        ].join("\n") + "\n",
      );

      const s = computeStatus(v, "t1");
      expect(s.raw_records).toBe(3);
      expect(s.cards).toBe(2);
      expect(s.synthesis_notes).toBe(1);
      expect(s.drafts).toBe(1);
      expect(s.cost_usd).toBeCloseTo(0.03, 6);
      expect(s.last_event_ts).toBe("2026-04-30T00:00:03Z");
      expect(s.recent_events.length).toBe(3);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("returns zeros when nothing has been generated yet", () => {
    const v = mkdtempSync(join(tmpdir(), "v-"));
    try {
      const s = computeStatus(v, "untouched");
      expect(s.raw_records).toBe(0);
      expect(s.cards).toBe(0);
      expect(s.synthesis_notes).toBe(0);
      expect(s.drafts).toBe(0);
      expect(s.cost_usd).toBe(0);
      expect(s.last_event_ts).toBeNull();
      expect(s.recent_events).toEqual([]);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });

  it("skips malformed run-log lines without throwing", () => {
    const v = setupVault();
    try {
      writeFileSync(
        join(v, "research", "_staging", "t1", "run-log.jsonl"),
        "not json\n" + JSON.stringify({ ts: "2026-04-30T00:00:00Z", cost_usd: 0.5 }) + "\n",
      );
      const s = computeStatus(v, "t1");
      expect(s.cost_usd).toBe(0.5);
      expect(s.recent_events.length).toBe(1);
    } finally {
      rmSync(v, { recursive: true, force: true });
    }
  });
});
