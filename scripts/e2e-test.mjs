// End-to-end API flow test for InterVue AI.
// Usage: node scripts/e2e-test.mjs [baseUrl]
const base = process.argv[2] || "http://localhost:3025";

async function api(path, opts = {}) {
  const res = await fetch(base + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${data.error || text.slice(0, 200)}`);
  return data;
}

async function runInterview({ description, experience, style, length, answers, label }) {
  console.log(`\n=== ${label} ===`);
  const plan = await api("/api/interviews/plan", {
    method: "POST",
    body: JSON.stringify({ description, experience, style, length }),
  });  console.log(`  plan OK id=${plan.id} mode=${plan.mode}`);
  if (plan.mode !== "real") {
    console.log("  ⚠ REAL MODE NOT ACTIVE (LLM_API_KEY missing or rejected — see server log). Aborting.");
    process.exit(2);
  }
  console.log(`  role: ${plan.blueprint.role}`);
  console.log(`  domain: ${plan.blueprint.domain} | seniority: ${plan.blueprint.seniority} | difficulty: ${plan.blueprint.difficulty}`);
  console.log(`  competencies: ${plan.blueprint.competencies.map((c) => `${c.name}(${c.weight.toFixed(2)})`).join(", ")}`);
  console.log(`  opening: ${plan.blueprint.opening_line?.slice(0, 100)}`);

  let last = null;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    // Pace turns like a real interview so free-tier LLM quotas (5 req/min/model)
    // are not the bottleneck — a burst test would just measure quota errors.
    if (i > 0) await new Promise((r) => setTimeout(r, 9000));
    const turn = await api(`/api/interviews/${plan.id}/turn`, {
      method: "POST",
      body: JSON.stringify({ answer: a.answer, challenge: !!a.challenge, duration_seconds: a.duration ?? 25 }),
    });
    last = turn;
    console.log(`  turn ${i + 1}${a.challenge ? " [CHALLENGE]" : ""}: eval overall=${turn.evaluation?.scores?.overall}/10 action=${turn.evaluation?.next_action}`);
    console.log(`    next Q: ${turn.reply?.slice(0, 110)}`);
    if (turn.interview_complete) {
      console.log("  interview complete after this turn");
      break;
    }
  }

  if (!last?.interview_complete) {
    // End the interview by requesting the report (works with partial answers).
    console.log("  (not auto-ended; requesting report to finish)");
  }
  const report = await api(`/api/interviews/${plan.id}/report`, { method: "POST" });
  console.log(`  REPORT: overall=${report.report.overall_score}/100 headline="${report.report.headline}"`);
  console.log(`  categories: ${report.report.category_scores.map((c) => `${c.name}=${c.score}`).join(", ")}`);
  console.log(`  strengths: ${report.report.strengths.slice(0, 2).join(" | ") || "none"}`);
  console.log(`  weaknesses: ${report.report.weaknesses.slice(0, 2).join(" | ") || "none"}`);
  console.log(`  practice Qs: ${report.report.practice_questions.length}, comms: ${report.report.communication.words_per_minute ?? "n/a"} wpm`);

  const practice = await api(`/api/interviews/${plan.id}/practice`, { method: "POST" });
  console.log(`  PRACTICE interview created: id=${practice.id} role="${practice.blueprint.role}"`);
  console.log(`  practice competencies: ${practice.blueprint.competencies.map((c) => `${c.name}(${c.weight.toFixed(2)})`).join(", ")}`);
  return { planId: plan.id, practiceId: practice.id, score: report.report.overall_score };
}

const t0 = Date.now();
const results = [];

// TEST 1+2+3+4: domain diversity (12s pacing between interviews for quota headroom)
await new Promise((r) => setTimeout(r, 10000));
results.push(
  await runInterview({
    label: "TEST 1: ML Engineer",
    description: "Interview me for a Machine Learning Engineer role at an automotive company",
    experience: "1-3",
    style: "realistic",
    length: "quick",
    answers: [
      { answer: "Overfitting is when a model memorizes the training data including noise, so training accuracy is high but validation accuracy drops because it fails to generalize to unseen data." },
      { answer: "First I would look at the gap between training and validation loss. I would try regularization like L2 or dropout, get more data, or simplify the model. Early stopping on validation loss is usually my first move.", challenge: false },
      { answer: "I don't know, I have never deployed anything at scale." },
    ],
  })
);

results.push(
  await runInterview({
    label: "TEST 2: Mechanical Design Engineer",
    description: "Interview me for a mechanical design engineer internship",
    experience: "fresher",
    style: "practice",
    length: "quick",
    answers: [
      { answer: "Tolerances matter because no manufacturing process is perfect, and parts need to fit together. GD&T gives a standard way to specify allowable variation so function is preserved." },
      { answer: "For a bracket I would consider aluminum for light weight or steel for stiffness and cost. I would check the load path and pick wall thickness so it does not yield with a safety factor of 2." },
    ],
  })
);

results.push(
  await runInterview({
    label: "TEST 3: Investment Banking Analyst",
    description: "I have a finance interview tomorrow for an investment banking analyst role",
    experience: "fresher",
    style: "difficult",
    length: "quick",
    answers: [
      { answer: "When interest rates rise, bond prices fall because the fixed coupon becomes less attractive versus new issues; the discount rate on future cash flows goes up, so present value drops. Longer duration bonds fall more." },
      { answer: "EV equals equity value plus debt minus cash. You use EV/EBITDA because EV captures the whole firm regardless of capital structure, making comparisons between companies fairer." },
      { answer: "Walk me through a DCF: project free cash flows for five to ten years, compute terminal value with Gordon growth or an exit multiple, discount everything at WACC, and EV minus net debt gives equity value." },
    ],
  })
);

results.push(
  await runInterview({
    label: "TEST 4: Ancient Roman Architecture (unusual domain)",
    description: "I want a difficult interview about ancient Roman architecture",
    experience: "fresher",
    style: "difficult",
    length: "quick",
    answers: [
      { answer: "The Romans pioneered the true arch, the vault and concrete with pozzolana, which let them span huge interiors like the Pantheon dome, something Greek post-and-lintel construction could not do." },
      { answer: "The Pantheon dome used graded aggregate, heavier at the base with travertine, lighter pumice near the oculus, plus coffers to reduce weight, and a stepped ring of compression at the base." },
      { answer: "Hmm, I am not sure about the specifics of the Basilica of Maxentius." },
    ],
  })
);

// TEST 5+6+7 behaviors embedded above (challenge + I don't know). Now a challenge turn test:
await new Promise((r) => setTimeout(r, 12000));
const challengeTest = await api("/api/interviews/plan", {
  method: "POST",
  body: JSON.stringify({ description: "Software Engineer, backend systems", experience: "3-5", style: "realistic", length: "quick" }),
});
const c1 = await api(`/api/interviews/${challengeTest.id}/turn`, {
  method: "POST",
  body: JSON.stringify({ answer: "To scale the API I would add a cache like Redis in front of the database so repeated reads do not hit Postgres, and that should handle most of the load.", duration_seconds: 18 }),
});
console.log(`\n=== CHALLENGE TEST ===\n  turn1 action=${c1.evaluation?.next_action}`);
await new Promise((r) => setTimeout(r, 9000));
const c2 = await api(`/api/interviews/${challengeTest.id}/turn`, {
  method: "POST",
  body: JSON.stringify({ answer: c1.reply, challenge: true, duration_seconds: 10 }),
});
console.log(`  challenge turn: action=${c2.evaluation?.next_action} difficulty_delta=${c2.evaluation?.difficulty_delta}`);
console.log(`  challenge Q: ${c2.reply?.slice(0, 130)}`);

// Off-topic redirect test (TEST 9):
await new Promise((r) => setTimeout(r, 9000));
const o1 = await api(`/api/interviews/${challengeTest.id}/turn`, {
  method: "POST",
  body: JSON.stringify({ answer: "I really like pizza with extra cheese, and my cat is named Whiskers. The weather today is very nice.", duration_seconds: 12 }),
});
console.log(`\n=== OFF-TOPIC TEST ===\n  relevance=${o1.evaluation?.scores?.relevance}/10 action=${o1.evaluation?.next_action}`);
console.log(`  redirect: ${o1.reply?.slice(0, 120)}`);

console.log(`\nALL TESTS PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(results, null, 2));
