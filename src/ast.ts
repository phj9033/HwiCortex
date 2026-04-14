/**
 * AST-aware chunking support via web-tree-sitter.
 *
 * Provides language detection, AST break point extraction for supported
 * code file types, and a stub for future symbol extraction.
 *
 * All functions degrade gracefully: parse failures or unsupported languages
 * return empty arrays, falling back to regex-only chunking.
 *
 * ## Dependency Note
 *
 * Grammar packages (tree-sitter-typescript, etc.) are listed as
 * optionalDependencies with pinned versions. They ship native prebuilds
 * and source files (~72 MB total) but QMD only uses the .wasm files
 * (~5 MB). If install size becomes a concern, the .wasm files can be
 * bundled directly in the repo (e.g. assets/grammars/) and resolved
 * via import.meta.url instead of require.resolve(), eliminating the
 * grammar packages entirely.
 */

import { createRequire } from "node:module";
import { extname } from "node:path";
import type { BreakPoint } from "./store.js";

// web-tree-sitter types — imported dynamically to avoid top-level WASM init
type ParserType = import("web-tree-sitter").Parser;
type LanguageType = import("web-tree-sitter").Language;
type QueryType = import("web-tree-sitter").Query;

// =============================================================================
// Language Detection
// =============================================================================

export type SupportedLanguage = "typescript" | "tsx" | "javascript" | "python" | "go" | "rust";

const EXTENSION_MAP: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

/**
 * Detect language from file path extension.
 * Returns null for unsupported or unknown extensions (including .md).
 */
export function detectLanguage(filepath: string): SupportedLanguage | null {
  const ext = extname(filepath).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

// =============================================================================
// Grammar Resolution
// =============================================================================

/**
 * Maps language to the npm package and wasm filename for the grammar.
 */
const GRAMMAR_MAP: Record<SupportedLanguage, { pkg: string; wasm: string }> = {
  typescript: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  tsx:        { pkg: "tree-sitter-typescript", wasm: "tree-sitter-tsx.wasm" },
  javascript: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  python:     { pkg: "tree-sitter-python",     wasm: "tree-sitter-python.wasm" },
  go:         { pkg: "tree-sitter-go",         wasm: "tree-sitter-go.wasm" },
  rust:       { pkg: "tree-sitter-rust",        wasm: "tree-sitter-rust.wasm" },
};

// =============================================================================
// Per-Language Query Definitions
// =============================================================================

/**
 * Tree-sitter S-expression queries for each language.
 * Each capture name maps to a break point score via SCORE_MAP.
 *
 * For TypeScript/JavaScript, we match export_statement wrappers to get the
 * correct start position (before `export`), plus bare declarations for
 * non-exported code.
 */
const LANGUAGE_QUERIES: Record<SupportedLanguage, string> = {
  typescript: `
    (export_statement) @export
    (class_declaration) @class
    (function_declaration) @func
    (method_definition) @method
    (interface_declaration) @iface
    (type_alias_declaration) @type
    (enum_declaration) @enum
    (import_statement) @import
    (lexical_declaration (variable_declarator value: (arrow_function))) @func
    (lexical_declaration (variable_declarator value: (function_expression))) @func
  `,
  tsx: `
    (export_statement) @export
    (class_declaration) @class
    (function_declaration) @func
    (method_definition) @method
    (interface_declaration) @iface
    (type_alias_declaration) @type
    (enum_declaration) @enum
    (import_statement) @import
    (lexical_declaration (variable_declarator value: (arrow_function))) @func
    (lexical_declaration (variable_declarator value: (function_expression))) @func
  `,
  javascript: `
    (export_statement) @export
    (class_declaration) @class
    (function_declaration) @func
    (method_definition) @method
    (import_statement) @import
    (lexical_declaration (variable_declarator value: (arrow_function))) @func
    (lexical_declaration (variable_declarator value: (function_expression))) @func
  `,
  python: `
    (class_definition) @class
    (function_definition) @func
    (decorated_definition) @decorated
    (import_statement) @import
    (import_from_statement) @import
  `,
  go: `
    (type_declaration) @type
    (function_declaration) @func
    (method_declaration) @method
    (import_declaration) @import
  `,
  rust: `
    (struct_item) @struct
    (impl_item) @impl
    (function_item) @func
    (trait_item) @trait
    (enum_item) @enum
    (use_declaration) @import
    (type_item) @type
    (mod_item) @mod
  `,
};

/**
 * Score mapping from capture names to break point scores.
 * Aligned with the markdown BREAK_PATTERNS scale (h1=100, h2=90, etc.)
 * so findBestCutoff() decay works unchanged.
 */
const SCORE_MAP: Record<string, number> = {
  class:     100,
  iface:     100,
  struct:    100,
  trait:     100,
  impl:      100,
  mod:       100,
  export:     90,
  func:       90,
  method:     90,
  decorated:  90,
  type:       80,
  enum:       80,
  import:     60,
};

// =============================================================================
// Parser Caching & Initialization
// =============================================================================

let ParserClass: typeof import("web-tree-sitter").Parser | null = null;
let LanguageClass: typeof import("web-tree-sitter").Language | null = null;
let QueryClass: typeof import("web-tree-sitter").Query | null = null;
let initPromise: Promise<void> | null = null;

/** Languages that have already failed to load — warn only once per process. */
const failedLanguages = new Set<string>();

/** Cached grammar load promises. */
const grammarCache = new Map<string, Promise<LanguageType>>();

/** Cached compiled queries per language. */
const queryCache = new Map<string, QueryType>();

/**
 * Initialize web-tree-sitter. Called once and cached.
 */
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import("web-tree-sitter");
      ParserClass = mod.Parser;
      LanguageClass = mod.Language;
      QueryClass = mod.Query;
      await ParserClass.init();
    })();
  }
  return initPromise;
}

/**
 * Resolve the filesystem path to a grammar .wasm file.
 * Uses createRequire to resolve from installed dependency packages.
 */
function resolveGrammarPath(language: SupportedLanguage): string {
  const { pkg, wasm } = GRAMMAR_MAP[language];
  const require = createRequire(import.meta.url);
  return require.resolve(`${pkg}/${wasm}`);
}

/**
 * Load and cache a grammar for the given language.
 * Returns null on failure (logs once per language).
 */
async function loadGrammar(language: SupportedLanguage): Promise<LanguageType | null> {
  if (failedLanguages.has(language)) return null;

  const wasmKey = GRAMMAR_MAP[language].wasm;
  if (!grammarCache.has(wasmKey)) {
    grammarCache.set(wasmKey, (async () => {
      const path = resolveGrammarPath(language);
      return LanguageClass!.load(path);
    })());
  }

  try {
    return await grammarCache.get(wasmKey)!;
  } catch (err) {
    failedLanguages.add(language);
    grammarCache.delete(wasmKey);
    console.warn(`[qmd] Failed to load tree-sitter grammar for ${language}: ${err}`);
    return null;
  }
}

/**
 * Get or create a compiled query for the given language.
 */
function getQuery(language: SupportedLanguage, grammar: LanguageType): QueryType {
  if (!queryCache.has(language)) {
    const source = LANGUAGE_QUERIES[language];
    const query = new QueryClass!(grammar, source);
    queryCache.set(language, query);
  }
  return queryCache.get(language)!;
}

// =============================================================================
// AST Break Point Extraction
// =============================================================================

/**
 * Parse a source file and return break points at AST node boundaries.
 *
 * Returns an empty array for unsupported languages, parse failures,
 * or grammar loading failures. Never throws.
 *
 * @param content - The file content to parse.
 * @param filepath - The file path (used for language detection).
 * @returns Array of BreakPoint objects suitable for merging with regex break points.
 */
export async function getASTBreakPoints(
  content: string,
  filepath: string,
): Promise<BreakPoint[]> {
  const language = detectLanguage(filepath);
  if (!language) return [];

  try {
    await ensureInit();

    const grammar = await loadGrammar(language);
    if (!grammar) return [];

    const parser = new ParserClass!();
    parser.setLanguage(grammar);

    const tree = parser.parse(content);
    if (!tree) {
      parser.delete();
      return [];
    }

    const query = getQuery(language, grammar);
    const captures = query.captures(tree.rootNode);

    // Deduplicate: at each byte position, keep the highest-scoring capture.
    // This handles cases like export_statement wrapping a class_declaration
    // at different offsets — we want the outermost (earliest) position.
    const seen = new Map<number, BreakPoint>();

    for (const cap of captures) {
      const pos = cap.node.startIndex;
      const score = SCORE_MAP[cap.name] ?? 20;
      const type = `ast:${cap.name}`;

      const existing = seen.get(pos);
      if (!existing || score > existing.score) {
        seen.set(pos, { pos, score, type });
      }
    }

    tree.delete();
    parser.delete();

    return Array.from(seen.values()).sort((a, b) => a.pos - b.pos);
  } catch (err) {
    console.warn(`[qmd] AST parse failed for ${filepath}, falling back to regex: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// =============================================================================
// Health / Status
// =============================================================================

/**
 * Check which tree-sitter grammars are available.
 * Returns a status object for each supported language.
 */
export async function getASTStatus(): Promise<{
  available: boolean;
  languages: { language: SupportedLanguage; available: boolean; error?: string }[];
}> {
  const languages: { language: SupportedLanguage; available: boolean; error?: string }[] = [];

  try {
    await ensureInit();
  } catch (err) {
    return {
      available: false,
      languages: (Object.keys(GRAMMAR_MAP) as SupportedLanguage[]).map(lang => ({
        language: lang,
        available: false,
        error: `web-tree-sitter init failed: ${err instanceof Error ? err.message : err}`,
      })),
    };
  }

  for (const lang of Object.keys(GRAMMAR_MAP) as SupportedLanguage[]) {
    try {
      const grammar = await loadGrammar(lang);
      if (grammar) {
        // Also verify the query compiles
        getQuery(lang, grammar);
        languages.push({ language: lang, available: true });
      } else {
        languages.push({ language: lang, available: false, error: "grammar failed to load" });
      }
    } catch (err) {
      languages.push({
        language: lang,
        available: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    available: languages.some(l => l.available),
    languages,
  };
}

// =============================================================================
// Symbol Extraction (Phase 2)
// =============================================================================

/**
 * Metadata about a code symbol within a chunk.
 * Stubbed for Phase 2 — always returns empty array in Phase 1.
 */
export interface SymbolInfo {
  name: string;
  kind: string;
  signature?: string;
  line: number;
}

/**
 * Extract symbol metadata for code within a byte range.
 * Stubbed for Phase 2 — returns empty array.
 */
export function extractSymbols(
  _content: string,
  _language: string,
  _startPos: number,
  _endPos: number,
): SymbolInfo[] {
  return [];
}

/**
 * AST symbol with kind and location.
 */
export interface AstSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "method";
  line: number;
}

/**
 * Relation between symbols (imports, calls, inheritance, etc.)
 * Reserved for Task 3.
 */
export interface AstRelation {
  type: "imports" | "calls" | "extends" | "implements" | "uses_type";
  sourceSymbol?: string;
  targetRef: string;
  targetSymbol?: string;
}

/**
 * Result of AST analysis.
 */
export interface AstAnalysis {
  symbols: AstSymbol[];
  relations: AstRelation[];
}

/**
 * Tree-sitter queries for extracting symbol declarations.
 * Each capture name maps to a symbol kind.
 */
const SYMBOL_QUERIES: Record<SupportedLanguage, string> = {
  typescript: `
    (class_declaration name: (type_identifier) @class_name)
    (function_declaration name: (identifier) @function_name)
    (interface_declaration name: (type_identifier) @interface_name)
    (type_alias_declaration name: (type_identifier) @type_name)
    (enum_declaration name: (identifier) @enum_name)
    (method_definition name: (property_identifier) @method_name)
  `,
  tsx: `
    (class_declaration name: (type_identifier) @class_name)
    (function_declaration name: (identifier) @function_name)
    (interface_declaration name: (type_identifier) @interface_name)
    (type_alias_declaration name: (type_identifier) @type_name)
    (enum_declaration name: (identifier) @enum_name)
    (method_definition name: (property_identifier) @method_name)
  `,
  javascript: `
    (class_declaration name: (identifier) @class_name)
    (function_declaration name: (identifier) @function_name)
    (method_definition name: (property_identifier) @method_name)
  `,
  python: `
    (class_definition name: (identifier) @class_name)
    (function_definition name: (identifier) @function_name)
  `,
  go: `
    (function_declaration name: (identifier) @function_name)
    (method_declaration name: (field_identifier) @method_name)
    (type_spec name: (type_identifier) @type_name)
  `,
  rust: `
    (function_item name: (identifier) @function_name)
    (struct_item name: (type_identifier) @type_name)
    (enum_item name: (type_identifier) @enum_name)
    (trait_item name: (type_identifier) @interface_name)
  `,
};

/**
 * Map capture names to symbol kinds.
 */
const SYMBOL_KIND_MAP: Record<string, AstSymbol["kind"]> = {
  class_name: "class",
  function_name: "function",
  interface_name: "interface",
  type_name: "type",
  enum_name: "enum",
  method_name: "method",
};

/**
 * Extract symbols and relations from source code using tree-sitter.
 *
 * @param content - Source code content
 * @param filepath - File path (used for language detection)
 * @returns AstAnalysis with symbols and relations (relations empty in Phase 2)
 */
export async function extractSymbolsAndRelations(
  content: string,
  filepath: string,
): Promise<AstAnalysis> {
  const language = detectLanguage(filepath);
  if (!language) {
    return { symbols: [], relations: [] };
  }

  try {
    await ensureInit();

    const grammar = await loadGrammar(language);
    if (!grammar) {
      return { symbols: [], relations: [] };
    }

    const parser = new ParserClass!();
    parser.setLanguage(grammar);

    const tree = parser.parse(content);
    if (!tree) {
      parser.delete();
      return { symbols: [], relations: [] };
    }

    const querySource = SYMBOL_QUERIES[language];
    const query = new QueryClass!(grammar, querySource);
    const captures = query.captures(tree.rootNode);

    const symbols: AstSymbol[] = [];
    const lines = content.split("\n");

    for (const cap of captures) {
      const kind = SYMBOL_KIND_MAP[cap.name];
      if (!kind) continue;

      const name = cap.node.text;
      const line = cap.node.startPosition.row + 1; // 1-indexed

      symbols.push({ name, kind, line });
    }

    // Extract relations
    const relations: AstRelation[] = [];
    const importedSymbols = new Set<string>();

    // Walk the tree to extract relations based on language
    const rootNode = tree.rootNode;

    if (language === "typescript" || language === "tsx" || language === "javascript") {
      // Extract TypeScript/JavaScript imports
      for (const importNode of rootNode.descendantsOfType("import_statement")) {
        // Get the source string (e.g., './store' or 'path')
        const sourceNode = importNode.childForFieldName("source");
        if (!sourceNode) continue;

        const targetRef = sourceNode.text.slice(1, -1); // Remove quotes

        // Extract import clause (first named child)
        const importClause = importNode.namedChildren.find(n => n.type === "import_clause");
        if (importClause) {
          // Default import (direct identifier child of import_clause)
          const defaultId = importClause.namedChildren.find(n => n.type === "identifier");
          if (defaultId) {
            const targetSymbol = defaultId.text;
            importedSymbols.add(targetSymbol);
            relations.push({ type: "imports", targetRef, targetSymbol });
          }

          // Named imports
          const namedImports = importClause.descendantsOfType("named_imports")[0];
          if (namedImports) {
            for (const specifier of namedImports.descendantsOfType("import_specifier")) {
              const nameNode = specifier.childForFieldName("name");
              if (nameNode) {
                const targetSymbol = nameNode.text;
                importedSymbols.add(targetSymbol);
                relations.push({ type: "imports", targetRef, targetSymbol });
              }
            }
          }
        }
      }

      // Extract class extends and implements
      for (const classNode of rootNode.descendantsOfType("class_declaration")) {
        const className = classNode.childForFieldName("name")?.text;
        if (!className) continue;

        // Extract extends
        const extendsClause = classNode.descendantsOfType("extends_clause")[0];
        if (extendsClause) {
          const typeRef = extendsClause.namedChildren[0];
          if (typeRef) {
            relations.push({
              type: "extends",
              sourceSymbol: className,
              targetRef: typeRef.text,
            });
          }
        }

        // Extract implements
        const implementsClause = classNode.descendantsOfType("implements_clause")[0];
        if (implementsClause) {
          // Get all type references in implements clause
          for (const typeRef of implementsClause.namedChildren) {
            if (typeRef.type === "type_identifier" || typeRef.type === "identifier") {
              relations.push({
                type: "implements",
                sourceSymbol: className,
                targetRef: typeRef.text,
              });
            }
          }
        }
      }

      // Extract calls to imported symbols
      for (const callNode of rootNode.descendantsOfType("call_expression")) {
        const functionNode = callNode.childForFieldName("function");
        if (!functionNode) continue;

        // Handle direct identifier calls (e.g., foo())
        if (functionNode.type === "identifier") {
          const callee = functionNode.text;
          if (importedSymbols.has(callee)) {
            relations.push({
              type: "calls",
              targetSymbol: callee,
              targetRef: callee,
            });
          }
        }
        // Handle member expression calls (e.g., obj.method())
        else if (functionNode.type === "member_expression") {
          const objectNode = functionNode.childForFieldName("object");
          if (objectNode && objectNode.type === "identifier") {
            const obj = objectNode.text;
            if (importedSymbols.has(obj)) {
              const propertyNode = functionNode.childForFieldName("property");
              if (propertyNode) {
                relations.push({
                  type: "calls",
                  targetSymbol: propertyNode.text,
                  targetRef: obj,
                });
              }
            }
          }
        }
      }
    } else if (language === "python") {
      // Extract Python from-imports
      for (const importNode of rootNode.descendantsOfType("import_from_statement")) {
        // Get the module path (e.g., .store or package.module)
        const moduleNode = importNode.childForFieldName("module_name");
        let targetRef = "";

        if (moduleNode) {
          targetRef = moduleNode.text;
        }

        if (!targetRef) continue;

        // Extract imported names from the 'name' field
        const nameNode = importNode.childForFieldName("name");
        if (nameNode) {
          // Single import (dotted_name)
          if (nameNode.type === "dotted_name") {
            const targetSymbol = nameNode.text;
            importedSymbols.add(targetSymbol);
            relations.push({ type: "imports", targetRef, targetSymbol });
          }
          // Multiple imports (will need to handle this differently)
        }

        // Also check for aliased imports
        for (const aliasNode of importNode.descendantsOfType("aliased_import")) {
          const aliasNameNode = aliasNode.childForFieldName("name");
          if (aliasNameNode) {
            const targetSymbol = aliasNameNode.text;
            importedSymbols.add(targetSymbol);
            relations.push({ type: "imports", targetRef, targetSymbol });
          }
        }
      }

      // Extract Python regular imports (e.g., import os)
      for (const importNode of rootNode.descendantsOfType("import_statement")) {
        for (const dottedName of importNode.descendantsOfType("dotted_name")) {
          const targetRef = dottedName.text;
          const targetSymbol = targetRef.split(".")[0]; // First part is the symbol
          importedSymbols.add(targetSymbol);
          relations.push({ type: "imports", targetRef, targetSymbol });
        }
      }

      // Extract calls to imported symbols (Python)
      for (const callNode of rootNode.descendantsOfType("call")) {
        const functionNode = callNode.childForFieldName("function");
        if (!functionNode) continue;

        if (functionNode.type === "identifier") {
          const callee = functionNode.text;
          if (importedSymbols.has(callee)) {
            relations.push({
              type: "calls",
              targetSymbol: callee,
              targetRef: callee,
            });
          }
        }
      }
    } else if (language === "go") {
      // Extract Go imports (minimal implementation)
      for (const importNode of rootNode.descendantsOfType("import_declaration")) {
        for (const spec of importNode.descendantsOfType("import_spec")) {
          const pathNode = spec.childForFieldName("path");
          if (pathNode) {
            const targetRef = pathNode.text.slice(1, -1); // Remove quotes
            const parts = targetRef.split("/");
            const targetSymbol = parts[parts.length - 1];
            importedSymbols.add(targetSymbol);
            relations.push({ type: "imports", targetRef, targetSymbol });
          }
        }
      }
    } else if (language === "rust") {
      // Extract Rust use declarations (minimal implementation)
      for (const useNode of rootNode.descendantsOfType("use_declaration")) {
        const text = useNode.text;
        // Simple extraction: extract the last part after ::
        const parts = text.split("::");
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1].replace(/[;{}\s]/g, "");
          if (lastPart) {
            importedSymbols.add(lastPart);
            relations.push({ type: "imports", targetRef: text, targetSymbol: lastPart });
          }
        }
      }
    }

    tree.delete();
    parser.delete();

    return {
      symbols,
      relations,
    };
  } catch (err) {
    console.warn(
      `[qmd] Symbol extraction failed for ${filepath}: ${err instanceof Error ? err.message : err}`
    );
    return { symbols: [], relations: [] };
  }
}
