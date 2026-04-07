import { readFile } from "fs/promises";
import path from "path";
import type { SessionParser, ParsedSession, ParsedMessage } from "./types";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ClaudeContentBlock[];
}

interface ClaudeMessage {
  role: string;
  content: string | ClaudeContentBlock[];
}

interface ClaudeEntry {
  type: string;
  message?: ClaudeMessage;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  toolUseResult?: unknown;
  parentUuid?: string | null;
  isSidechain?: boolean;
}

export class ClaudeSessionParser implements SessionParser {
  readonly name = "claude-code";
  readonly parserVersion = "1.0.0";

  canParse(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === ".jsonl";
  }

  async validateSchema(
    filePath: string,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return { valid: false, errors: [`Cannot read file: ${filePath}`] };
    }

    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      return { valid: false, errors: ["File is empty"] };
    }

    let hasValidEntry = false;

    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        errors.push(`Line ${i + 1}: invalid JSON`);
        continue;
      }

      const entry = parsed as Record<string, unknown>;
      if (!entry.type || typeof entry.type !== "string") {
        errors.push(`Line ${i + 1}: missing or invalid 'type' field`);
        continue;
      }

      const validTypes = [
        "user",
        "assistant",
        "progress",
        "queue-operation",
        "summary",
      ];
      if (!validTypes.includes(entry.type)) {
        errors.push(
          `Line ${i + 1}: unknown type '${entry.type}'`,
        );
        continue;
      }

      if (
        (entry.type === "user" || entry.type === "assistant") &&
        !entry.message
      ) {
        errors.push(`Line ${i + 1}: type '${entry.type}' missing 'message' field`);
        continue;
      }

      hasValidEntry = true;
    }

    if (!hasValidEntry) {
      errors.push("No valid Claude session entries found");
    }

    return {
      valid: hasValidEntry && errors.length === 0,
      errors,
    };
  }

  async parse(filePath: string): Promise<ParsedSession> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const entries: ClaudeEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as ClaudeEntry);
      } catch {
        // Skip corrupted lines
      }
    }

    const messages: ParsedMessage[] = [];
    const timestamps: string[] = [];

    for (const entry of entries) {
      if (entry.timestamp) {
        timestamps.push(entry.timestamp);
      }

      if (entry.type === "user" && entry.message) {
        if (entry.toolUseResult || this.isToolResult(entry.message)) {
          // Collapse tool_result into tool role
          const toolContent = this.extractToolResultContent(entry.message);
          messages.push({
            role: "tool",
            content: toolContent,
            timestamp: entry.timestamp,
          });
        } else {
          const textContent = this.extractTextContent(entry.message);
          if (textContent) {
            messages.push({
              role: "user",
              content: textContent,
              timestamp: entry.timestamp,
            });
          }
        }
      } else if (entry.type === "assistant" && entry.message) {
        const contentBlocks = this.getContentBlocks(entry.message);
        const textParts: string[] = [];
        const toolUses: { name: string; input: unknown }[] = [];

        for (const block of contentBlocks) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolUses.push({
              name: block.name ?? "unknown",
              input: block.input,
            });
          }
        }

        if (toolUses.length > 0) {
          // Collapse tool_use into tool role
          for (const tool of toolUses) {
            const inputStr =
              typeof tool.input === "string"
                ? tool.input
                : JSON.stringify(tool.input, null, 2);
            messages.push({
              role: "tool",
              content: `<details>\n<summary>${tool.name}</summary>\n\n${inputStr}\n</details>`,
              timestamp: entry.timestamp,
            });
          }
        }

        const text = textParts.join("").trim();
        if (text) {
          messages.push({
            role: "assistant",
            content: text,
            timestamp: entry.timestamp,
          });
        }
      }
    }

    timestamps.sort();
    const startTime = timestamps[0] ?? new Date().toISOString();
    const endTime = timestamps[timestamps.length - 1] ?? startTime;

    const sessionId = path.basename(filePath, ".jsonl");
    const project = path.basename(path.dirname(filePath));

    return {
      sessionId,
      project,
      startTime,
      endTime,
      parserVersion: this.parserVersion,
      messages,
    };
  }

  private isToolResult(message: ClaudeMessage): boolean {
    if (typeof message.content === "string") return false;
    if (!Array.isArray(message.content)) return false;
    return message.content.some(
      (block) => block.type === "tool_result",
    );
  }

  private extractToolResultContent(message: ClaudeMessage): string {
    if (typeof message.content === "string") {
      return `<details>\n<summary>tool_result</summary>\n\n${message.content}\n</details>`;
    }

    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === "tool_result") {
        const toolId = block.tool_use_id ?? "unknown";
        let resultContent = "";
        if (typeof block.content === "string") {
          resultContent = block.content;
        } else if (Array.isArray(block.content)) {
          resultContent = block.content
            .map((c) => c.text ?? JSON.stringify(c))
            .join("\n");
        }
        parts.push(
          `<details>\n<summary>result:${toolId}</summary>\n\n${resultContent}\n</details>`,
        );
      }
    }

    return parts.join("\n") || "<details>\n<summary>tool_result</summary>\n\n(empty)\n</details>";
  }

  private extractTextContent(message: ClaudeMessage): string {
    if (typeof message.content === "string") {
      return message.content;
    }
    if (!Array.isArray(message.content)) return "";

    return message.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("\n");
  }

  private getContentBlocks(message: ClaudeMessage): ClaudeContentBlock[] {
    if (typeof message.content === "string") {
      return [{ type: "text", text: message.content }];
    }
    if (Array.isArray(message.content)) {
      return message.content;
    }
    return [];
  }
}
