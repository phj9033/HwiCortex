import { describe, it, expect } from "vitest";
import { extractSymbolsAndRelations } from "../src/ast.js";

describe("C# symbol extraction (ast-csharp)", () => {
  it("extracts class, interface, enum, struct but not method", async () => {
    const code = `
using UnityEngine;

public class PlayerController : MonoBehaviour {
    public enum State { Idle, Run }
    public void Update() {}
}

public interface IDamageable {
    void TakeDamage(float amount);
}

public struct HitInfo {
    public float damage;
}
`;
    const result = await extractSymbolsAndRelations(code, "PlayerController.cs");
    const names = result.symbols.map(s => s.name);
    expect(names).toContain("PlayerController");
    expect(names).toContain("State");
    expect(names).toContain("IDamageable");
    expect(names).toContain("HitInfo");
    // method should NOT be extracted
    expect(names).not.toContain("Update");
    expect(names).not.toContain("TakeDamage");
  });

  it("extracts extends relation", async () => {
    const code = `public class Player : MonoBehaviour { }`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const ext = result.relations.filter(r => r.type === "extends");
    expect(ext).toHaveLength(1);
    expect(ext[0].sourceSymbol).toBe("Player");
    expect(ext[0].targetRef).toBe("MonoBehaviour");
  });

  it("extracts implements relation via I-prefix", async () => {
    const code = `public class Player : IDamageable { }`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const impl = result.relations.filter(r => r.type === "implements");
    expect(impl).toHaveLength(1);
    expect(impl[0].sourceSymbol).toBe("Player");
    expect(impl[0].targetRef).toBe("IDamageable");
  });

  it("extracts mixed inheritance: 1 extends + 2 implements", async () => {
    const code = `public class Player : MonoBehaviour, IDamageable, ISerializable { }`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const ext = result.relations.filter(r => r.type === "extends");
    const impl = result.relations.filter(r => r.type === "implements");
    expect(ext).toHaveLength(1);
    expect(ext[0].targetRef).toBe("MonoBehaviour");
    expect(impl).toHaveLength(2);
    expect(impl.map(r => r.targetRef).sort()).toEqual(["IDamageable", "ISerializable"]);
  });

  it("strips generic params from base type", async () => {
    const code = `public class Pool : ObjectPool<Enemy> { }`;
    const result = await extractSymbolsAndRelations(code, "Pool.cs");
    const ext = result.relations.filter(r => r.type === "extends");
    expect(ext[0].targetRef).toBe("ObjectPool");
  });

  it("does NOT generate imports from using directives", async () => {
    const code = `
using UnityEngine;
using System.Collections.Generic;

public class Foo : MonoBehaviour { }
`;
    const result = await extractSymbolsAndRelations(code, "Foo.cs");
    const imports = result.relations.filter(r => r.type === "imports");
    expect(imports).toHaveLength(0);
  });

  it("does NOT generate calls relations", async () => {
    const code = `
using UnityEngine;

public class Player : MonoBehaviour {
    void Start() {
        Debug.Log("hello");
        GetComponent<Rigidbody>();
    }
}
`;
    const result = await extractSymbolsAndRelations(code, "Player.cs");
    const calls = result.relations.filter(r => r.type === "calls");
    expect(calls).toHaveLength(0);
  });
});
