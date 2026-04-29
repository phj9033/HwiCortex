import { describe, it, expect } from "vitest";
import { runDashboard } from "../../src/cli/dashboard.js";

describe("runDashboard", () => {
  it("is a function", () => {
    expect(typeof runDashboard).toBe("function");
  });
});
