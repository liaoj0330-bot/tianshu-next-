import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openStore } from "../src/core/store.mjs";
import {
  answerStateQuestion,
  buildStateDecisionCard,
  createStateSubject,
  decideStateUpdate,
  getCurrentState,
  listStateHistory,
  proposeStateUpdate,
  renderStateDecisionCardMarkdown,
} from "../src/state/dynamic-state.mjs";

function argument(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (required && !value) throw new Error(`missing --${name}`);
  return value;
}

function loadInput(required = true) {
  const path = argument("input", required);
  return path ? JSON.parse(readFileSync(resolve(path), "utf8")) : null;
}

const command = process.argv[2];
const dbPath = resolve(argument("db"));
const db = openStore(dbPath);

try {
  let result;
  if (command === "init") {
    result = createStateSubject(db, loadInput());
  } else if (command === "propose") {
    const subjectId = argument("subject");
    result = proposeStateUpdate(db, subjectId, loadInput());
    const output = argument("output", false);
    if (output) renderStateDecisionCardMarkdown(db, result.cycle_id, resolve(output));
  } else if (command === "decide") {
    const input = loadInput();
    result = decideStateUpdate(db, input.cycle_id, input.decision, input);
  } else if (command === "answer") {
    const input = loadInput();
    answerStateQuestion(db, input.subject_id, input.question_key, input.answer, input.answered_by);
    result = { status: "answered", question_key: input.question_key };
  } else if (command === "card") {
    const cycleId = argument("cycle");
    result = buildStateDecisionCard(db, cycleId);
    const output = argument("output", false);
    if (output) renderStateDecisionCardMarkdown(db, cycleId, resolve(output));
  } else if (command === "show") {
    const subjectId = argument("subject");
    result = {
      current: getCurrentState(db, subjectId),
      history: listStateHistory(db, subjectId),
      pending_questions: db.prepare(`
        SELECT question_key, question_text, why_it_matters, asked_at
        FROM state_questions WHERE subject_id = ? AND status = 'pending'
        ORDER BY asked_at
      `).all(subjectId),
    };
  } else {
    throw new Error("command must be init, propose, decide, answer, card, or show");
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
