# @patternmesh/aws-sdk-v3

AWS SDK v3 adapter for `@patternmesh/core`.

It turns a `DynamoDBDocumentClient` into the `DynamoAdapter` interface used by
patternmesh repositories and transaction services.

## Install

```bash
pnpm add @patternmesh/aws-sdk-v3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Usage

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createAwsSdkV3Adapter } from "@patternmesh/aws-sdk-v3";

const base = new DynamoDBClient({ region: "us-east-1" });
const doc = DynamoDBDocumentClient.from(base);
const adapter = createAwsSdkV3Adapter(doc);
```

## Operational notes

- retries, timeouts, middleware, and credentials are configured on the AWS SDK
  client you pass in
- this adapter does not add its own logging, retry, or tracing layer
- for production settings, prefer configuring retry mode, timeouts, and
  middleware on `DynamoDBClient` / `DynamoDBDocumentClient`

### Retry mode and request timeout

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { createAwsSdkV3Adapter } from "@patternmesh/aws-sdk-v3";

const base = new DynamoDBClient({
  region: "us-east-1",
  retryMode: "adaptive",
  maxAttempts: 5,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 2_000,
    requestTimeout: 5_000,
  }),
});
const doc = DynamoDBDocumentClient.from(base);
const adapter = createAwsSdkV3Adapter(doc);
```

### DynamoDB Local endpoint

```ts
const base = new DynamoDBClient({
  region: "us-east-1",
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
```

## Batch caveat

`batchWriteItem` is a **single-table** adapter surface in this library. Mixed
tables in one request are not supported.

An empty batch write now throws instead of silently succeeding.

## Integration tests (DynamoDB Local)

```bash
docker compose up -d dynamodb-local
export DYNAMODB_ENDPOINT=http://localhost:8000
pnpm build
pnpm --filter @patternmesh/aws-sdk-v3 test
```

Without `DYNAMODB_ENDPOINT`, Local integration tests are skipped.

## Related docs

- [Repository root README](../../README.md)
- [Core package README](../core/README.md)
