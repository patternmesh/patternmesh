import type { OpaqueCursor } from "./types.js";
import { ValidationError } from "./errors.js";

export function encodeCursor(key: Record<string, unknown>): OpaqueCursor {
  const json = JSON.stringify(key);
  return Buffer.from(json, "utf8").toString("base64url") as OpaqueCursor;
}

export function decodeCursor(cursor: OpaqueCursor): Record<string, unknown> {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ValidationError([{ path: "cursor", message: "Cursor must decode to an object" }]);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError([{ path: "cursor", message: "Malformed cursor" }]);
  }
}
