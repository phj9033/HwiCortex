import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

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

describe("qmd wiki end-to-end", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "wiki-e2e-"));
  });

  afterEach(() => {
    if (vaultDir && existsSync(vaultDir)) rmSync(vaultDir, { recursive: true });
  });

  test("full workflow: create → update → link → index → show → rm", () => {
    // Create two pages
    qmd('wiki create "JWT 인증" --project demo --tags auth --body "토큰 관리"', vaultDir);
    qmd('wiki create "세션 관리" --project demo --tags auth --body "세션 스토어"', vaultDir);

    // Update
    qmd('wiki update "JWT 인증" --project demo --append "리프레시 7일"', vaultDir);

    // Link
    qmd('wiki link "JWT 인증" "세션 관리" --project demo', vaultDir);

    // Verify link
    const links = qmd('wiki links "JWT 인증" --project demo', vaultDir);
    expect(links).toContain("세션 관리");

    // Show updated content
    const content = qmd('wiki show "JWT 인증" --project demo', vaultDir);
    expect(content).toContain("토큰 관리");
    expect(content).toContain("리프레시 7일");

    // Generate index
    qmd("wiki index --project demo", vaultDir);
    const indexPath = join(vaultDir, "wiki", "demo", "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, "utf-8");
    expect(index).toContain("[[JWT 인증]]");
    expect(index).toContain("[[세션 관리]]");

    // List
    const list = qmd("wiki list --project demo", vaultDir);
    expect(list).toContain("JWT 인증");
    expect(list).toContain("세션 관리");

    // Remove
    qmd('wiki rm "세션 관리" --project demo', vaultDir);
    const listAfter = qmd("wiki list --project demo", vaultDir);
    expect(listAfter).not.toContain("세션 관리");
  });
});
