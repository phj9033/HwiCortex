import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RunLog } from "../../../src/research/store/log.js";

let vaults: string[] = [];
afterEach(() => {
  for (const v of vaults) rmSync(v, { recursive: true, force: true });
  vaults = [];
});

function makeVault(): string {
  const v = mkdtempSync(join(tmpdir(), "v-"));
  vaults.push(v);
  return v;
}

describe("RunLog", () => {
  it("appends JSONL entries", () => {
    const v = makeVault();
    const log = new RunLog(v, "t1");
    log.emit({ kind: "fetch_ok", url: "https://e.com/a", bytes: 10 });
    const txt = readFileSync(
      join(v, "research", "_staging", "t1", "run-log.jsonl"),
      "utf-8",
    );
    expect(txt).toContain("fetch_ok");
  });

  it("appends timestamps and parses to one event per line", () => {
    const v = makeVault();
    const log = new RunLog(v, "t1");
    log.emit({ kind: "fetch_ok", url: "https://e.com/a", bytes: 10 });
    log.emit({ kind: "budget_halt", reason: "max_total_bytes" });

    const path = join(v, "research", "_staging", "t1", "run-log.jsonl");
    const lines = readFileSync(path, "utf-8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    expect(a.kind).toBe("fetch_ok");
    expect(a.url).toBe("https://e.com/a");
    expect(typeof a.ts).toBe("string");
    expect(b.kind).toBe("budget_halt");
    expect(b.reason).toBe("max_total_bytes");
  });
});
