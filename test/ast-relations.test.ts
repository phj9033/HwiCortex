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

  // --- C# ---

  it("extracts C# symbols (class, method, interface, enum, struct)", async () => {
    const code = `
using System;
public interface IPlayerService { void Execute(); }
public class PlayerController : MonoBehaviour { public void TakeDamage(int amount) {} }
public enum PlayerState { Idle, Running }
public struct PlayerData { public int level; }
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const kinds = result.symbols.map(s => ({ name: s.name, kind: s.kind }));
    expect(kinds).toContainEqual({ name: "IPlayerService", kind: "interface" });
    expect(kinds).toContainEqual({ name: "PlayerController", kind: "class" });
    expect(kinds).toContainEqual({ name: "TakeDamage", kind: "method" });
    expect(kinds).toContainEqual({ name: "PlayerState", kind: "enum" });
    expect(kinds).toContainEqual({ name: "PlayerData", kind: "type" });
  });

  it("extracts C# relations (using, extends, implements, attributes, generic loads)", async () => {
    const code = `
using UnityEngine;
using System.Collections.Generic;
[RequireComponent(typeof(Rigidbody))]
public class Player : MonoBehaviour, IDamageable {
  void Load() { Resources.Load<PlayerData>("path"); }
}
`;
    const result = await extractSymbolsAndRelations(code, "test.cs");
    const rels = result.relations;

    // using → imports
    expect(rels).toContainEqual(expect.objectContaining({ type: "imports", targetRef: "UnityEngine" }));
    expect(rels).toContainEqual(expect.objectContaining({ type: "imports", targetRef: "System.Collections.Generic" }));
    // extends (no I prefix)
    expect(rels).toContainEqual(expect.objectContaining({ type: "extends", sourceSymbol: "Player", targetRef: "MonoBehaviour" }));
    // implements (I prefix)
    expect(rels).toContainEqual(expect.objectContaining({ type: "implements", sourceSymbol: "Player", targetRef: "IDamageable" }));
    // RequireComponent → uses_type
    expect(rels).toContainEqual(expect.objectContaining({ type: "uses_type", targetRef: "Rigidbody" }));
    // Resources.Load<T> → uses_type
    expect(rels).toContainEqual(expect.objectContaining({ type: "uses_type", targetRef: "PlayerData" }));
  });
});
