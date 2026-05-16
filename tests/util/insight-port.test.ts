import { describe, expect, it } from "vitest";
import { parseInsightPort } from "../../src/util/insight-port.js";

describe("parseInsightPort", () => {
  it("defaults to 4747 when no args are provided", () => {
    expect(parseInsightPort([])).toBe(4747);
  });

  it("parses the port positional argument", () => {
    expect(parseInsightPort(["4748"])).toBe(4748);
  });

  it("parses the --port flag form", () => {
    expect(parseInsightPort(["--port", "4749"])).toBe(4749);
  });

  it("parses the --port= form", () => {
    expect(parseInsightPort(["--port=4750"])).toBe(4750);
  });

  it("rejects a missing --port value", () => {
    expect(() => parseInsightPort(["--port"])).toThrow(/Invalid insight port/);
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseInsightPort(["abc"])).toThrow(/Invalid insight port/);
  });
});
