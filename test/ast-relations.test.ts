import { describe, it, expect } from "vitest";
import { extractSymbolsAndRelations } from "../src/ast";

describe("extractSymbolsAndRelations", () => {
  describe("TypeScript symbols", () => {
    it("extracts function declarations", async () => {
      const code = `export function createStore(opts: Options): Store { return new Store(opts); }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "createStore", kind: "function" })
      );
    });

    it("extracts class declarations", async () => {
      const code = `export class SearchEngine { search() {} }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "SearchEngine", kind: "class" })
      );
    });

    it("extracts interface declarations", async () => {
      const code = `export interface Config { dbPath: string; }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "Config", kind: "interface" })
      );
    });

    it("extracts method declarations inside class", async () => {
      const code = `class Foo { bar() {} baz() {} }`;
      const result = await extractSymbolsAndRelations(code, "test.ts");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "bar", kind: "method" })
      );
    });
  });

  describe("Python symbols", () => {
    it("extracts function and class", async () => {
      const code = `class MyClass:\n    def my_method(self):\n        pass\n\ndef my_func():\n    pass`;
      const result = await extractSymbolsAndRelations(code, "test.py");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "MyClass", kind: "class" })
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "my_func", kind: "function" })
      );
    });
  });

  describe("Go symbols", () => {
    it("extracts functions and types", async () => {
      const code = `package main\n\ntype Store struct {}\n\nfunc NewStore() *Store { return &Store{} }\n\nfunc (s *Store) Query() {}`;
      const result = await extractSymbolsAndRelations(code, "test.go");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "Store", kind: "type" })
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "NewStore", kind: "function" })
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "Query", kind: "method" })
      );
    });
  });

  describe("Rust symbols", () => {
    it("extracts functions, structs, and traits", async () => {
      const code = `pub struct Engine {}\n\npub trait Search {}\n\npub fn search() {}`;
      const result = await extractSymbolsAndRelations(code, "test.rs");
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "Engine", kind: "type" })
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "Search", kind: "interface" })
      );
      expect(result.symbols).toContainEqual(
        expect.objectContaining({ name: "search", kind: "function" })
      );
    });
  });

  it("returns empty for unsupported languages", async () => {
    const result = await extractSymbolsAndRelations("# hello", "test.md");
    expect(result.symbols).toEqual([]);
    expect(result.relations).toEqual([]);
  });

  describe("relation extraction", () => {
    describe("imports", () => {
      it("extracts TypeScript imports", async () => {
        const code = `import { createStore } from './store';\nimport path from 'path';`;
        const result = await extractSymbolsAndRelations(code, "test.ts");
        const imports = result.relations.filter(r => r.type === "imports");
        expect(imports).toContainEqual(
          expect.objectContaining({ targetRef: "./store", targetSymbol: "createStore" })
        );
      });

      it("extracts Python from-imports", async () => {
        const code = `from .store import create_store`;
        const result = await extractSymbolsAndRelations(code, "test.py");
        expect(result.relations).toContainEqual(
          expect.objectContaining({ type: "imports", targetRef: ".store", targetSymbol: "create_store" })
        );
      });
    });

    describe("extends", () => {
      it("extracts TypeScript class extends", async () => {
        const code = `class SearchEngine extends BaseEngine {}`;
        const result = await extractSymbolsAndRelations(code, "test.ts");
        expect(result.relations).toContainEqual(
          expect.objectContaining({ type: "extends", sourceSymbol: "SearchEngine", targetRef: "BaseEngine" })
        );
      });
    });

    describe("implements", () => {
      it("extracts TypeScript implements", async () => {
        const code = `class Store implements IStore {}`;
        const result = await extractSymbolsAndRelations(code, "test.ts");
        expect(result.relations).toContainEqual(
          expect.objectContaining({ type: "implements", sourceSymbol: "Store", targetRef: "IStore" })
        );
      });
    });

    describe("calls filtering", () => {
      it("only captures calls to imported symbols", async () => {
        const code = `import { foo } from './mod';\nfunction bar() { foo(); console.log('hi'); }`;
        const result = await extractSymbolsAndRelations(code, "test.ts");
        const calls = result.relations.filter(r => r.type === "calls");
        expect(calls).toContainEqual(
          expect.objectContaining({ type: "calls", targetSymbol: "foo" })
        );
        // console.log should NOT be in calls
        expect(calls.find(c => c.targetSymbol === "log")).toBeUndefined();
      });
    });
  });
});
