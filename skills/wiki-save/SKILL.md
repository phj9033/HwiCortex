---
name: wiki-save
description: Extract key knowledge from the current conversation and save to wiki
user_invocable: true
---

# Wiki Save

Save knowledge from this conversation to the HwiCortex wiki.

## Process

1. Analyze the current conversation for knowledge worth preserving:
   - Bug causes and solutions
   - Architecture decisions
   - Configuration procedures
   - Patterns and conventions

2. Check for duplicates:
   ```bash
   qmd wiki list --project <project>
   qmd search -c wiki "<candidate title>"
   ```

3. Present the proposed wiki page to the user:
   ```
   Title: <proposed title>
   Project: <project name>
   Tags: <comma-separated tags>
   Body:
     <summarized content>

   Save this? [Edit anything above or confirm]
   ```

4. Wait for user approval. Do NOT execute without confirmation.

5. On approval, execute:
   ```bash
   echo "<body content>" | qmd wiki create "<title>" --project <project> --tags <tags> --stdin
   ```

6. If related wiki pages exist, suggest linking:
   ```
   Related pages found: "Session Management", "OAuth 2.0"
   Link them? [y/n]
   ```
   If yes: `qmd wiki link "<new page>" "<related page>" --project <project>`

## Rules

- NEVER create a wiki page without user approval
- Check for existing pages before creating (avoid duplicates)
- If a similar page exists, suggest `qmd wiki update` instead of create
- Keep summaries concise — wiki pages should be reference material, not transcripts
- Use the project name from the current working context if available
