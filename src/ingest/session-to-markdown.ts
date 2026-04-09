import type { ParsedSession } from "./session-parser/types.js";

export function sessionToMarkdown(session: ParsedSession): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`session_id: ${session.sessionId}`);
  lines.push(`project: ${session.project}`);
  lines.push(`start_time: ${session.startTime}`);
  lines.push(`end_time: ${session.endTime}`);
  lines.push(`parser_version: "${session.parserVersion}"`);
  lines.push("---");

  // Messages
  for (const msg of session.messages) {
    lines.push("");
    const heading =
      msg.role === "user"
        ? "### User"
        : msg.role === "assistant"
          ? "### Assistant"
          : "### Tool";
    lines.push(heading);
    lines.push(msg.content);
  }

  return lines.join("\n") + "\n";
}
