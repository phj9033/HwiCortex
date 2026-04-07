import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { VaultWriter } from "../../src/knowledge/vault-writer";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("VaultWriter", () => {
  let vaultPath: string;
  let writer: VaultWriter;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-writer-test-"));
    writer = new VaultWriter(vaultPath);
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("should create new knowledge file with structured format", async () => {
    await writer.writeKnowledge({
      title: "팝업 중복 방지",
      project: "bb3-client",
      tags: ["popup", "bugfix"],
      summary: "LLM generated summary",
      keyInsights: [
        {
          date: "2026-04-06",
          sessionId: "abc123",
          content: "isDuplicate 파라미터 사용",
        },
      ],
      sourceSession: "sessions/bb3-client/2026-04-06-abc123.md",
    });

    const filePath = join(vaultPath, "knowledge", "bb3-client", "팝업-중복-방지.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("title: 팝업 중복 방지");
    expect(content).toContain("project: bb3-client");
    expect(content).toContain("tags: [popup, bugfix]");
    expect(content).toContain("- sessions/bb3-client/2026-04-06-abc123.md");
    expect(content).toContain("## 요약");
    expect(content).toContain("LLM generated summary");
    expect(content).toContain("## 인사이트");
    expect(content).toContain("- **2026-04-06** (세션 abc123): isDuplicate 파라미터 사용");
  });

  it("should append to existing knowledge file without overwriting", async () => {
    // Write first knowledge entry
    await writer.writeKnowledge({
      title: "팝업 중복 방지",
      project: "bb3-client",
      tags: ["popup", "bugfix"],
      summary: "First summary",
      keyInsights: [
        {
          date: "2026-04-06",
          sessionId: "abc123",
          content: "isDuplicate 파라미터 사용",
        },
      ],
      sourceSession: "sessions/bb3-client/2026-04-06-abc123.md",
    });

    // Write second knowledge entry to same file
    await writer.writeKnowledge({
      title: "팝업 중복 방지",
      project: "bb3-client",
      tags: ["popup", "bugfix"],
      summary: "Updated summary",
      keyInsights: [
        {
          date: "2026-04-07",
          sessionId: "def456",
          content: "새로운 인사이트 추가",
        },
      ],
      sourceSession: "sessions/bb3-client/2026-04-07-def456.md",
    });

    const filePath = join(vaultPath, "knowledge", "bb3-client", "팝업-중복-방지.md");
    const content = readFileSync(filePath, "utf-8");

    // Original insight preserved
    expect(content).toContain("- **2026-04-06** (세션 abc123): isDuplicate 파라미터 사용");
    // New insight appended
    expect(content).toContain("- **2026-04-07** (세션 def456): 새로운 인사이트 추가");
    // Both sources in frontmatter
    expect(content).toContain("- sessions/bb3-client/2026-04-06-abc123.md");
    expect(content).toContain("- sessions/bb3-client/2026-04-07-def456.md");
  });

  it("should skip if source session already processed", async () => {
    const knowledge = {
      title: "팝업 중복 방지",
      project: "bb3-client",
      tags: ["popup", "bugfix"],
      summary: "Summary",
      keyInsights: [
        {
          date: "2026-04-06",
          sessionId: "abc123",
          content: "isDuplicate 파라미터 사용",
        },
      ],
      sourceSession: "sessions/bb3-client/2026-04-06-abc123.md",
    };

    await writer.writeKnowledge(knowledge);
    await writer.writeKnowledge(knowledge); // duplicate

    const filePath = join(vaultPath, "knowledge", "bb3-client", "팝업-중복-방지.md");
    const content = readFileSync(filePath, "utf-8");

    // Should only appear once in sources
    const sourceMatches = content.match(/- sessions\/bb3-client\/2026-04-06-abc123\.md/g);
    expect(sourceMatches?.length).toBe(1);

    // Insight should only appear once
    const insightMatches = content.match(/isDuplicate 파라미터 사용/g);
    expect(insightMatches?.length).toBe(1);
  });

  it("should write session markdown to sessions/ folder", async () => {
    const sessionContent = "# Session Log\n\nSome session content here.";
    await writer.writeSession("bb3-client", "2026-04-06-abc123.md", sessionContent);

    const filePath = join(vaultPath, "sessions", "bb3-client", "2026-04-06-abc123.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe(sessionContent);
  });

  it("should use atomic write (temp + rename)", async () => {
    const sessionContent = "# Session";
    await writer.writeSession("bb3-client", "test.md", sessionContent);

    const filePath = join(vaultPath, "sessions", "bb3-client", "test.md");
    expect(existsSync(filePath)).toBe(true);

    // The .tmp file should NOT exist after successful write
    const tmpPath = filePath + ".tmp";
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("should append PDF parse errors to vault/docs/_errors.md", async () => {
    const errorEntry1 = "[2026-04-06 10:00:00] ERROR: Failed to parse document.pdf - corrupted";
    const errorEntry2 = "[2026-04-06 10:05:00] ERROR: Failed to parse other.pdf - timeout";

    await writer.appendError(errorEntry1);
    await writer.appendError(errorEntry2);

    const filePath = join(vaultPath, "docs", "_errors.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain(errorEntry1);
    expect(content).toContain(errorEntry2);
  });
});
