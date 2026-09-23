// ---------------------------------------------------------------------------
// DynamoDB persistence smoke test for InterVue AI.
//
// Verifies the full lifecycle against the real table:
//   CREATE → SAVE → RETRIEVE → UPDATE → ANSWERS → COMPLETE → RETRIEVE
// plus a CAS race probe (concurrent updates must serialize, never lose data).
//
// Run:  node scripts/dynamo-smoke.mjs
// Needs: INTERVIEWS_TABLE_NAME (default InterVueInterviews) + AWS credentials
//        (Amplify runtime role in production; for local runs use any of:
//        aws login profile, SSO, or short-lived env creds — never commit keys).
// ---------------------------------------------------------------------------

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const TABLE = process.env.INTERVIEWS_TABLE_NAME || "InterVueInterviews";
const REGION =
  process.env.INTERVIEWS_AWS_REGION || process.env.AWS_REGION || "eu-north-1";

const client = new DynamoDBClient({ region: REGION });

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

async function getItem(id) {
  const out = await client.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: marshall({ interviewId: id }),
      ConsistentRead: true,
    }),
  );
  return out.Item ? unmarshall(out.Item) : null;
}

async function putRaw(item) {
  await client.send(
    new PutItemCommand({ TableName: TABLE, Item: marshall(item, { removeUndefinedValues: true }) }),
  );
}

async function main() {
  log("env", `table=${TABLE} region=${REGION}`);
  const interviewId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1) CREATE — what POST /api/interviews/plan does on success.
  const now = new Date().toISOString();
  const interview = {
    id: interviewId,
    created_at: now,
    updated_at: now,
    status: "in_progress",
    plan: {
      domain: "Smoke Test Domain",
      role: "Persistence QA Engineer",
      seniority: "Entry Level",
      difficulty: "medium",
      competencies: [{ name: "Persistence", weight: 1 }],
      target_questions: 5,
      interview_phase: "TECHNICAL",
      substantive_asked: 0,
      opening_line: "Smoke test opening.",
    },
    qa: [],
  };
  await putRaw({
    interviewId,
    data: interview,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  log("CREATE", `wrote item ${interviewId}`);

  // 2) RETRIEVE
  const afterCreate = await getItem(interviewId);
  if (!afterCreate?.data?.id) throw new Error("CREATE/GET round-trip failed");
  log("RETRIEVE", "item read back intact");

  // 3) UPDATE — simulate the version-CAS update path used by /turn.
  const v1 = afterCreate.version;
  const updated = structuredClone(afterCreate);
  updated.data.qa.push({
    question: "Q1: How does the adapter serialize updates?",
    answer: "Optimistic version conditional with bounded retry.",
    evaluated: true,
  });
  updated.data.plan.substantive_asked = 1;
  updated.version = v1 + 1;
  updated.updatedAt = new Date().toISOString();
  await putRaw(updated);
  log("UPDATE", `qa=1 substantive_asked=1 version ${v1}→${v1 + 1}`);

  // 4) CAS race probe: stale writer must NOT overwrite the newer state.
  const stale = structuredClone(updated);
  stale.version = v1; // stale version on purpose
  stale.data.plan.substantive_asked = 99;
  let staleWriteRejected = false;
  try {
    const { UpdateItemCommand } = await import("@aws-sdk/client-dynamodb");
    // Emulate the adapter's conditional put with an UpdateItem CAS on version.
    await client.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: marshall({ interviewId }),
        UpdateExpression: "SET #d = :d, version = :v",
        ConditionExpression: "version = :expected",
        ExpressionAttributeNames: { "#d": "data" },
        ExpressionAttributeValues: marshall({
          ":d": stale.data,
          ":v": stale.version + 1,
          ":expected": stale.version,
        }),
        ConditionExpressionName: undefined,
      }),
    );
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") staleWriteRejected = true;
    else throw err;
  }
  const afterStale = await getItem(interviewId);
  if (!staleWriteRejected || afterStale.data.plan.substantive_asked !== 1) {
    throw new Error("CAS check FAILED: stale writer was able to overwrite newer state");
  }
  log("CAS", "stale write rejected — newer state preserved");

  // 5) COMPLETE + RETRIEVE final state (what /report does).
  const final = structuredClone(afterStale);
  final.data.status = "completed";
  final.data.report = { overall_score: 87, note: "smoke-test report" };
  final.version = afterStale.version + 1;
  final.updatedAt = new Date().toISOString();
  await putRaw(final);

  const done = await getItem(interviewId);
  if (done.data.status !== "completed" || done.data.report?.overall_score !== 87) {
    throw new Error("COMPLETE/FINAL-RETRIEVE failed");
  }
  log("COMPLETE", "status=completed, report persisted");
  log("RESULT", "ALL SMOKE TESTS PASSED");

  // 6) Cleanup the smoke item so the table stays clean.
  const { DeleteItemCommand } = await import("@aws-sdk/client-dynamodb");
  await client.send(
    new DeleteItemCommand({ TableName: TABLE, Key: marshall({ interviewId }) }),
  );
  log("CLEANUP", `deleted ${interviewId}`);
}

main().catch((err) => {
  console.error("[SMOKE FAILED]", err?.name ?? "", err?.message ?? err);
  process.exit(1);
});
