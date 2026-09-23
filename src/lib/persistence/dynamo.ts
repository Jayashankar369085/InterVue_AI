// ---------------------------------------------------------------------------
// InterVue AI — DynamoDB interview store (production adapter for AWS Amplify).
//
// One item per interview in table INTERVIEWS_TABLE_NAME (default
// InterVueInterviews), partition key `interviewId` (String, no sort key).
// The full Interview object is stored under the `data` attribute as JSON.
//
// Auth: the ambient AWS credential chain (Amplify runtime IAM role in
// production, aws-sdk credential chain in local dev). No static keys.
// Region: AWS_REGION / AWS_DEFAULT_REGION (falls back to eu-north-1 where the
// table lives), overridable with INTERVIEWS_AWS_REGION.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import type { Interview, Report } from "@/types/interview";
import type { InterviewRecordStore } from "./types";

export const INTERVIEWS_TABLE = process.env.INTERVIEWS_TABLE_NAME || "InterVueInterviews";
export const INTERVIEWS_AWS_REGION =
  process.env.INTERVIEWS_AWS_REGION ||
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "eu-north-1";

type DynamoRecord = {
  interviewId: string;
  data: Interview;
  createdAt: string;
  updatedAt: string;
};

/** True when a DynamoDB error indicates the operation hit a state conflict and should be retried. */
function isConditionalCheckFailed(err: unknown): boolean {
  const e = err as { name?: string; message?: string; __retry?: boolean };
  if (e?.__retry) return true;
  return e?.name === "ConditionalCheckFailedException" || /ConditionalCheckFailed/i.test(e?.message ?? "");
}

/** True when the error is a hard failure (permissions, table missing, validation). */
function isPermanentDynamoError(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return (
    e?.name === "AccessDeniedException" ||
    e?.name === "ResourceNotFoundException" ||
    e?.name === "UnrecognizedClientException" ||
    e?.name === "ValidationException"
  );
}

export function createDynamoInterviewStore(): InterviewRecordStore {
  // Lazy singleton so the SDK only loads on first use (keeps cold start lean
  // and avoids importing AWS SDK in edge/browser bundles).
  let clientPromise: Promise<{
    send: (cmd: unknown) => Promise<unknown>;
  }> | null = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
        const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
        const base = new DynamoDBClient({
          region: INTERVIEWS_AWS_REGION,
          maxAttempts: 2,
        });
        // `remove` marshalling so the Interview JSON (incl. empty strings and
        // arrays) round-trips exactly as stored by the rest of the app.
        const doc = DynamoDBDocumentClient.from(base, {
          marshallOptions: { removeUndefinedValues: true },
        });
        return doc as unknown as { send: (cmd: unknown) => Promise<unknown> };
      })();
    }
    return clientPromise;
  }

  async function run<T>(op: string, id: string | null, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { name?: string; message?: string };
      console.error("[store:dynamo]", op, id ?? "-", e?.name ?? "Error", e?.message ?? err);
      throw err;
    }
  }

  async function putWithVersion(
    client: { send: (cmd: unknown) => Promise<unknown> },
    record: DynamoRecord,
    expectedVersion: number,
  ): Promise<void> {
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
    await client.send(
      new PutCommand({
        TableName: INTERVIEWS_TABLE,
        Item: { ...record, version: expectedVersion + 1 },
        ConditionExpression: "attribute_not_exists(interviewId) OR version = :v",
        ExpressionAttributeValues: { ":v": expectedVersion },
      }),
    );
  }

  const store: InterviewRecordStore = {
    async createInterview(input) {
      const client = await getClient();
      const now = new Date().toISOString();
      const interview: Interview = { ...input, id: randomUUID(), created_at: now, updated_at: now };
      const record: DynamoRecord = {
        interviewId: interview.id,
        data: interview,
        createdAt: now,
        updatedAt: now,
      };
      await run("create", interview.id, async () => {
        // Create must not overwrite an existing item (UUID collision would be
        // catastrophic). attribute_not_exists is a free safety net.
        const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
        await client.send(
          new PutCommand({
            TableName: INTERVIEWS_TABLE,
            Item: { ...record, version: 1 },
            ConditionExpression: "attribute_not_exists(interviewId)",
          }),
        );
      });
      return interview;
    },

    async getInterview(id) {
      const client = await getClient();
      return run("get", id, async () => {
        const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
        const out = (await client.send(
          new GetCommand({ TableName: INTERVIEWS_TABLE, Key: { interviewId: id } }),
        )) as { Item?: DynamoRecord & { version?: number } };
        return out.Item?.data ?? null;
      });
    },

    async updateInterview(id, mutator) {
      const client = await getClient();
      return run("update", id, async () => {
        const { GetCommand, PutCommand } = await import("@aws-sdk/lib-dynamodb");
        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const out = (await client.send(
            new GetCommand({ TableName: INTERVIEWS_TABLE, Key: { interviewId: id } }),
          )) as { Item?: DynamoRecord & { version?: number } };
          const item = out.Item;
          if (!item?.data) return null;

          const current = structuredClone(item.data) as Interview;
          const next = mutator(current);
          next.updated_at = new Date().toISOString();

          const expected = item.version ?? 1;
          try {
            await putWithVersion(client, {
              interviewId: id,
              data: next,
              createdAt: item.createdAt ?? next.created_at,
              updatedAt: next.updated_at,
            }, expected);
            return next;
          } catch (err) {
            if (isConditionalCheckFailed(err) && attempt < maxAttempts) {
              // Another writer won the race; retry with fresh state.
              await new Promise((r) => setTimeout(r, 25 * attempt));
              continue;
            }
            throw err;
          }
        }
        return null; // unreachable, but satisfies TS
      });
    },

    async listInterviews(limit = 50) {
      const client = await getClient();
      return run("list", null, async () => {
        // Table has no sort key; a Scan sorted in memory is correct at this
        // scale. If the table grows, add a GSI on createdAt (id-only
        // projection) and switch to QueryCommand.
        const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
        const out = (await client.send(
          new ScanCommand({ TableName: INTERVIEWS_TABLE, Limit: Math.max(limit * 3, 50) }),
        )) as { Items?: DynamoRecord[] };
        const items = (out.Items ?? [])
          .map((r) => r.data)
          .filter(Boolean)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return items.slice(0, limit);
      });
    },

    async saveReport(id, report) {
      const client = await getClient();
      return run("saveReport", id, async () => {
        const { GetCommand, PutCommand } = await import("@aws-sdk/lib-dynamodb");
        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const out = (await client.send(
            new GetCommand({ TableName: INTERVIEWS_TABLE, Key: { interviewId: id } }),
          )) as { Item?: DynamoRecord & { version?: number } };
          const item = out.Item;
          if (!item?.data) return null;
          const next = { ...(item.data as Interview), report, status: "completed" as const };
          next.updated_at = new Date().toISOString();
          try {
            await putWithVersion(client, {
              interviewId: id,
              data: next,
              createdAt: item.createdAt ?? next.created_at,
              updatedAt: next.updated_at,
            }, item.version ?? 1);
            return next as Interview;
          } catch (err) {
            if (isConditionalCheckFailed(err) && attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 25 * attempt));
              continue;
            }
            throw err;
          }
        }
        return null;
      });
    },
  };

  return store;
}

// Re-exported for callers that want to probe adapter type (e.g. health checks).
export { isPermanentDynamoError };
