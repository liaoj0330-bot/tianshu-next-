# TianShu V1.1 Personal Pilot Plan

Status: active plan
Updated: 2026-07-15

## Goal

Make TianShu useful to its creator through repeated real use, then improve it
from evidence rather than assumptions. Each phase requires executable tests and
recorded evidence before the next phase begins.

## Phase 0: Freeze and align

Deliverables: current product definition, product runtime and workspace
information architecture, proactivity policy, experience system, current
decision log, and automated governance checks.

Exit gate: existing full tests pass; governance checks pass; runtime behavior
does not change; current documents supersede conflicting historical completion
claims.

## Phase 1: SQLite workspace read model

Deliverables: workspace classification contract; source, confidence, and
decision state persistence; separate Today, Projects, Life, Relationships,
Knowledge, Evolution, and Activity projections; visible unresolved Inbox.

Exit gate: tests cover classification, ambiguity, correction, protection, and
restart persistence; no cross-workspace contamination; SQLite stays authoritative.

## Phase 2: Governed Obsidian reporting

Deliverables: report intake contract; content hash, source, and idempotency;
fact, uncertainty, and candidate extraction; confirmation before formal state;
reproducible readable mirrors.

Exit gate: duplicate reports do not duplicate state; mirror edits cannot mutate
SQLite; deleted mirrors regenerate equivalently; malformed and conflicting
reports are tested.

## Phase 3: Feedback and evolution loop

Deliverables: judgment context and evidence; accept, correct, reject, defer, and
ignore feedback; outcome review; versioned experience candidates; disclosure of
experience used by later judgments.

Exit gate: one scenario runs twice; the second judgment uses accepted experience
from the first; rejected or contradicted experience has no effect.

## Phase 4: Cognitive cockpit interaction

Deliverables: Today, Decision, Action, and Evolution views; cognitive-stage and
authorization indicators; loading, empty, offline, conflict, failure, retry,
recovery, and long-text states; optional audit detail without primary raw JSON.

Exit gate: the creator completes a day without SQLite, terminal output, or raw
JSON; desktop and mobile paths pass; screenshots pass creator visual review.

## Phase 5: Proactivity engine

Deliverables: auditable proactive outcomes; deduplication, cooldown, rejection
suppression, deferral, quiet periods, and daily interruption limits; one daily
review trigger and project-change trigger; no-response never implies consent.

Exit gate: all outcomes and suppression rules are tested; a three-day engineering
replay has no duplicate prompts or unauthorized action; triggers and responses
are traceable in SQLite.

## Phase 6: Personal pilot

Sequence: three days of controlled engineering replay, fourteen days of creator
use with daily closure, then thirty days only after creator acceptance.

Evidence: daily focus usefulness; accepted, corrected, rejected, deferred, and
ignored items; interruption quality; repeated questions; memory and evolution
errors; judgment improvement; recovery; creator operation time; unauthorized
external action count.

Exit gate: unauthorized external actions remain zero; the creator decides whether
usefulness justifies integration expansion; unresolved weaknesses stay visible.
