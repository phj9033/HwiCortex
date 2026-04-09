import { readFile } from "fs/promises";
import path from "path";
import type { SessionParser, ParsedSession, ParsedMessage } from "./types.js";

interface CodexEntry {
  timestamp?: string;
  type: string;
  payload?: Record<string, unknown>;
}

interface CodexSessionMeta {
  id: string;
  timestamp: string;
  cwd: string;
  originator?: string;
  cli_version?: string;
  source?: string;
  model_provider?: string;
  git?: {
    commit_hash?: string;
    branch?: string;
    repository_url?: string;
  };
}

interface CodexContentBlock {
  type: string;
  text?: string;
}

interface CodexResponsePayload {
  type: string;
  role?: string;
  content?: CodexContentBlock[];
  phase?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: string;
}

const VALID_CODEX_TYPES = [
  "session_meta",
  "event_msg",
  "response_item",
  "turn_context",
];

export class CodexSessionParser implements SessionParser {
  readonly name = "codex-cli";
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
    let hasSessionMeta = false;

    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]!);
      } catch {
        errors.push(`Line ${i + 1}: invalid JSON`);
        continue;
      }

      const entry = parsed as Record<string, unknown>;
      if (!entry.type || typeof entry.type !== "string") {
        errors.push(`Line ${i + 1}: missing or invalid 'type' field`);
        continue;
      }

      if (!VALID_CODEX_TYPES.includes(entry.type)) {
        errors.push(`Line ${i + 1}: unknown type '${entry.type}'`);
        continue;
      }

      if (entry.type === "session_meta") {
        hasSessionMeta = true;
        const payload = entry.payload as Record<string, unknown> | undefined;
        if (!payload?.id) {
          errors.push(`Line ${i + 1}: session_meta missing 'payload.id'`);
          continue;
        }
      }

      hasValidEntry = true;
    }

    if (!hasSessionMeta) {
      errors.push("No session_meta entry found — not a Codex CLI session");
    }

    return {
      valid: hasValidEntry && hasSessionMeta && errors.length === 0,
      errors,
    };
  }

  async parse(filePath: string): Promise<ParsedSession> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const entries: CodexEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as CodexEntry);
      } catch {
        // Skip corrupted lines
      }
    }

    const messages: ParsedMessage[] = [];
    const timestamps: string[] = [];
    let sessionId = "";
    let project = "";

    for (const entry of entries) {
      if (entry.timestamp) {
        timestamps.push(entry.timestamp);
      }

      if (entry.type === "session_meta") {
        const meta = entry.payload as unknown as CodexSessionMeta;
        if (meta?.id) {
          sessionId = meta.id;
        }
        if (meta?.cwd) {
          project = path.basename(meta.cwd);
        }
        continue;
      }

      if (entry.type === "event_msg") {
        this.processEventMsg(entry, messages);
        continue;
      }

      if (entry.type === "response_item") {
        this.processResponseItem(entry, messages);
        continue;
      }
    }

    // Fallback: derive sessionId from filename if not found in meta
    if (!sessionId) {
      sessionId = path.basename(filePath, ".jsonl");
    }
    if (!project) {
      project = path.basename(path.dirname(filePath));
    }

    timestamps.sort();
    const startTime = timestamps[0] ?? new Date().toISOString();
    const endTime = timestamps[timestamps.length - 1] ?? startTime;

    return {
      sessionId,
      project,
      startTime,
      endTime,
      parserVersion: this.parserVersion,
      messages,
    };
  }

  private processEventMsg(
    entry: CodexEntry,
    messages: ParsedMessage[],
  ): void {
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const eventType = payload.type as string | undefined;

    if (eventType === "exec_command_end") {
      const cmd = payload.command as string[] | undefined;
      const stdout = (payload.stdout as string) ?? "";
      const stderr = (payload.stderr as string) ?? "";
      const exitCode = payload.exit_code as number | undefined;
      const cmdStr = cmd?.join(" ") ?? "unknown command";
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      messages.push({
        role: "tool",
        content: `<details>\n<summary>exec_command: ${cmdStr}</summary>\n\n${output}\nexit_code: ${exitCode ?? "unknown"}\n</details>`,
        timestamp: entry.timestamp,
      });
    }
  }

  private processResponseItem(
    entry: CodexEntry,
    messages: ParsedMessage[],
  ): void {
    const payload = entry.payload as CodexResponsePayload | undefined;
    if (!payload) return;

    // Handle function_call (tool invocation)
    if (payload.type === "function_call") {
      const name = payload.name ?? "unknown";
      const args = payload.arguments ?? "";
      let parsedArgs: string;
      try {
        parsedArgs = JSON.stringify(JSON.parse(args), null, 2);
      } catch {
        parsedArgs = args;
      }

      messages.push({
        role: "tool",
        content: `<details>\n<summary>${name}</summary>\n\n${parsedArgs}\n</details>`,
        timestamp: entry.timestamp,
      });
      return;
    }

    // Handle function_call_output (tool result)
    if (payload.type === "function_call_output") {
      const output = (payload.output as string) ?? "";
      const callId = payload.call_id ?? "unknown";
      messages.push({
        role: "tool",
        content: `<details>\n<summary>result:${callId}</summary>\n\n${output}\n</details>`,
        timestamp: entry.timestamp,
      });
      return;
    }

    // Skip reasoning entries
    if (payload.type === "reasoning") {
      return;
    }

    // Handle message entries
    if (payload.type === "message" && payload.role && payload.content) {
      const role = payload.role;

      // Skip developer/system messages
      if (role === "developer" || role === "system") {
        return;
      }

      const textParts: string[] = [];
      for (const block of payload.content) {
        if (
          (block.type === "output_text" || block.type === "input_text") &&
          block.text
        ) {
          textParts.push(block.text);
        }
      }

      const text = textParts.join("\n").trim();
      if (!text) return;

      if (role === "user") {
        messages.push({
          role: "user",
          content: text,
          timestamp: entry.timestamp,
        });
      } else if (role === "assistant") {
        messages.push({
          role: "assistant",
          content: text,
          timestamp: entry.timestamp,
        });
      }
    }
  }
}
