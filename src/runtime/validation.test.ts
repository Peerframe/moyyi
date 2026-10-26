import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../contracts/index.ts";
import { AjvArgumentValidator } from "./validation.ts";

const schema = {
  type: "object",
  properties: {
    count: { type: "integer", minimum: 1 },
    label: { type: "string", default: "default" },
  },
  required: ["count"],
  additionalProperties: false,
};
const validate = (raw: string, candidate: JsonSchema = schema, limit = 4096) =>
  new AjvArgumentValidator().validate(candidate, raw, limit);

describe("AjvArgumentValidator", () => {
  it("identifies bounded fields, required fields, item constraints and types without mutation", () => {
    const candidate = {
      type: "object",
      properties: {
        contextLines: { type: "integer", minimum: 0, maximum: 20 },
        include: { type: "array", maxItems: 8, items: { type: "string", maxLength: 128 } },
      },
      required: ["contextLines"],
      additionalProperties: false,
    };
    expect(validate('{"contextLines":25}', candidate)).toEqual({
      valid: false,
      reason: "/contextLines must be <= 20",
    });
    expect(validate("{}", candidate)).toEqual({
      valid: false,
      reason: "/contextLines is required",
    });
    expect(validate('{"contextLines":"20"}', candidate)).toEqual({
      valid: false,
      reason: "/contextLines must be integer",
    });
    expect(
      validate(JSON.stringify({ contextLines: 8, include: ["x".repeat(129)] }), candidate),
    ).toEqual({ valid: false, reason: "/include/0 must have at most 128 characters" });
    expect(validate('{"contextLines":20}', candidate)).toEqual({
      valid: true,
      value: { contextLines: 20 },
    });
  });
  it("does not echo arbitrary property names, invalid JSON, enum values or schema errors", () => {
    const secret = "PRIVATE_VALUE\n".repeat(100);
    const cases: [string, JsonSchema][] = [
      [JSON.stringify({ count: 1, [secret]: secret }), schema],
      [
        JSON.stringify({ [secret]: secret }),
        { type: "object", additionalProperties: { type: "number" } },
      ],
      [`not-json-${secret}`, schema],
      [JSON.stringify(secret), { enum: [`${secret}-other`] }],
      ["1", { type: secret }],
      ["{}", { type: "object", properties: { [secret]: { type: "string" } }, required: [secret] }],
      [
        JSON.stringify({ nested: { [secret]: 1 } }),
        {
          type: "object",
          properties: { nested: { type: "object", additionalProperties: { type: "string" } } },
        },
      ],
    ];
    for (const [raw, candidate] of cases) {
      const result = validate(raw, candidate, 20_000);
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("Expected rejection");
      expect(result.reason).not.toContain("PRIVATE_VALUE");
      expect(
        [...result.reason].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
      ).toBe(false);
      expect(Buffer.byteLength(result.reason)).toBeLessThanOrEqual(512);
    }
  });
  it("limits diagnostic paths to declared names without misidentifying dynamic children", () => {
    const candidate = {
      type: "object",
      properties: {
        options: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
      },
    };
    expect(validate('{"options":{"private-key":-1}}', candidate)).toEqual({
      valid: false,
      reason: "A value within /options must be >= 0",
    });
    const referenced = {
      type: "object",
      properties: { count: { $ref: "#/definitions/count" } },
      definitions: { count: { type: "integer", maximum: 3 } },
    };
    expect(validate('{"count":5}', referenced)).toEqual({
      valid: false,
      reason: "/count must be <= 3",
    });
  });
  it("validates without coercing types, adding defaults, or removing properties", () => {
    expect(validate('{"count":1}')).toEqual({ valid: true, value: { count: 1 } });
    expect(validate('{"count":"1"}').valid).toBe(false);
    expect(validate('{"count":1,"extra":true}').valid).toBe(false);
    expect(validate("{}").valid).toBe(false);
  });
  it.each([
    "NaN",
    '{"count":1e999}',
    '{"count":1,}',
    '{"count":1,"count":2}',
    '{"count":1,"co\\u0075nt":2}',
    '{"a":{"x":1,"x":2}}',
  ])("rejects invalid or ambiguous JSON %s", (raw) => {
    expect(validate(raw, {}).valid).toBe(false);
  });
  it("handles strings containing escaped punctuation without false duplicate detection", () => {
    const value = { a: 'quoted " and } : [ \\ text', b: [{ a: 1 }, { a: 2 }] };
    expect(validate(JSON.stringify(value), {})).toEqual({ valid: true, value });
  });
  it("enforces UTF-8 raw and schema limits, plus nesting limits", () => {
    expect(validate('"中"', { type: "string" }, 4).valid).toBe(false);
    expect(validate('"中"', { type: "string" }, 5).valid).toBe(true);
    expect(validate("1", { description: "x".repeat(65536) }).valid).toBe(false);
    expect(validate(`${"[".repeat(130)}0${"]".repeat(130)}`, {}).valid).toBe(false);
  });
  it.each([0, -1, 1.1, Number.NaN])("rejects invalid byte limit %s", (limit) => {
    expect(validate("1", {}, limit).valid).toBe(false);
  });
  it.each([
    { $ref: "https://example.invalid/schema" },
    { $async: true, type: "number" },
    { type: "number", minimum: { $data: "1/value" } },
    { type: "string", unknownKeyword: true },
    { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" },
    { type: "object", properties: { x: { $async: false } } },
  ])("rejects unsupported schema features %j", (candidate) => {
    expect(validate("1", candidate).valid).toBe(false);
  });
  it("supports local references and isolates reused schema IDs", () => {
    const validator = new AjvArgumentValidator();
    const local = {
      $id: "https://example.invalid/local",
      type: "object",
      properties: { count: { $ref: "#/definitions/count" } },
      definitions: { count: { type: "integer" } },
    };
    expect(validator.validate(local, '{"count":1}', 100).valid).toBe(true);
    expect(
      validator.validate(
        { ...local, definitions: { count: { type: "string" } } },
        '{"count":1}',
        100,
      ).valid,
    ).toBe(false);
  });
  it("keys its cache by content so mutating a schema cannot reuse stale validation", () => {
    const validator = new AjvArgumentValidator();
    const mutable = { type: "string", maxLength: 10 };
    expect(validator.validate(mutable, '"hello"', 100).valid).toBe(true);
    mutable.maxLength = 1;
    expect(validator.validate(mutable, '"hello"', 100).valid).toBe(false);
  });
  it("rejects cycles, accessors and non-finite schema values without invoking getters", () => {
    const cyclic: JsonSchema = {};
    (cyclic as Record<string, unknown>).self = cyclic;
    let invoked = false;
    const getter = {
      get type() {
        invoked = true;
        return "number";
      },
    };
    for (const candidate of [cyclic, getter, { minimum: Number.NaN }])
      expect(validate("1", candidate).valid).toBe(false);
    expect(invoked).toBe(false);
  });
  it("treats prototype-shaped JSON keys as data, without pollution or an authority grant", () => {
    const result = validate(
      '{"__proto__":{"polluted":true},"constructor":"data","prototype":"data"}',
      { type: "object" },
    );
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.reason);
    expect(Object.hasOwn(result.value as object, "__proto__")).toBe(true);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
  it("does not interpret literal object data in const as schema keywords", () => {
    expect(
      validate('{"$async":true,"$ref":"remote"}', { const: { $async: true, $ref: "remote" } })
        .valid,
    ).toBe(true);
  });
});
