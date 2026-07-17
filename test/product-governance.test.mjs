import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8");

test("current product documents preserve the V1.1 creator-sovereignty baseline", () => {
  const product = read("product.md");
  assert.match(product, /V1\.1 Minimum Real Intelligence Loop/);
  assert.match(product, /AI augments the creator/);
  assert.match(product, /SQLite.*only machine-state authority/s);
  assert.match(product, /Obsidian.*Markdown is\s+never machine-state authority/s);
});

test("workspace architecture separates user concerns and keeps Inbox transitional", () => {
  const runtime = read("product-runtime.md");
  for (const workspace of [
    "Today",
    "Projects",
    "Life",
    "Relationships",
    "Knowledge",
    "Evolution",
    "Activity",
  ]) {
    assert.match(runtime, new RegExp(`\\| ${workspace} \\|`));
  }
  assert.match(runtime, /`Inbox` is an intake state, not a permanent workspace/);
  assert.match(runtime, /Editing a mirror must not directly change formal state/);
});

test("proactivity remains bounded and no response never becomes consent", () => {
  const policy = read("proactivity-policy.md");
  for (const outcome of [
    "silent_record",
    "show_in_today",
    "ask_one_question",
    "request_confirmation",
    "remind_later",
    "prepare_draft",
    "stop_and_escalate",
  ]) {
    assert.match(policy, new RegExp("`" + outcome + "`"));
  }
  assert.match(policy, /No response reduces interruption level; it does not imply consent/);
  assert.match(policy, /unauthorized external actions, which must remain zero/);
});

test("personal pilot has executable phase gates before long-term use", () => {
  const plan = read("TIANSHU_PERSONAL_PILOT_PLAN_001.md");
  for (let phase = 0; phase <= 6; phase += 1) {
    assert.match(plan, new RegExp(`## Phase ${phase}:`));
  }
  assert.match(plan, /three days of controlled engineering replay/);
  assert.match(plan, /fourteen days of creator/);
  assert.match(plan, /thirty days only after creator acceptance/);
});
