/** Max keys per BatchGetItem `RequestItems` entry (DynamoDB limit). */
export const BATCH_GET_MAX_KEYS = 100;

/** Max write requests per BatchWriteItem call (DynamoDB limit). */
export const BATCH_WRITE_MAX_OPS = 25;

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
