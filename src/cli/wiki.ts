/**
 * CLI handler for `hwicortex wiki` subcommands.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import {
  createWikiPage,
  getWikiPage,
  listWikiPages,
  updateWikiPage,
  removeWikiPage,
  linkPages,
  unlinkPages,
  getLinks,
  generateIndex,
  bumpCount,
  type CountAction,
} from "../wiki.js";
import type { Store } from "../store.js";

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

export async function handleWiki(args: string[], flags: Record<string, any>, store?: Store): Promise<void> {
  const subcommand = args[0];
  const vaultDir = getVaultDir(flags);

  if (!subcommand) {
    console.error("Usage: hwicortex wiki <create|update|rm|list|show|link|unlink|links|index> [options]");
    console.error("");
    console.error("Commands:");
    console.error("  hwicortex wiki create <title> --project <name> [--tags t1,t2] [--body text]");
    console.error("  hwicortex wiki update <title> --project <name> [--append text] [--body text]");
    console.error("  hwicortex wiki rm <title> --project <name>");
    console.error("  hwicortex wiki list [--project <name>] [--tag <tag>]");
    console.error("  hwicortex wiki show <title> --project <name> [--json]");
    console.error("  hwicortex wiki link <titleA> <titleB> --project <name>");
    console.error("  hwicortex wiki unlink <titleA> <titleB> --project <name>");
    console.error("  hwicortex wiki links <title> --project <name>");
    console.error("  hwicortex wiki index --project <name> | --all");
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case "create": {
        const title = args[1];
        if (!title) { console.error("Usage: hwicortex wiki create <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }
        const tags = flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : [];
        const sources = flags.source ? [flags.source as string] : [];
        let body = flags.body as string | undefined;
        if (flags.stdin) body = readStdin();

        const filePath = await createWikiPage(vaultDir, { title, project, tags, sources, body, store });
        console.log(`Created: ${filePath}`);
        break;
      }

      case "update": {
        const title = args[1];
        if (!title) { console.error("Usage: hwicortex wiki update <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }

        await updateWikiPage(vaultDir, title, project, {
          append: flags.append as string | undefined,
          body: flags.body as string | undefined,
          tags: flags.tags ? (flags.tags as string).split(",").map(t => t.trim()) : undefined,
          addSource: flags["add-source"] as string | undefined,
          store,
        });
        console.log(`Updated: ${title}`);

        // Bump count unless --no-count
        if (!flags["no-count"]) {
          const action = (flags.append ? "append" : "update") as CountAction;
          bumpCount(vaultDir, title, project, action);
        }
        break;
      }

      case "rm":
      case "remove": {
        const title = args[1];
        if (!title) { console.error("Usage: hwicortex wiki rm <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }

        removeWikiPage(vaultDir, title, project, store);
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
        if (!title) { console.error("Usage: hwicortex wiki show <title> --project <name>"); process.exit(1); }
        const project = flags.project as string;
        if (!project) { console.error("Error: --project is required"); process.exit(1); }

        const page = getWikiPage(vaultDir, title, project);
        if (flags.json) {
          console.log(JSON.stringify(page.meta, null, 2));
        } else {
          console.log(page.body);
        }

        // Bump count unless --no-count
        if (!flags["no-count"]) {
          bumpCount(vaultDir, title, project, "show");
        }
        break;
      }

      case "link": {
        const titleA = args[1];
        const titleB = args[2];
        const project = flags.project as string;
        if (!titleA || !titleB || !project) {
          console.error("Usage: hwicortex wiki link <titleA> <titleB> --project <name>");
          process.exit(1);
        }
        linkPages(vaultDir, titleA, titleB, project);
        console.log(`Linked: "${titleA}" ↔ "${titleB}"`);

        // Bump count for both pages
        if (!flags["no-count"]) {
          bumpCount(vaultDir, titleA!, project, "link");
          bumpCount(vaultDir, titleB!, project, "link");
        }
        break;
      }

      case "unlink": {
        const titleA = args[1];
        const titleB = args[2];
        const project = flags.project as string;
        if (!titleA || !titleB || !project) {
          console.error("Usage: hwicortex wiki unlink <titleA> <titleB> --project <name>");
          process.exit(1);
        }
        unlinkPages(vaultDir, titleA, titleB, project);
        console.log(`Unlinked: "${titleA}" ↔ "${titleB}"`);
        break;
      }

      case "links": {
        const title = args[1];
        const project = flags.project as string;
        if (!title || !project) {
          console.error("Usage: hwicortex wiki links <title> --project <name>");
          process.exit(1);
        }
        const { related, backlinks } = getLinks(vaultDir, title, project);
        if (related.length > 0) {
          console.log("Related:");
          related.forEach((r) => console.log(`  ${r}`));
        }
        if (backlinks.length > 0) {
          console.log("Backlinks:");
          backlinks.forEach((b) => console.log(`  ${b}`));
        }
        if (related.length === 0 && backlinks.length === 0) {
          console.log("No links found.");
        }
        break;
      }

      case "index": {
        const project = flags.project as string;
        if (!project && !flags.all) {
          console.error("Usage: hwicortex wiki index --project <name> or --all");
          process.exit(1);
        }
        if (flags.all) {
          const wikiDir = join(vaultDir, "wiki");
          if (!existsSync(wikiDir)) { console.log("No wiki pages found."); break; }
          for (const dir of readdirSync(wikiDir).filter(d => statSync(join(wikiDir, d)).isDirectory())) {
            const path = generateIndex(vaultDir, dir);
            console.log(`Generated: ${path}`);
          }
        } else {
          const path = generateIndex(vaultDir, project);
          console.log(`Generated: ${path}`);
        }
        break;
      }

      default:
        console.error(`Unknown wiki subcommand: ${subcommand}`);
        console.error("Available: create, update, rm, list, show, link, unlink, links, index");
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
