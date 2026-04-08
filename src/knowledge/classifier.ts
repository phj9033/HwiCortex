export interface ClassifyInput {
  title?: string;
  project?: string;
  tags?: string[];
}

export interface ClassifyResult {
  folder: string;
  fileName: string;
  tags: string[];
}

export function classify(input: ClassifyInput): ClassifyResult {
  const folder = input.project || "general";
  const fileName = toFileName(input.title);
  const tags = input.tags ?? [];

  return { folder, fileName, tags };
}

export function toFileName(title?: string): string {
  if (!title) {
    return `${new Date().toISOString().replace(/[:.]/g, "")}.md`;
  }

  const kebab = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${kebab}.md`;
}
