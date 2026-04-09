import { parse as parseYaml } from "yaml";
import { readFileSync } from "fs";

export interface HwiCortexConfig {
  vault: { path: string };
  sessions: { watch_dirs: string[]; idle_timeout_minutes: number };
  llm: {
    default: "claude" | "local";
    claude: { api_key: string; model: string };
    local: { model_path: string };
    budget: { max_tokens_per_run: number; warn_threshold: number };
  };
  ingest: {
    collections: Array<{ name: string; path: string; pattern: string }>;
  };
}

/**
 * Load and validate a HwiCortex YAML config file.
 * Substitutes ${ENV_VAR} patterns with process.env values.
 * Optionally deep-merges a user config on top of defaults.
 */
export function loadConfig(
  defaultPath: string,
  userPath?: string,
): HwiCortexConfig {
  const base = loadAndParse(defaultPath);

  let merged = base;
  if (userPath) {
    const user = loadAndParse(userPath);
    merged = deepMerge(base, user);
  }

  validate(merged);

  return merged as unknown as HwiCortexConfig;
}

function loadAndParse(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, "utf-8");
  const substituted = substituteEnvVars(raw);
  return parseYaml(substituted) as Record<string, unknown>;
}

/**
 * Replace ${ENV_VAR} patterns with their values from process.env.
 * Unset variables become empty strings.
 */
function substituteEnvVars(content: string): string {
  return content.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    const value = process.env[varName] ?? "";
    // Wrap in quotes so YAML doesn't parse empty string as null
    return `"${value}"`;
  });
}

/**
 * Validate that required fields exist in the config.
 */
function validate(config: Record<string, unknown>): void {
  const missing: string[] = [];

  const vault = config["vault"] as Record<string, unknown> | undefined;
  if (!vault?.["path"]) {
    missing.push("vault.path");
  }

  const llm = config["llm"] as Record<string, unknown> | undefined;
  if (!llm?.["default"]) {
    missing.push("llm.default");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required config fields: ${missing.join(", ")}`);
  }
}

/**
 * Deep merge source into target. Arrays are replaced, not concatenated.
 * Returns a new object; does not mutate inputs.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (
      isPlainObject(targetVal) &&
      isPlainObject(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
