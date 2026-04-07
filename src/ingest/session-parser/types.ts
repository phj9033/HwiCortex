export interface ParsedMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp?: string;
}

export interface ParsedSession {
  sessionId: string;
  project: string;
  startTime: string;
  endTime: string;
  parserVersion: string;
  messages: ParsedMessage[];
}

export interface SessionParser {
  readonly name: string;
  readonly parserVersion: string;
  canParse(filePath: string): boolean;
  parse(filePath: string): Promise<ParsedSession>;
  validateSchema(
    filePath: string,
  ): Promise<{ valid: boolean; errors: string[] }>;
}
