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

  // --- Inheritance / Implementation ---
  for (const classNode of [
    ...rootNode.descendantsOfType("class_declaration"),
    ...rootNode.descendantsOfType("struct_declaration"),
  ]) {
    const nameNode = classNode.childForFieldName("name");
    const className = nameNode?.text;
    if (!className) continue;

    const baseList = classNode.childForFieldName("bases")
      ?? classNode.descendantsOfType("base_list")[0];
    if (!baseList) continue;

    for (const base of baseList.namedChildren) {
      let typeName = base.text;
      // Strip generic params: Foo<T> -> Foo
      const genericIdx = typeName.indexOf("<");
      if (genericIdx > 0) typeName = typeName.substring(0, genericIdx);
      // Strip namespace prefix: Ns.Foo -> Foo
      const dotIdx = typeName.lastIndexOf(".");
      if (dotIdx >= 0) typeName = typeName.substring(dotIdx + 1);

      // I-prefix convention: IFoo = implements, otherwise extends
      const relType = typeName.startsWith("I")
        && typeName.length > 1
        && typeName[1]?.toUpperCase() === typeName[1]
        ? "implements" : "extends";

      relations.push({ type: relType, sourceSymbol: className, targetRef: typeName });
    }
  }

  // --- RequireComponent attribute ---
  for (const attrNode of rootNode.descendantsOfType("attribute")) {
    const nameNode = attrNode.childForFieldName("name");
    if (nameNode?.text === "RequireComponent") {
      const argList = attrNode.descendantsOfType("attribute_argument_list")[0]
        ?? attrNode.descendantsOfType("argument_list")[0];
      if (argList) {
        for (const typeofExpr of argList.descendantsOfType("typeof_expression")) {
          const typeNode = typeofExpr.namedChildren[0];
          if (typeNode) {
            relations.push({ type: "uses_type", targetRef: typeNode.text });
          }
        }
      }
    }
  }

  // --- Asset references (generic invocations + InstantiateAsync) ---
  const ASSET_LOAD_REGEX = /(?:Resources\.Load(?:All)?|Addressables\.LoadAssetAsync|(?:\w+\.)?LoadAsset|(?:\w+\.)?LoadAllAssets)<(\w+)>/;

  for (const invocation of rootNode.descendantsOfType("invocation_expression")) {
    const funcNode = invocation.childForFieldName("function");
    if (!funcNode) continue;
    const funcText = funcNode.text;

    const genericMatch = funcText.match(ASSET_LOAD_REGEX);
    if (genericMatch?.[1]) {
      relations.push({ type: "uses_type", targetRef: genericMatch[1] });
      continue;
    }

    // Addressables.InstantiateAsync — no generic, always GameObject
    if (funcText.includes("InstantiateAsync")) {
      relations.push({ type: "uses_type", targetRef: "GameObject" });
    }
  }

  return { symbols, relations };
}
