import type { AstSymbol, AstRelation } from "./ast.js";

// web-tree-sitter types
type SyntaxNode = import("web-tree-sitter").SyntaxNode;

/**
 * C# symbol query — class, interface, enum, struct only.
 * Methods excluded: node granularity is script (class) level.
 */
export const CSHARP_SYMBOL_QUERY = `
  (class_declaration name: (identifier) @class_name)
  (interface_declaration name: (identifier) @interface_name)
  (enum_declaration name: (identifier) @enum_name)
  (struct_declaration name: (identifier) @type_name)
`;

/**
 * Extract C# symbols and relations from a parsed AST.
 * Called by ast.ts when language === "csharp".
 *
 * @param rootNode - Tree-sitter root node of the parsed C# file
 * @param filepath - File path (for diagnostics only)
 */
export function extractCSharpSymbolsAndRelations(
  rootNode: SyntaxNode,
  _filepath: string,
): { symbols: AstSymbol[]; relations: AstRelation[] } {
  const symbols: AstSymbol[] = [];
  const relations: AstRelation[] = [];

  // --- Symbol extraction via manual AST walk ---
  for (const node of rootNode.descendantsOfType("class_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "class", line: node.startPosition.row + 1 });
  }
  for (const node of rootNode.descendantsOfType("interface_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "interface", line: node.startPosition.row + 1 });
  }
  for (const node of rootNode.descendantsOfType("enum_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "enum", line: node.startPosition.row + 1 });
  }
  for (const node of rootNode.descendantsOfType("struct_declaration")) {
    const name = node.childForFieldName("name")?.text;
    if (name) symbols.push({ name, kind: "type", line: node.startPosition.row + 1 });
  }

  // --- Relation extraction (Task 2, 3 will fill this in) ---

  return { symbols, relations };
}
