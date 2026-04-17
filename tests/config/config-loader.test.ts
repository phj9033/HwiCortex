import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config/config-loader.js";

describe("ConfigLoader", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv["ANTHROPIC_API_KEY"] = process.env["ANTHROPIC_API_KEY"];
  });

  afterEach(() => {
    if (savedEnv["ANTHROPIC_API_KEY"] === undefined) {
      delete process.env["ANTHROPIC_API_KEY"];
    } else {
      process.env["ANTHROPIC_API_KEY"] = savedEnv["ANTHROPIC_API_KEY"];
    }
  });

  it("should load YAML config file", () => {
    const config = loadConfig("config/default.yml");
    expect(config.vault.path).toBeDefined();
    expect(config.llm.default).toBe("claude");
  });

  it("should substitute environment variables", () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    const config = loadConfig("config/default.yml");
    expect(config.llm.claude.api_key).toBe("test-key");
  });

  it("should leave unset env vars as empty string", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const config = loadConfig("config/default.yml");
    expect(config.llm.claude.api_key).toBe("");
  });

  it("should throw on missing required fields", () => {
    expect(() => loadConfig("tests/fixtures/invalid-config.yml")).toThrow(
      /Missing required config/
    );
  });

  it("should throw on non-existent file", () => {
    expect(() => loadConfig("does-not-exist.yml")).toThrow();
  });

  it("should merge user config with defaults", () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    const config = loadConfig("config/default.yml", "tests/fixtures/user-config.yml");
    // user config overrides
    expect(config.vault.path).toBe("~/my-custom-vault");
    expect(config.llm.default).toBe("local");
    expect(config.sessions.idle_timeout_minutes).toBe(30);
    expect(config.llm.budget.max_tokens_per_run).toBe(200000);
    // defaults are preserved where user config doesn't override
    expect(config.sessions.watch_dirs).toEqual(["~/.claude/projects", "~/.codex/sessions"]);
    expect(config.llm.claude.api_key).toBe("test-key");
    expect(config.llm.budget.warn_threshold).toBe(100000);
  });
});
