import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PROJECT_DIR = "/Users/ad03159868/Downloads/Claude_lab/hwicortex";

function qmd(args: string, vaultDir: string): string {
  return execSync(
    `bun src/cli/qmd.ts ${args}`,
    {
      cwd: PROJECT_DIR,
      env: { ...process.env, QMD_VAULT_DIR: vaultDir },
      encoding: "utf-8",
      timeout: 10000,
    }
  ).trim();
}

describe("qmd wiki CLI", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-cli-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("create + show round-trip", () => {
    qmd('wiki create "CLI 테스트" --project test --body "hello"', vaultDir);
    const out = qmd('wiki show "CLI 테스트" --project test', vaultDir);
    expect(out).toContain("hello");
  });

  test("list shows created pages", () => {
    qmd('wiki create "Page A" --project p --tags x', vaultDir);
    qmd('wiki create "Page B" --project p --tags y', vaultDir);
    const out = qmd("wiki list --project p", vaultDir);
    expect(out).toContain("Page A");
    expect(out).toContain("Page B");
  });

  test("update appends text", () => {
    qmd('wiki create "Upd" --project p --body "first"', vaultDir);
    qmd('wiki update "Upd" --project p --append "second"', vaultDir);
    const out = qmd('wiki show "Upd" --project p', vaultDir);
    expect(out).toContain("first");
    expect(out).toContain("second");
  });

  test("rm deletes page", () => {
    qmd('wiki create "Del" --project p', vaultDir);
    qmd('wiki rm "Del" --project p', vaultDir);
    expect(() => qmd('wiki show "Del" --project p', vaultDir)).toThrow();
  });
});
