/**
 * CLI handler for `qmd wiki` subcommands.
 */
import { readFileSync } from "fs";
import {
  createWikiPage,
  getWikiPage,
  listWikiPages,
  updateWikiPage,
  removeWikiPage,
} from "../wiki.js";

function getVaultDir(flags: Record<string, any>): string {
  const dir = (flags["vault-dir"] as string) || process.env.QMD_VAULT_DIR;
  if (!dir) {
    console.error("Error: Set QMD_VAULT_DIR or use --vault-dir.");
    process.exit(1);
  }
  return dir;
}

function readStdin(): string {
  return readFileSync(0, "utf-8").trim();
}

export async function handleWiki(args: string[], flags: Record<string, any>): Promise<void> {
  const subcommand = args[0];
  const vaultDir = getVaultDir(flags);

  if (!subcommand) {
    console.error("Usage: qmd wiki <create|update|rm|list|show> [options]");
    console.error("");
    console.error("Commands:");
    console.error("  qmd wiki create <title> --project <name> [--tags t1,t2] [--body text]");
    console.error("  qmd wiki update <title> --project <name> [--append text] [--body text]");
    console.error("  qmd wiki rm <title> --project <name>");
    console.error("  qmd wiki list [--project <name>] [--tag <tag>]");
    console.error("  qmd wiki show <title> --project <name> [--json]");
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case "create": {
        const title = args[1];
        if (!title) { console.error("Usage: qmd wiki create <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }
        const tags = flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : [];
        const sources = flags.source ? [flags.source as string] : [];
        let body = flags.body as string | undefined;
        if (flags.stdin) body = readStdin();

        const filePath = createWikiPage(vaultDir, { title, project, tags, sources, body });
        console.log(`Created: ${filePath}`);
        break;
      }

      case "update": {
        const title = args[1];
        if (!title) { console.error("Usage: qmd wiki update <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }

        updateWikiPage(vaultDir, title, project, {
          append: flags.append as string | undefined,
          body: flags.body as string | undefined,
          tags: flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : undefined,
          addSource: flags["add-source"] as string | undefined,
        });
        console.log(`Updated: ${title}`);
        break;
      }

      case "rm":
      case "remove": {
        const title = args[1];
        if (!title) { console.error("Usage: qmd wiki rm <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }

        removeWikiPage(vaultDir, title, project);
        console.log(`Removed: ${title}`);
        break;
      }

      case "list": {
        const pages = listWikiPages(vaultDir, {
          project: flags.project as string | undefined,
          tag: flags.tag as string | undefined,
        });
        if (pages.length === 0) {
          console.log("No wiki pages found.");
        } else {
          for (const p of pages) {
            const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
            console.log(`${p.title} (${p.project})${tags}`);
          }
        }
        break;
      }

      case "show": {
        const title = args[1];
        if (!title) { console.error("Usage: qmd wiki show <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }

        const page = getWikiPage(vaultDir, title, project);
        if (flags.json) {
          console.log(JSON.stringify(page.meta, null, 2));
        } else {
          console.log(page.body);
        }
        break;
      }

      default:
        console.error(`Unknown wiki subcommand: ${subcommand}`);
        console.error("Available: create, update, rm, list, show");
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
