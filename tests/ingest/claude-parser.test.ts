import { describe, it, expect } from "bun:test";
import { ClaudeSessionParser } from "../../src/ingest/session-parser/claude";
import path from "path";

const FIXTURES = path.resolve(__dirname, "../fixtures/sessions");

describe("ClaudeSessionParser", () => {
  const parser = new ClaudeSessionParser();

  it("should identify Claude Code JSONL files", () => {
    expect(parser.canParse("session.jsonl")).toBe(true);
    expect(parser.canParse("/some/path/abc-def.jsonl")).toBe(true);
    expect(parser.canParse("session.json")).toBe(false);
    expect(parser.canParse("session.txt")).toBe(false);
    expect(parser.canParse("notes.md")).toBe(false);
  });

  it("should parse session into structured messages", async () => {
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const session = await parser.parse(filePath);

    expect(session.messages.length).toBeGreaterThan(0);
    // Should have user and assistant messages
    const roles = session.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("should collapse tool_use/tool_result into tool role", async () => {
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const session = await parser.parse(filePath);

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages.length).toBeGreaterThan(0);

    // Tool messages should contain details blocks
    for (const msg of toolMessages) {
      expect(msg.content).toContain("<details>");
      expect(msg.content).toContain("</details>");
    }
  });

  it("should extract session metadata", async () => {
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const session = await parser.parse(filePath);

    expect(session.sessionId).toBeTruthy();
    expect(session.project).toBeTruthy();
    expect(session.startTime).toBeTruthy();
    expect(session.endTime).toBeTruthy();
    expect(session.parserVersion).toBe("1.0.0");

    // startTime should be before or equal to endTime
    expect(new Date(session.startTime).getTime()).toBeLessThanOrEqual(
      new Date(session.endTime).getTime(),
    );
  });

  it("should handle schema validation", async () => {
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const result = await parser.validateSchema(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should return validation errors for unknown schema", async () => {
    const filePath = path.join(FIXTURES, "invalid.jsonl");
    const result = await parser.validateSchema(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should gracefully handle parse failure with error details", async () => {
    const filePath = path.join(FIXTURES, "corrupted.jsonl");
    const session = await parser.parse(filePath);

    // Should still parse the valid lines
    expect(session.messages.length).toBeGreaterThan(0);
    // sessionId should still be extracted
    expect(session.sessionId).toBeTruthy();
  });

  it("should extract sessionId from filename", async () => {
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const session = await parser.parse(filePath);

    // sessionId derived from filename
    expect(session.sessionId).toBe("claude-sample");
  });

  it("should extract project from parent directory", async () => {
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const session = await parser.parse(filePath);

    expect(session.project).toBe("sessions");
  });

  it("should have correct parser metadata", () => {
    expect(parser.name).toBe("claude-code");
    expect(parser.parserVersion).toBe("1.0.0");
  });
});
