import { join } from "path";

export function topicYamlPath(vault: string, id: string): string {
  return join(vault, "research", "topics", `${id}.yml`);
}

export function stagingDir(vault: string, id: string): string {
  return join(vault, "research", "_staging", id);
}

export function notesDir(vault: string, id: string): string {
  return join(vault, "research", "notes", id);
}

export function sourcesDir(vault: string, id: string): string {
  return join(notesDir(vault, id), "sources");
}

export function draftsDir(vault: string, id: string): string {
  return join(vault, "research", "drafts", id);
}
