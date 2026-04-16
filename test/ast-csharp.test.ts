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
});
