import type { SessionParser, ParsedSession } from "./types";

export class GeminiSessionParser implements SessionParser {
  readonly name = "gemini-cli";
  readonly parserVersion = "0.0.0";

  canParse(filePath: string): boolean {
    return filePath.endsWith(".json") && filePath.includes(".gemini");
  }

  async validateSchema(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: false, errors: ["Gemini CLI parser not yet implemented"] };
  }

  async parse(): Promise<ParsedSession> {
    throw new Error(
      "Gemini CLI parser not yet implemented. Contributions welcome.",
    );
  }
}
