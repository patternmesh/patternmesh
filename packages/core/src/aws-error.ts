export function isConditionalCheckFailed(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; __type?: string };
  return e.name === "ConditionalCheckFailedException" || e.__type === "ConditionalCheckFailedException";
}

export function isTransactionCanceled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; __type?: string };
  return e.name === "TransactionCanceledException" || e.__type === "TransactionCanceledException";
}

export function isIdempotentParameterMismatch(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; __type?: string };
  return e.name === "IdempotentParameterMismatchException" || e.__type === "IdempotentParameterMismatchException";
}

export type AwsCancellationReason = {
  readonly Code?: string;
  readonly Message?: string;
  readonly Item?: Record<string, unknown>;
};

/** Best-effort read of cancellation reasons from AWS SDK / DynamoDB errors. */
export function readTransactionCancellationReasons(err: unknown): readonly AwsCancellationReason[] {
  if (!err || typeof err !== "object") return [];
  const e = err as { CancellationReasons?: AwsCancellationReason[]; cancellationReasons?: AwsCancellationReason[] };
  const raw = e.CancellationReasons ?? e.cancellationReasons;
  return Array.isArray(raw) ? raw : [];
}
