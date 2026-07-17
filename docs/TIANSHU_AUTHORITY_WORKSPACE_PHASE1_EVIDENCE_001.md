# TianShu Authority and Workspace Phase 1 Evidence

Status: passed
Date: 2026-07-15

## Scope

This gate covers only the authority model, versioned SQLite migration baseline,
workspace classification persistence, creator correction, and restart recovery.
It does not claim that the judgment, outcome, experience, Obsidian, or AgentHub
cockpit loops are complete.

## Proven invariants

1. Nainai is the only goal owner and final acceptance authority.
2. AgentHub is an interaction channel and cannot confirm formal state.
3. Executors can report output but cannot approve, verify, or complete a goal.
4. Independent verification can make evidence eligible for acceptance but cannot
   replace Nainai's final decision.
5. SQLite is the only machine-state authority. Obsidian remains a readable workbench.
6. Every intake has a persisted workspace assignment, source, confidence, reason,
   candidates, decision state, and append-only revision history.
7. Ambiguous and unresolved inputs remain visible and request creator confirmation.
8. Creator corrections survive a database close and reopen without rewriting the
   original classifier proposal.

## Implementation evidence

- `src/governance/authority.mjs`: versioned authority baseline and runtime checks.
- `src/core/migrations.mjs`: checksummed, idempotent SQLite migrations.
- `src/product/workspace-classifier.mjs`: deterministic proposed classification.
- `src/product/workspace-assignment.mjs`: persisted assignments and append-only revisions.
- `src/gateway/server.mjs`: governed intake and creator workspace decision endpoints.
- `src/product/today-read-model.mjs`: unresolved workspace confirmation projection.

## Executable gate

Focused phase gate:

```text
node --test --test-concurrency=1 test/authority-migrations.test.mjs test/workspace-classifier.test.mjs test/workspace-assignment-gateway.test.mjs test/unified-intake-gateway.test.mjs test/today-read-model.test.mjs
12 tests passed, 0 failed
```

Regression gate after authority actor normalization:

```text
node --test --test-concurrency=1 test/run-decision-gateway.test.mjs test/authority-migrations.test.mjs
3 tests passed, 0 failed

npm test
101 tests passed, 0 failed
```

The focused gate includes the unresolved-input regression and passed before
Phase 1 was marked complete in the plan.

## Negative evidence

- An AgentHub-originated workspace decision is rejected.
- An executor-originated execution approval is rejected.
- An independent verifier-originated final acceptance is rejected.
- A mirror or documentation edit has no path to mutate formal SQLite state.

## Explicit nonclaims

- TianShu does not yet have a complete structured judgment-feedback-outcome loop.
- Accepted experience is not yet cited by a later judgment.
- Wu Laoshi's four documents have not yet been processed through the governed
  external-advice workflow.
- The Obsidian information architecture and Today cockpit have not yet been rebuilt.
- AgentHub does not yet expose the complete card, asynchronous status, and evidence
  interaction contract.
