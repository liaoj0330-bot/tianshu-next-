# TianShu Proactivity Policy

Status: current
Updated: 2026-07-15

## Principle

Proactivity means identifying the right moment for attention, not maximizing
notifications or autonomous action. TianShu should reduce creator attention
cost while preserving creator control.

## Allowed proactive outcomes

| Outcome | Meaning |
| --- | --- |
| `silent_record` | Preserve evidence without interrupting the creator. |
| `show_in_today` | Surface an item in the next Today view. |
| `ask_one_question` | Ask the single question with the highest decision value. |
| `request_confirmation` | Present a candidate that may change formal state. |
| `remind_later` | Defer attention to an explicit time or condition. |
| `prepare_draft` | Prepare reversible work but perform no external action. |
| `stop_and_escalate` | Stop because risk, conflict, or uncertainty is too high. |

## Decision factors

The policy must consider importance, urgency, confidence, novelty, repetition,
prior rejection, interruption cost, reversibility, authorization, and the cost
of missing the event.

## Default rules

1. Low-confidence observations are recorded or clarified, never executed.
2. Repeated information is deduplicated and does not create repeated prompts.
3. A rejected suggestion is suppressed until new evidence or an explicit
   review condition exists.
4. No response reduces interruption level; it does not imply consent.
5. At most one proactive question is presented as the primary Today question.
6. Identity, long-term memory, external communication, deletion, publication,
   payment, and deployment always require explicit confirmation.
7. Protected projects remain unreadable and non-dispatchable even when urgency
   is high.
8. Every proactive item records its trigger, evidence, policy outcome, and
   later creator response in SQLite.

## Pilot metrics

- suggestion acceptance rate;
- correction rate;
- repeated-question rate;
- unnecessary-interruption rate;
- ignored-item rate;
- incorrect-long-term-memory rate;
- judgment-improvement rate;
- recovery rate;
- unauthorized external actions, which must remain zero.
