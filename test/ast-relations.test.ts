import { describe, it, expect } from "vitest";
import { extractSymbolsAndRelations } from "../src/ast";

describe("extractSymbolsAndRelations", () => {
  it("extracts TypeScript symbols (function, class, interface, method)", async () => {
    const code = `export function createStore() {}\nexport class Engine { search() {} }\nexport interface Config { dbPath: string; }`;
    const result = await extractSymbolsAndRelations(code, "test.ts");
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "createStore", kind: "function" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Engine", kind: "class" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Config", kind: "interface" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "search", kind: "method" }));
  });

  it("extracts Python symbols", async () => {
    const code = `class MyClass:\n    pass\n\ndef my_func():\n    pass`;
    const result = await extractSymbolsAndRelations(code, "test.py");
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "MyClass", kind: "class" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "my_func", kind: "function" }));
  });

  it("extracts Go symbols", async () => {
    const code = `package main\n\ntype Store struct {}\n\nfunc NewStore() *Store { return &Store{} }\n\nfunc (s *Store) Query() {}`;
    const result = await extractSymbolsAndRelations(code, "test.go");
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Store", kind: "type" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "NewStore", kind: "function" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Query", kind: "method" }));
  });

  it("extracts Rust symbols", async () => {
    const code = `pub struct Engine {}\npub trait Search {}\npub fn search() {}`;
    const result = await extractSymbolsAndRelations(code, "test.rs");
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Engine", kind: "type" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Search", kind: "interface" }));
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "search", kind: "function" }));
  });

  it("returns empty for unsupported languages", async () => {
    expect((await extractSymbolsAndRelations("# hello", "test.md")).symbols).toEqual([]);
    expect((await extractSymbolsAndRelations("Shader {}", "test.shader")).symbols).toHaveLength(0);
  });

  // --- Relations ---

  it("extracts TS imports, extends, implements, and filters calls", async () => {
    const code = `import { foo } from './mod';\nclass SearchEngine extends BaseEngine implements IStore {}\nfunction bar() { foo(); console.log('hi'); }`;
    const result = await extractSymbolsAndRelations(code, "test.ts");
    expect(result.relations).toContainEqual(expect.objectContaining({ type: "imports", targetRef: "./mod", targetSymbol: "foo" }));
    expect(result.relations).toContainEqual(expect.objectContaining({ type: "extends", sourceSymbol: "SearchEngine", targetRef: "BaseEngine" }));
    expect(result.relations).toContainEqual(expect.objectContaining({ type: "implements", sourceSymbol: "SearchEngine", targetRef: "IStore" }));
    // Only imported symbols tracked as calls
    const calls = result.relations.filter(r => r.type === "calls");
    expect(calls).toContainEqual(expect.objectContaining({ targetSymbol: "foo" }));
    expect(calls.find(c => c.targetSymbol === "log")).toBeUndefined();
  });

  it("extracts Python from-imports", async () => {
    const result = await extractSymbolsAndRelations(`from .store import create_store`, "test.py");
    expect(result.relations).toContainEqual(expect.objectContaining({ type: "imports", targetRef: ".store", targetSymbol: "create_store" }));
  });

});
