import { Ajv, type ValidateFunction } from "ajv";
import {
  type ArgumentValidator,
  canonicalizeJson,
  type JsonSchema,
  type ValidationResult,
} from "../contracts/index.ts";

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_DEPTH = 128;
const MAX_CACHE_ENTRIES = 64;

/** Installed schemas are trusted code; model arguments are untrusted, bounded JSON data. */
export class AjvArgumentValidator implements ArgumentValidator {
  private readonly cache = new Map<string, ValidateFunction>();

  validate(schema: JsonSchema, raw: string, maxBytes: number): ValidationResult {
    try {
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
        throw new Error("Invalid argument byte limit");
      if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > maxBytes) {
        throw new Error("Tool arguments exceed the byte limit");
      }
      const value: unknown = JSON.parse(raw);
      assertUnambiguousJson(raw);
      canonicalizeJson(value);
      const key = canonicalizeJson(schema);
      if (Buffer.byteLength(key, "utf8") > MAX_SCHEMA_BYTES)
        throw new Error("Tool schema exceeds 64 KiB");
      let validate = this.cache.get(key);
      if (!validate) {
        const snapshot: unknown = JSON.parse(key);
        inspectSchema(snapshot);
        // A fresh registry prevents unrelated schemas' $id values or mutated schema objects
        // from selecting a validator compiled for a different schema.
        const ajv = new Ajv({
          strict: true,
          allErrors: false,
          coerceTypes: false,
          useDefaults: false,
          removeAdditional: false,
          $data: false,
          ownProperties: true,
          addUsedSchema: false,
          logger: false,
        });
        validate = ajv.compile(snapshot as JsonSchema);
        if (this.cache.size >= MAX_CACHE_ENTRIES) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, validate);
      }
      if (!validate(value))
        return { valid: false, reason: "Tool arguments do not match the schema" };
      return { valid: true, value };
    } catch (error) {
      return {
        valid: false,
        reason: `Invalid tool arguments or schema: ${error instanceof Error ? error.message : "validation failed"}`,
      };
    }
  }
}

function inspectSchema(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) throw new Error("Tool schema is too deeply nested");
  if (typeof value === "boolean") return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool schema must be an object or boolean");
  }
  const schema = value as Record<string, unknown>;
  if (Object.hasOwn(schema, "$async") || Object.hasOwn(schema, "$data")) {
    throw new Error("Asynchronous and $data schemas are not supported");
  }
  if (typeof schema.$ref === "string" && !schema.$ref.startsWith("#")) {
    throw new Error("Only local schema references are supported");
  }
  if (
    schema.$schema !== undefined &&
    schema.$schema !== "http://json-schema.org/draft-07/schema#"
  ) {
    throw new Error("Only JSON Schema Draft 7 is supported");
  }
  for (const keyword of ["properties", "patternProperties", "definitions", "$defs"] as const) {
    const children = schema[keyword];
    if (children && typeof children === "object" && !Array.isArray(children)) {
      for (const child of Object.values(children)) inspectSchema(child, depth + 1);
    }
  }
  for (const keyword of ["allOf", "anyOf", "oneOf", "items"] as const) {
    const children = schema[keyword];
    if (Array.isArray(children)) for (const child of children) inspectSchema(child, depth + 1);
    else if (keyword === "items" && children !== undefined) inspectSchema(children, depth + 1);
  }
  for (const keyword of [
    "additionalProperties",
    "additionalItems",
    "contains",
    "propertyNames",
    "not",
    "if",
    "then",
    "else",
  ] as const) {
    if (schema[keyword] !== undefined) inspectSchema(schema[keyword], depth + 1);
  }
  if (schema.dependencies && typeof schema.dependencies === "object") {
    for (const dependency of Object.values(schema.dependencies)) {
      if (!Array.isArray(dependency)) inspectSchema(dependency, depth + 1);
    }
  }
}

/** JSON.parse validates syntax first; this bounded scan rejects duplicate decoded keys. */
function assertUnambiguousJson(raw: string): void {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(raw[offset] ?? "") && offset < raw.length) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < raw.length) {
      const char = raw[offset++];
      if (char === "\\") offset++;
      else if (char === '"') break;
    }
    return JSON.parse(raw.slice(start, offset)) as string;
  };
  const visit = (depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error("Tool arguments are too deeply nested");
    whitespace();
    const char = raw[offset];
    if (char === '"') {
      string();
      return;
    }
    if (char === "{" || char === "[") {
      const object = char === "{";
      const close = object ? "}" : "]";
      const keys = new Set<string>();
      offset++;
      whitespace();
      while (raw[offset] !== close) {
        if (object) {
          const key = string();
          if (keys.has(key)) throw new Error("Duplicate JSON object key");
          keys.add(key);
          whitespace();
          offset++;
        }
        visit(depth + 1);
        whitespace();
        if (raw[offset] !== ",") break;
        offset++;
        whitespace();
      }
      offset++;
    } else {
      while (offset < raw.length && !/[\s,\]}]/.test(raw[offset] ?? "")) offset++;
    }
  };
  visit(0);
}
