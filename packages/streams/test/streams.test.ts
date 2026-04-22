import { describe, expect, it } from "vitest";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "../src/index.js";
import {
  decodeStreamEvent,
  decodeStreamRecord,
  handleStreamByEntity,
  isTtlRemove,
} from "../src/index.js";

function record(base: Partial<DynamoDBRecord>): DynamoDBRecord {
  return {
    eventID: "1",
    eventName: "MODIFY",
    eventVersion: "1.1",
    eventSource: "aws:dynamodb",
    awsRegion: "us-east-1",
    eventSourceARN: "arn:aws:dynamodb:us-east-1:123:table/t/stream/x",
    dynamodb: {},
    ...base,
  } as DynamoDBRecord;
}

describe("@patternmeshjs/streams", () => {
  it("decodes new and old images with entity routing", () => {
    const r = record({
      eventName: "MODIFY",
      dynamodb: {
        StreamViewType: "NEW_AND_OLD_IMAGES",
        Keys: { pk: { S: "USER#1" }, sk: { S: "USER#1" } },
        NewImage: { entity: { S: "User" }, userId: { S: "usr_1" }, ttlAt: { N: "1735689600" } },
        OldImage: { entity: { S: "User" }, userId: { S: "usr_1" }, ttlAt: { N: "1735680000" } },
      },
    });
    const decoded = decodeStreamRecord(r, {
      decoders: {
        User: (item) => item,
      },
      requiredViewType: ["NEW_AND_OLD_IMAGES"],
    });
    expect(decoded.entityName).toBe("User");
    expect(decoded.newItem).toMatchObject({ userId: "usr_1", ttlAt: 1735689600 });
    expect(decoded.oldItem).toMatchObject({ userId: "usr_1", ttlAt: 1735680000 });
  });

  it("supports tolerant unknown entity mode", () => {
    const r = record({
      eventName: "INSERT",
      dynamodb: {
        StreamViewType: "NEW_IMAGE",
        NewImage: { entity: { S: "Ghost" }, foo: { S: "bar" } },
      },
    });
    const decoded = decodeStreamRecord(r, {
      decoders: {},
      unknownEntityMode: "tolerant",
      requiredViewType: "any",
    });
    expect(decoded.entityName).toBe("Ghost");
    expect(decoded.newItem).toMatchObject({ foo: "bar" });
  });

  it("fails in strict mode for unknown entity", () => {
    const r = record({
      eventName: "INSERT",
      dynamodb: {
        StreamViewType: "NEW_IMAGE",
        NewImage: { entity: { S: "Ghost" }, foo: { S: "bar" } },
      },
    });
    expect(() =>
      decodeStreamRecord(r, {
        decoders: {},
        unknownEntityMode: "strict",
        requiredViewType: "any",
      }),
    ).toThrow(/Unknown entity discriminator/);
  });

  it("fails on stream view type mismatch", () => {
    const r = record({
      eventName: "INSERT",
      dynamodb: {
        StreamViewType: "KEYS_ONLY",
      },
    });
    expect(() =>
      decodeStreamRecord(r, {
        decoders: {},
        requiredViewType: ["NEW_IMAGE", "NEW_AND_OLD_IMAGES"],
      }),
    ).toThrow(/StreamViewType mismatch/);
  });

  it("handles event wrapper", () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        record({
          eventName: "REMOVE",
          dynamodb: {
            StreamViewType: "OLD_IMAGE",
            OldImage: { entity: { S: "User" }, userId: { S: "usr_2" } },
          },
        }),
      ],
    };
    const [decoded] = decodeStreamEvent(event, {
      decoders: { User: (i) => i },
      requiredViewType: "any",
    });
    expect(decoded.eventName).toBe("REMOVE");
    expect(decoded.oldItem).toMatchObject({ userId: "usr_2" });
  });

  it("detects ttl-driven remove events", () => {
    const r = record({
      eventName: "REMOVE",
      userIdentity: {
        type: "Service",
        principalId: "dynamodb.amazonaws.com",
      },
    });
    expect(isTtlRemove(r)).toBe(true);
  });

  it("fails by default on keys-only streams", () => {
    const r = record({
      eventName: "MODIFY",
      dynamodb: {
        StreamViewType: "KEYS_ONLY",
        Keys: { pk: { S: "USER#1" } },
      },
    });
    expect(() => decodeStreamRecord(r, { decoders: {} })).toThrow(/StreamViewType mismatch/);
  });

  it("routes decoded events through handlers", async () => {
    const seen: string[] = [];
    const event: DynamoDBStreamEvent = {
      Records: [
        record({
          eventName: "INSERT",
          dynamodb: {
            StreamViewType: "NEW_IMAGE",
            NewImage: { entity: { S: "User" }, userId: { S: "usr_3" } },
          },
        }),
      ],
    };

    await handleStreamByEntity(event, {
      decoders: { User: (item) => item },
      requiredViewType: ["NEW_IMAGE"],
      handlers: {
        INSERT: async (evt) => {
          seen.push(String((evt.newItem as { userId?: string }).userId));
        },
      },
    });

    expect(seen).toEqual(["usr_3"]);
  });

  it("rejects unsupported event names", () => {
    expect(() =>
      decodeStreamRecord(record({ eventName: "UNKNOWN" as never }), {
        decoders: {},
        requiredViewType: "any",
      }),
    ).toThrow(/Invalid eventName/);
  });
});
