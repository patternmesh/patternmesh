import { describe, expect, it } from "vitest";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "../src/index.js";
import { handleStreamByEntity } from "../src/index.js";

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

describe("handler routing", () => {
  it("no-ops when handler for event is not registered", async () => {
    const seen: string[] = [];
    const event: DynamoDBStreamEvent = {
      Records: [
        record({
          eventName: "MODIFY",
          dynamodb: {
            StreamViewType: "NEW_IMAGE",
            NewImage: { entity: { S: "User" }, userId: { S: "u1" } },
          },
        }),
      ],
    };

    await handleStreamByEntity(event, {
      decoders: { User: (item) => item },
      requiredViewType: ["NEW_IMAGE"],
      handlers: {
        INSERT: async () => {
          seen.push("insert");
        },
      },
    });

    expect(seen).toEqual([]);
  });

  it("preserves processing order and propagates handler errors", async () => {
    const seen: string[] = [];
    const event: DynamoDBStreamEvent = {
      Records: [
        record({
          eventName: "INSERT",
          dynamodb: {
            StreamViewType: "NEW_IMAGE",
            NewImage: { entity: { S: "User" }, userId: { S: "u1" } },
          },
        }),
        record({
          eventName: "INSERT",
          dynamodb: {
            StreamViewType: "NEW_IMAGE",
            NewImage: { entity: { S: "User" }, userId: { S: "u2" } },
          },
        }),
      ],
    };

    await expect(
      handleStreamByEntity(event, {
        decoders: { User: (item) => item },
        requiredViewType: ["NEW_IMAGE"],
        handlers: {
          INSERT: async (evt) => {
            const id = (evt.newItem as { userId?: string }).userId ?? "none";
            seen.push(id);
            if (id === "u2") throw new Error("boom");
          },
        },
      }),
    ).rejects.toThrow(/boom/);

    expect(seen).toEqual(["u1", "u2"]);
  });
});
