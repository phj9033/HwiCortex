import { describe, it, expect } from "bun:test";
import { sessionToMarkdown } from "../../src/ingest/session-to-markdown";
import type { ParsedSession } from "../../src/ingest/session-parser/types";

describe("sessionToMarkdown", () => {
  const sampleSession: ParsedSession = {
    sessionId: "abc123",
    project: "my-project",
    startTime: "2026-04-06T10:00:00Z",
    endTime: "2026-04-06T11:00:00Z",
    parserVersion: "1.0.0",
    messages: [
      { role: "user", content: "Hello, help me with..." },
      { role: "assistant", content: "Sure! Here's what I found..." },
      {
        role: "tool",
        content:
          "<details>\n<summary>read_file</summary>\n\nfile contents here\n</details>",
      },
      { role: "user", content: "Thanks, now..." },
    ],
  };

  it("should generate markdown with frontmatter", () => {
    const md = sessionToMarkdown(sampleSession);

    // Should start and end frontmatter with ---
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("session_id: abc123");
    expect(md).toContain("project: my-project");
    expect(md).toContain("start_time: 2026-04-06T10:00:00Z");
    expect(md).toContain("end_time: 2026-04-06T11:00:00Z");
    expect(md).toContain('parser_version: "1.0.0"');
    // Frontmatter closes
    expect(md).toMatch(/---\n\n###/);
  });

  it("should format tool messages as collapsed details", () => {
    const md = sessionToMarkdown(sampleSession);

    expect(md).toContain("### Tool");
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>read_file</summary>");
    expect(md).toContain("file contents here");
    expect(md).toContain("</details>");
  });

  it("should separate user and assistant messages clearly", () => {
    const md = sessionToMarkdown(sampleSession);

    const lines = md.split("\n");
    const headings = lines.filter((l) => l.startsWith("### "));

    expect(headings).toEqual([
      "### User",
      "### Assistant",
      "### Tool",
      "### User",
    ]);

    expect(md).toContain("### User\nHello, help me with...");
    expect(md).toContain("### Assistant\nSure! Here's what I found...");
    expect(md).toContain("### User\nThanks, now...");
  });

  it("should handle empty session", () => {
    const emptySession: ParsedSession = {
      sessionId: "empty-001",
      project: "test",
      startTime: "2026-04-06T10:00:00Z",
      endTime: "2026-04-06T10:00:00Z",
      parserVersion: "1.0.0",
      messages: [],
    };

    const md = sessionToMarkdown(emptySession);

    // Should still have frontmatter
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("session_id: empty-001");
    // No message headings
    expect(md).not.toContain("### User");
    expect(md).not.toContain("### Assistant");
    expect(md).not.toContain("### Tool");
  });
});
