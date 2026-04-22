# Table setup

patternmesh does **not** create or migrate DynamoDB tables for you.

Your runtime table must already exist, and its key/index layout must match the
shape declared with `defineTable(...)`.

## Minimum requirements

If you write:

```ts
const AppTable = defineTable({
  name: "app",
  partitionKey: "pk",
  sortKey: "sk",
  indexes: {
    GSI1: { partitionKey: "gsi1pk", sortKey: "gsi1sk", type: "GSI" },
  },
  localIndexes: {
    LSI1: { partitionKey: "pk", sortKey: "lsi1sk", type: "LSI" },
  },
});
```

then your real table must have:

- table name `app`
- partition key attribute `pk`
- sort key attribute `sk`
- a GSI named `GSI1` using `gsi1pk` / `gsi1sk`
- an LSI named `LSI1` using `pk` / `lsi1sk`

## Important notes

- LSIs must exist at table-creation time
- GSIs and LSIs use DynamoDB's normal throughput, projection, and consistency
  rules
- `defineTable(...)` is a modeling contract, not a migration engine

## Recommended workflow

1. define the table contract in code with `defineTable(...)`
2. create the table with CloudFormation, CDK, Terraform, or your infra tool
3. run a smoke test against the live table or DynamoDB Local
4. keep infra and code changes in the same review when possible

## Example: AWS CDK

The CDK example below creates a table that matches the `defineTable` call
above. Attribute types use `STRING` because patternmesh emits string-valued
partition and sort keys by default.

```ts
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class AppTableStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "AppTable", {
      tableName: "app",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    table.addLocalSecondaryIndex({
      indexName: "LSI1",
      sortKey: { name: "lsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
```

## Example: CloudFormation (YAML)

```yaml
Resources:
  AppTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: app
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
        - AttributeName: sk
          AttributeType: S
        - AttributeName: gsi1pk
          AttributeType: S
        - AttributeName: gsi1sk
          AttributeType: S
        - AttributeName: lsi1sk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      GlobalSecondaryIndexes:
        - IndexName: GSI1
          KeySchema:
            - AttributeName: gsi1pk
              KeyType: HASH
            - AttributeName: gsi1sk
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
      LocalSecondaryIndexes:
        - IndexName: LSI1
          KeySchema:
            - AttributeName: pk
              KeyType: HASH
            - AttributeName: lsi1sk
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
```

## Local development

The repo includes a DynamoDB Local compose file:

```bash
docker compose up -d dynamodb-local
export DYNAMODB_ENDPOINT=http://localhost:8000
```

Adapter integration tests are skipped when `DYNAMODB_ENDPOINT` is unset.

You still need to create the table inside DynamoDB Local (for example with the
AWS CLI or a CDK deploy pointed at the local endpoint). patternmesh will not
do this for you.
