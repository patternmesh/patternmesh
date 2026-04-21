import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * Minimal DynamoDB stream record shapes.
 *
 * These are intentionally inlined (and not imported from `aws-lambda`) so that
 * consumers do not need `@types/aws-lambda` to use this package. The shapes are
 * structurally compatible with the `aws-lambda` types, so you can pass a value
 * typed as `DynamoDBStreamEvent` from `aws-lambda` directly to this package.
 */

export interface DynamoDBAttributeValue {
  readonly B?: string;
  readonly BS?: readonly string[];
  readonly BOOL?: boolean;
  readonly L?: readonly DynamoDBAttributeValue[];
  readonly M?: { readonly [key: string]: DynamoDBAttributeValue };
  readonly N?: string;
  readonly NS?: readonly string[];
  readonly NULL?: boolean;
  readonly S?: string;
  readonly SS?: readonly string[];
}

export interface DynamoDBStreamImage {
  readonly [attributeName: string]: DynamoDBAttributeValue;
}

export interface DynamoDBStreamRecord {
  readonly ApproximateCreationDateTime?: number;
  readonly Keys?: DynamoDBStreamImage;
  readonly NewImage?: DynamoDBStreamImage;
  readonly OldImage?: DynamoDBStreamImage;
  readonly SequenceNumber?: string;
  readonly SizeBytes?: number;
  readonly StreamViewType?: "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";
}

export interface DynamoDBUserIdentity {
  readonly type?: string;
  readonly principalId?: string;
}

export interface DynamoDBRecord {
  readonly awsRegion?: string;
  readonly dynamodb?: DynamoDBStreamRecord;
  readonly eventID?: string;
  readonly eventName?: "INSERT" | "MODIFY" | "REMOVE";
  readonly eventSource?: string;
  readonly eventSourceARN?: string;
  readonly eventVersion?: string;
  readonly userIdentity?: DynamoDBUserIdentity;
}

export interface DynamoDBStreamEvent {
  readonly Records: readonly DynamoDBRecord[];
}

export type UnknownEntityMode = "strict" | "tolerant";
export type EventName = "INSERT" | "MODIFY" | "REMOVE";
export type StreamViewType = "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";
export type RequiredViewType = "any" | readonly StreamViewType[];

export class StreamDecodeError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = "StreamDecodeError";
    this.code = "STREAM_DECODE_ERROR";
  }
}

export class StreamViewTypeError extends StreamDecodeError {
  constructor(message: string) {
    super(message);
    this.name = "StreamViewTypeError";
    this.code = "STREAM_VIEW_TYPE_ERROR";
  }
}

export class UnknownEntityError extends StreamDecodeError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownEntityError";
    this.code = "UNKNOWN_ENTITY_ERROR";
  }
}

export interface EntityDecoderMap {
  readonly [entityName: string]: (item: Record<string, unknown>) => unknown;
}

export interface DecodeStreamRecordOptions {
  readonly decoders: EntityDecoderMap;
  readonly unknownEntityMode?: UnknownEntityMode;
  readonly requiredViewType?: RequiredViewType;
  readonly discriminatorAttr?: string;
}

export interface DecodedStreamEvent {
  readonly eventName: EventName;
  readonly entityName?: string;
  readonly keys?: Record<string, unknown>;
  readonly newItem?: unknown;
  readonly oldItem?: unknown;
  readonly source?: string;
  readonly userIdentityType?: string;
  readonly userIdentityPrincipalId?: string;
}

function normalizeRequired(req?: RequiredViewType): readonly StreamViewType[] {
  if (req === "any") return [];
  return req ?? ["NEW_AND_OLD_IMAGES"];
}

function assertViewType(record: DynamoDBRecord, required: readonly StreamViewType[]): void {
  if (required.length === 0) return;
  const stream = record.dynamodb;
  const actual = stream?.StreamViewType as StreamViewType | undefined;
  if (!actual || !required.includes(actual)) {
    throw new StreamViewTypeError(
      `streams.decode: StreamViewType mismatch. Required one of [${required.join(", ")}], got "${actual ?? "unknown"}"`,
    );
  }
}

function parseEventName(eventName: DynamoDBRecord["eventName"]): EventName {
  if (eventName === "INSERT" || eventName === "MODIFY" || eventName === "REMOVE") {
    return eventName;
  }
  throw new StreamDecodeError(`streams.decode: Invalid eventName "${String(eventName)}"`);
}

function decodeImage(
  image: Record<string, unknown> | undefined,
  decoders: EntityDecoderMap,
  mode: UnknownEntityMode,
  discriminatorAttr: string,
): { entityName?: string; item?: unknown } {
  if (!image) return {};
  const logical = unmarshall(image as Parameters<typeof unmarshall>[0]) as Record<string, unknown>;
  const entityName = typeof logical[discriminatorAttr] === "string" ? (logical[discriminatorAttr] as string) : undefined;
  if (!entityName) {
    if (mode === "strict") {
      throw new StreamDecodeError(`streams.decode: Missing discriminator "${discriminatorAttr}" in stream image`);
    }
    return { item: logical };
  }
  const decode = decoders[entityName];
  if (!decode) {
    if (mode === "strict") {
      throw new UnknownEntityError(`streams.decode: Unknown entity discriminator "${entityName}"`);
    }
    return { entityName, item: logical };
  }
  return { entityName, item: decode(logical) };
}

export function isTtlRemove(record: Pick<DynamoDBRecord, "eventName" | "userIdentity">): boolean {
  return (
    record.eventName === "REMOVE" &&
    record.userIdentity?.type === "Service" &&
    record.userIdentity?.principalId === "dynamodb.amazonaws.com"
  );
}

export function decodeStreamRecord(record: DynamoDBRecord, options: DecodeStreamRecordOptions): DecodedStreamEvent {
  const mode = options.unknownEntityMode ?? "strict";
  const discriminatorAttr = options.discriminatorAttr ?? "entity";
  assertViewType(record, normalizeRequired(options.requiredViewType));
  const eventName = parseEventName(record.eventName);

  const keys = record.dynamodb?.Keys
    ? (unmarshall(record.dynamodb.Keys as Parameters<typeof unmarshall>[0]) as Record<string, unknown>)
    : undefined;
  const next = decodeImage(record.dynamodb?.NewImage as Record<string, unknown> | undefined, options.decoders, mode, discriminatorAttr);
  const prev = decodeImage(record.dynamodb?.OldImage as Record<string, unknown> | undefined, options.decoders, mode, discriminatorAttr);
  return {
    eventName,
    entityName: next.entityName ?? prev.entityName,
    keys,
    newItem: next.item,
    oldItem: prev.item,
    source: record.eventSource,
    userIdentityType: record.userIdentity?.type,
    userIdentityPrincipalId: record.userIdentity?.principalId,
  };
}

export function decodeStreamEvent(event: DynamoDBStreamEvent, options: DecodeStreamRecordOptions): readonly DecodedStreamEvent[] {
  return event.Records.map((record) => decodeStreamRecord(record, options));
}

export async function handleStreamByEntity(
  event: DynamoDBStreamEvent,
  options: DecodeStreamRecordOptions & {
    readonly handlers: Partial<Record<EventName, (evt: DecodedStreamEvent) => void | Promise<void>>>;
  },
): Promise<void> {
  const decoded = decodeStreamEvent(event, options);
  for (const evt of decoded) {
    const fn = options.handlers[evt.eventName];
    if (fn) await fn(evt);
  }
}
