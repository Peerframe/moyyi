import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import {
  type ArgumentValidator,
  canonicalizeJson,
  type JsonSchema,
  parseStrictJson,
  type ValidationResult,
} from "../contracts/index.ts";

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_DEPTH = 128;
const MAX_CACHE_ENTRIES = 64;

/** Installed schemas are trusted code; model arguments are untrusted, bounded JSON data. */
export class AjvArgumentValidator implements ArgumentValidator {
  private readonly cache = new Map<string, ValidateFunction>();

  validate(schema: JsonSchema, raw: string, maxBytes: number): ValidationResult {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      return { valid: false, reason: "Invalid argument byte limit" };
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > maxBytes)
      return { valid: false, reason: "Tool arguments exceed the byte limit" };
    let value: unknown;
    try {
      value = parseStrictJson(raw, maxBytes);
    } catch {
      // JSON.parse errors can quote private input. Never forward parser diagnostics.
      return { valid: false, reason: "Tool arguments must be unambiguous, finite, bounded JSON" };
    }
    try {
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
        return { valid: false, reason: validationReason(validate.schema, validate.errors?.[0]) };
      return { valid: true, value };
    } catch {
      return {
        valid: false,
        reason: "Tool schema is invalid, unsupported, or exceeds its limits",
      };
    }
  }
}

/** Only declared, short schema names can enter feedback; dynamic JSON keys remain opaque. */
function validationReason(schema: unknown, error: ErrorObject | undefined): string {
  if (!error) return "Tool arguments do not match the schema";
  let current = record(schema);
  const segments: string[] = [];
  let nested = false;
  for (const segment of error.instancePath.split("/").slice(1)) {
    const properties = record(current?.properties);
    if (properties && safeName(segment) && Object.hasOwn(properties, segment)) {
      segments.push(segment);
      current = record(properties[segment]);
    } else if (current?.type === "array" && /^[0-9]{1,8}$/.test(segment) && record(current.items)) {
      segments.push(segment);
      current = record(current.items);
    } else {
      nested = true;
      break;
    }
    if (segments.join("/").length > 160) {
      segments.pop();
      nested = true;
      break;
    }
  }
  const missing: unknown = error.params.missingProperty;
  const properties = record(current?.properties);
  if (
    error.keyword === "required" &&
    !nested &&
    safeName(missing) &&
    properties &&
    Object.hasOwn(properties, missing) &&
    Array.isArray(current?.required) &&
    current.required.includes(missing)
  ) {
    return `/${[...segments, missing].join("/")} is required`;
  }
  const location = segments.length ? `/${segments.join("/")}` : "arguments";
  const subject = nested ? `A value within ${location}` : location;
  const bound: unknown = error.params.limit;
  const finite = typeof bound === "number" && Number.isFinite(bound);
  const limits: Record<string, string> = {
    maximum: "must be <=",
    minimum: "must be >=",
    exclusiveMaximum: "must be <",
    exclusiveMinimum: "must be >",
    maxLength: "must have at most",
    minLength: "must have at least",
    maxItems: "must have at most",
    minItems: "must have at least",
    maxProperties: "must have at most",
    minProperties: "must have at least",
  };
  if (Object.hasOwn(limits, error.keyword) && finite) {
    const unit = error.keyword.endsWith("Length")
      ? " characters"
      : error.keyword.endsWith("Items")
        ? " items"
        : error.keyword.endsWith("Properties")
          ? " properties"
          : "";
    return `${subject} ${limits[error.keyword]} ${bound}${unit}`;
  }
  if (
    error.keyword === "type" &&
    ["object", "array", "string", "number", "integer", "boolean", "null"].includes(
      error.params.type,
    )
  )
    return `${subject} must be ${error.params.type}`;
  const reasons: Record<string, string> = {
    required: "is missing a required field",
    additionalProperties: "contains an unsupported property",
    enum: "must use one of the declared choices",
    const: "must match the declared constant",
    pattern: "must match the declared pattern",
    uniqueItems: "must contain unique items",
  };
  return `${subject} ${Object.hasOwn(reasons, error.keyword) ? reasons[error.keyword] : "does not match the schema"}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(value);
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
