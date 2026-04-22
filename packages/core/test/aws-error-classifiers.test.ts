import { describe, expect, it } from "vitest";
import {
  isConditionalCheckFailed,
  isIdempotentParameterMismatch,
  isTransactionCanceled,
  readTransactionCancellationReasons,
} from "../src/aws-error.js";

describe("aws error classifiers", () => {
  it("matches by name and __type", () => {
    expect(isConditionalCheckFailed({ name: "ConditionalCheckFailedException" })).toBe(true);
    expect(isConditionalCheckFailed({ __type: "ConditionalCheckFailedException" })).toBe(true);
    expect(isTransactionCanceled({ name: "TransactionCanceledException" })).toBe(true);
    expect(isTransactionCanceled({ __type: "TransactionCanceledException" })).toBe(true);
    expect(isIdempotentParameterMismatch({ name: "IdempotentParameterMismatchException" })).toBe(
      true,
    );
    expect(isIdempotentParameterMismatch({ __type: "IdempotentParameterMismatchException" })).toBe(
      true,
    );
  });

  it("returns false for malformed classifier input", () => {
    expect(isConditionalCheckFailed(null)).toBe(false);
    expect(isConditionalCheckFailed("oops")).toBe(false);
    expect(isTransactionCanceled(42)).toBe(false);
    expect(isIdempotentParameterMismatch(undefined)).toBe(false);
  });

  it("extracts cancellation reasons from common shapes", () => {
    const reasons = [{ Code: "ConditionalCheckFailed", Message: "failed" }];
    expect(readTransactionCancellationReasons({ CancellationReasons: reasons })).toEqual(reasons);
    expect(readTransactionCancellationReasons({ cancellationReasons: reasons })).toEqual(reasons);
  });

  it("falls back to empty reasons for malformed inputs", () => {
    expect(readTransactionCancellationReasons({})).toEqual([]);
    expect(readTransactionCancellationReasons({ CancellationReasons: {} })).toEqual([]);
    expect(readTransactionCancellationReasons("bad")).toEqual([]);
  });
});
