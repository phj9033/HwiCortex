import { describe, it, expect } from "bun:test";
import { CodexSessionParser } from "../../src/ingest/session-parser/codex";
import path from "path";

const FIXTURES = path.resolve(__dirname, "../fixtures/sessions");

describe("CodexSessionParser", () => {
  const parser = new CodexSessionParser();

  it("should identify Codex CLI JSONL files", () => {
    expect(parser.canParse("session.jsonl")).toBe(true);
    expect(parser.canParse("/some/path/rollout-2026-04-07.jsonl")).toBe(true);
    expect(parser.canParse("session.json")).toBe(false);
    expect(parser.canParse("session.txt")).toBe(false);
    expect(parser.canParse("notes.md")).toBe(false);
  });

  it("should parse session into structured messages", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const session = await parser.parse(filePath);

    expect(session.messages.length).toBeGreaterThan(0);
    const roles = session.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("should collapse tool calls into tool role", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const session = await parser.parse(filePath);

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages.length).toBeGreaterThan(0);

    // Tool messages should contain details blocks
    for (const msg of toolMessages) {
      expect(msg.content).toContain("<details>");
      expect(msg.content).toContain("</details>");
    }
  });

  it("should extract tool name from function_call entries", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const session = await parser.parse(filePath);

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    // Should have exec_command tool call
    const hasExecCommand = toolMessages.some((m) =>
      m.content.includes("exec_command"),
    );
    expect(hasExecCommand).toBe(true);
  });

  it("should extract session metadata", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
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

  it("should extract sessionId from session_meta payload", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const session = await parser.parse(filePath);

    // Should use the id from session_meta payload
    expect(session.sessionId).toBe(
      "019d656e-7642-7ee2-9f5d-70f08cf364c4",
    );
  });

  it("should extract project from cwd in session_meta", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const session = await parser.parse(filePath);

    expect(session.project).toBe("myproject");
  });

  it("should handle schema validation for valid codex files", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const result = await parser.validateSchema(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should return validation errors for non-codex schema", async () => {
    // The claude-sample.jsonl has a different schema (type: user/assistant instead of session_meta/event_msg/response_item)
    const filePath = path.join(FIXTURES, "claude-sample.jsonl");
    const result = await parser.validateSchema(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should return validation errors for invalid files", async () => {
    const filePath = path.join(FIXTURES, "invalid.jsonl");
    const result = await parser.validateSchema(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should gracefully handle parse failure with error details", async () => {
    const filePath = path.join(FIXTURES, "corrupted.jsonl");
    const session = await parser.parse(filePath);

    // Should still return a session object even with corrupted data
    expect(session.sessionId).toBeTruthy();
    expect(session.parserVersion).toBe("1.0.0");
  });

  it("should filter out developer/system messages from output", async () => {
    const filePath = path.join(FIXTURES, "codex-sample.jsonl");
    const session = await parser.parse(filePath);

    // Developer messages (permissions, instructions) should not appear as user messages
    const hasPermissions = session.messages.some((m) =>
      m.content.includes("permissions instructions"),
    );
    expect(hasPermissions).toBe(false);
  });

  it("should have correct parser metadata", () => {
    expect(parser.name).toBe("codex-cli");
    expect(parser.parserVersion).toBe("1.0.0");
  });
});
