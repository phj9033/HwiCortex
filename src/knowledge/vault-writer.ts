import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { classify } from "./classifier.js";

export interface KnowledgeEntry {
  title: string;
  project: string;
  tags: string[];
  summary: string;
  keyInsights: Array<{ date: string; sessionId: string; content: string }>;
  sourceSession: string;
}

export function atomicWrite(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

export class VaultWriter {
  constructor(private vaultPath: string) {}

  /** Write extracted knowledge to vault/knowledge/{project}/{topic}.md */
  async writeKnowledge(knowledge: KnowledgeEntry): Promise<void> {
    const { folder, fileName } = classify({
      title: knowledge.title,
      project: knowledge.project,
    });

    const filePath = join(this.vaultPath, "knowledge", folder, fileName);
    mkdirSync(dirname(filePath), { recursive: true });

    if (existsSync(filePath)) {
      this.mergeKnowledge(filePath, knowledge);
    } else {
      this.createKnowledge(filePath, knowledge);
    }
  }

  /** Write parsed session markdown to vault/sessions/{project}/{filename} */
  async writeSession(
    project: string,
    filename: string,
    content: string,
  ): Promise<void> {
    const filePath = join(this.vaultPath, "sessions", project, filename);
    atomicWrite(filePath, content);
  }

  /** Append error entry to vault/docs/_errors.md */
  async appendError(errorEntry: string): Promise<void> {
    const filePath = join(this.vaultPath, "docs", "_errors.md");
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, errorEntry + "\n", "utf-8");
  }

  // --- private helpers ---

  private createKnowledge(filePath: string, k: KnowledgeEntry): void {
    const today = new Date().toISOString().slice(0, 10);
    const tagsStr = k.tags.join(", ");
    const insightsLines = k.keyInsights
      .map((i) => `- **${i.date}** (세션 ${i.sessionId}): ${i.content}`)
      .join("\n");

    const content = `---
title: ${k.title}
project: ${k.project}
tags: [${tagsStr}]
created: ${today}
updated: ${today}
sources:
  - ${k.sourceSession}
---

## 요약
${k.summary}

## 인사이트
${insightsLines}
`;

    atomicWrite(filePath, content);
  }

  private mergeKnowledge(filePath: string, k: KnowledgeEntry): void {
    const existing = readFileSync(filePath, "utf-8");

    // Duplicate prevention: skip if sourceSession already in sources
    if (existing.includes(`- ${k.sourceSession}`)) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Update frontmatter: add source and update date
    let updated = existing.replace(
      /^(updated:\s*).+$/m,
      `$1${today}`,
    );

    // Insert new source before the closing ---
    // Find the sources block end (the line with just ---)
    updated = updated.replace(
      /^(sources:\n(?:\s+-\s+.+\n)*)(---)/m,
      `$1  - ${k.sourceSession}\n$2`,
    );

    // Append new insights before the end of file
    const newInsights = k.keyInsights
      .map((i) => `- **${i.date}** (세션 ${i.sessionId}): ${i.content}`)
      .join("\n");

    updated = updated.trimEnd() + "\n" + newInsights + "\n";

    atomicWrite(filePath, updated);
  }
}
