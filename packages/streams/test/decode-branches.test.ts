import { describe, expect, it } from "vitest";
import type { DynamoDBRecord } from "../src/index.js";
import { decodeStreamRecord } from "../src/index.js";

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

describe("decode stream branches", () => {
  it("accepts default required view type NEW_AND_OLD_IMAGES", () => {
    const decoded = decodeStreamRecord(
      record({
        eventName: "MODIFY",
        dynamodb: {
          StreamViewType: "NEW_AND_OLD_IMAGES",
          NewImage: { entity: { S: "User" }, userId: { S: "u1" } },
          OldImage: { entity: { S: "User" }, userId: { S: "u1_old" } },
          Keys: { pk: { S: "USER#u1" }, sk: { S: "PROFILE" } },
        },
      }),
      { decoders: { User: (v) => v } },
    );
    expect(decoded.keys).toMatchObject({ pk: "USER#u1", sk: "PROFILE" });
    expect(decoded.entityName).toBe("User");
  });

  it("allows any required view type bypass", () => {
    const decoded = decodeStreamRecord(
      record({
        eventName: "INSERT",
        dynamodb: {
          StreamViewType: "KEYS_ONLY",
          Keys: { pk: { S: "USER#u1" }, sk: { S: "PROFILE" } },
        },
      }),
      { decoders: {}, requiredViewType: "any", unknownEntityMode: "tolerant" },
    );
    expect(decoded.eventName).toBe("INSERT");
    expect(decoded.newItem).toBeUndefined();
  });

  it("supports custom discriminator and decoder transform", () => {
    const decoded = decodeStreamRecord(
      record({
        eventName: "INSERT",
        dynamodb: {
          StreamViewType: "NEW_IMAGE",
          NewImage: {
            kind: { S: "Invoice" },
            id: { S: "inv_1" },
          },
        },
      }),
      {
        decoders: {
          Invoice: (item) => ({ ...item, tagged: true }),
        },
        discriminatorAttr: "kind",
        requiredViewType: ["NEW_IMAGE"],
      },
    );
    expect(decoded.entityName).toBe("Invoice");
    expect(decoded.newItem).toMatchObject({ id: "inv_1", tagged: true });
  });

  it("supports tolerant missing discriminator branch", () => {
    const decoded = decodeStreamRecord(
      record({
        eventName: "INSERT",
        dynamodb: {
          StreamViewType: "NEW_IMAGE",
          NewImage: { id: { S: "no_entity" } },
        },
      }),
      {
        decoders: {},
        unknownEntityMode: "tolerant",
        requiredViewType: ["NEW_IMAGE"],
      },
    );
    expect(decoded.entityName).toBeUndefined();
    expect(decoded.newItem).toMatchObject({ id: "no_entity" });
  });
});
