export type JsonPrimitive = boolean | null | number | string;
export type JsonArray = readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new TypeError("Expected a JSON-serializable value.");
  }
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}
