import { describe, it, expect } from "vitest";
import { mockLlm } from "../_helpers/anthropic-mock.js";

describe("mockLlm", () => {
  it("returns scripted text in order", async () => {
    const llm = mockLlm(["one", "two"]);
    expect((await llm.call({ model: "x", messages: [{ role: "user", content: "" }] })).text).toBe("one");
    expect((await llm.call({ model: "x", messages: [{ role: "user", content: "" }] })).text).toBe("two");
  });
  it("supports function generators", async () => {
    const llm = mockLlm([(opts) => `model=${opts.model}`]);
    const r = await llm.call({ model: "haiku", messages: [{ role: "user", content: "" }] });
    expect(r.text).toBe("model=haiku");
  });
});
