import { describe, expect, it } from "vitest";
import type { DynamoDBRecord } from "../src/index.js";
import { decodeStreamRecord, isTtlRemove } from "../src/index.js";

function record(base: Partial<DynamoDBRecord>): DynamoDBRecord {
  return {
    eventID: "1",
    eventName: "REMOVE",
    eventVersion: "1.1",
    eventSource: "aws:dynamodb",
    awsRegion: "us-east-1",
    eventSourceARN: "arn:aws:dynamodb:us-east-1:123:table/t/stream/x",
    dynamodb: {},
    ...base,
  } as DynamoDBRecord;
}

describe("ttl and decode error branches", () => {
  it("returns false for non-ttl remove cases", () => {
    expect(isTtlRemove(record({ eventName: "INSERT" }))).toBe(false);
    expect(
      isTtlRemove(
        record({
          userIdentity: { type: "Service", principalId: "other.amazonaws.com" },
        }),
      ),
    ).toBe(false);
    expect(
      isTtlRemove(
        record({
          userIdentity: { type: "AssumedRole", principalId: "dynamodb.amazonaws.com" },
        }),
      ),
    ).toBe(false);
  });

  it("throws in strict mode when discriminator is missing", () => {
    expect(() =>
      decodeStreamRecord(
        record({
          eventName: "INSERT",
          dynamodb: {
            StreamViewType: "NEW_IMAGE",
            NewImage: { userId: { S: "u1" } },
          },
        }),
        { decoders: {}, requiredViewType: ["NEW_IMAGE"], unknownEntityMode: "strict" },
      ),
    ).toThrow(/Missing discriminator/);
  });

  it("returns metadata fields from the original record", () => {
    const decoded = decodeStreamRecord(
      record({
        eventName: "REMOVE",
        eventSource: "aws:dynamodb",
        userIdentity: { type: "Service", principalId: "dynamodb.amazonaws.com" },
        dynamodb: {
          StreamViewType: "KEYS_ONLY",
          Keys: { pk: { S: "USER#1" }, sk: { S: "PROFILE" } },
        },
      }),
      { decoders: {}, requiredViewType: "any", unknownEntityMode: "tolerant" },
    );

    expect(decoded.source).toBe("aws:dynamodb");
    expect(decoded.userIdentityType).toBe("Service");
    expect(decoded.userIdentityPrincipalId).toBe("dynamodb.amazonaws.com");
    expect(decoded.keys).toMatchObject({ pk: "USER#1", sk: "PROFILE" });
  });
});
