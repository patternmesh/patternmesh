export class DynamoModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DynamoModelError";
    this.code = code;
  }
}

export class ValidationError extends DynamoModelError {
  readonly code = "VALIDATION_ERROR" as const;
  readonly issues: readonly { path: string; message: string }[];
  constructor(issues: readonly { path: string; message: string }[]) {
    super("VALIDATION_ERROR", issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export class ConfigurationError extends DynamoModelError {
  readonly code = "CONFIGURATION_ERROR" as const;
  constructor(message: string) {
    super("CONFIGURATION_ERROR", message);
    this.name = "ConfigurationError";
  }
}

export class ConditionFailedError extends DynamoModelError {
  readonly code = "CONDITION_FAILED" as const;
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super("CONDITION_FAILED", message);
    this.name = "ConditionFailedError";
    this.cause = cause;
  }
}

export class ItemAlreadyExistsError extends DynamoModelError {
  readonly code = "ITEM_ALREADY_EXISTS" as const;
  readonly entity?: string;
  constructor(message = "Item already exists", entity?: string, readonly cause?: unknown) {
    super("ITEM_ALREADY_EXISTS", message);
    this.name = "ItemAlreadyExistsError";
    this.entity = entity;
  }
}

export class NotUniqueError extends DynamoModelError {
  readonly code = "NOT_UNIQUE" as const;
  readonly pattern: string;
  constructor(pattern: string, message = `Access pattern "${pattern}" matched more than one item`) {
    super("NOT_UNIQUE", message);
    this.name = "NotUniqueError";
    this.pattern = pattern;
  }
}

export class QueryLimitError extends DynamoModelError {
  readonly code = "QUERY_LIMIT_EXCEEDED" as const;
  constructor(message: string) {
    super("QUERY_LIMIT_EXCEEDED", message);
    this.name = "QueryLimitError";
  }
}

/** Thrown when BatchWriteItem still has unprocessed items after the retry budget. */
export class BatchWriteExhaustedError extends DynamoModelError {
  readonly code = "BATCH_WRITE_EXHAUSTED" as const;
  constructor(message = "BatchWriteItem still has unprocessed items after retries") {
    super("BATCH_WRITE_EXHAUSTED", message);
    this.name = "BatchWriteExhaustedError";
  }
}

/** Thrown when BatchGetItem still has unprocessed keys after the retry budget. */
export class BatchGetExhaustedError extends DynamoModelError {
  readonly code = "BATCH_GET_EXHAUSTED" as const;
  constructor(message = "BatchGetItem still has unprocessed keys after retries") {
    super("BATCH_GET_EXHAUSTED", message);
    this.name = "BatchGetExhaustedError";
  }
}

/** One cancellation reason from TransactGetItems / TransactWriteItems, aligned to participant order. */
export interface TransactionCancellationReason {
  readonly code: string | undefined;
  readonly message: string | undefined;
  readonly item?: Record<string, unknown>;
}

export class TransactionCanceledError extends DynamoModelError {
  readonly code = "TRANSACTION_CANCELED" as const;
  readonly reasons: readonly TransactionCancellationReason[];
  readonly cause?: unknown;
  constructor(reasons: readonly TransactionCancellationReason[], message?: string, cause?: unknown) {
    super(
      "TRANSACTION_CANCELED",
      message ??
        `Transaction canceled (${reasons.length} reason(s): ${reasons.map((r) => r.code ?? "?").join(", ")})`,
    );
    this.name = "TransactionCanceledError";
    this.reasons = reasons;
    this.cause = cause;
  }
}

export class IdempotentParameterMismatchError extends DynamoModelError {
  readonly code = "IDEMPOTENT_PARAMETER_MISMATCH" as const;
  readonly cause?: unknown;
  constructor(message = "ClientRequestToken was reused with different request parameters", cause?: unknown) {
    super("IDEMPOTENT_PARAMETER_MISMATCH", message);
    this.name = "IdempotentParameterMismatchError";
    this.cause = cause;
  }
}
