# TianShu Product Read Model Phase 1 Evidence

Status: passed
Date: 2026-07-16

## Goal

Make TianShu Nainai's single personal cognition, state, and decision control
plane. AgentHub remains the natural-language interaction and execution
coordination surface: it may submit requests, invoke governed capabilities,
stream progress, and return evidence, but it may not become a second source of
truth or confirm, correct, approve, verify, or complete formal state for Nainai.

## Product contract

The creator-facing product exposes exactly seven workspaces:

1. Today
2. Projects
3. Life
4. Relationships
5. Knowledge
6. Evolution
7. Activity

Inbox is an internal uncertainty and triage queue. It remains queryable through
the creator model as pending confirmation, but it is not exposed as an eighth
top-level workspace.

Workspace assignments expose one of three product decision states:

- `system_classified`: TianShu proposed a classification and no creator decision
  is required.
- `awaiting_creator_confirmation`: the input is ambiguous or unresolved and
  waits for Nainai.
- `creator_confirmed`: Nainai confirmed or corrected the formal classification.

## Authority and privacy invariants

1. SQLite is the only machine-state authority for every read model.
2. Read endpoints do not append events or mutate formal state.
3. Only Nainai can confirm or correct a workspace assignment.
4. AgentHub cannot use the creator decision endpoint.
5. Protected projects are excluded from project payloads; only an aggregate
   protected count is returned.
6. Protected knowledge entities are excluded from both result lists and health
   totals.
7. Markdown is evidence and a readable projection, never machine authority.

## Implemented surface

- `GET /v1/workspaces`: seven-workspace index.
- `GET /v1/workspaces/:workspace`: SQLite-backed workspace read model.
- `GET /v1/creator-model`: creator state, pending state updates, pending workspace
  confirmations, pending questions, and memory candidates.
- `GET /v1/judgments`: filterable judgment read model.
- `POST /v1/intake`: persists a workspace proposal with confidence and reasons.
- `POST /v1/intakes/:id/workspace-decision`: Nainai-only correction or
  confirmation.

## Executable evidence

Focused product and governance gate:

```text
node --test test/product-read-models-gateway.test.mjs test/workspace-assignment-gateway.test.mjs test/judgment-loop-gateway.test.mjs test/external-advice-gateway.test.mjs
5 tests passed, 0 failed
```

Full regression gate:

```text
npm test
110 tests passed, 0 failed
```

The focused gate verifies the seven-workspace contract, internal Inbox,
classification decision states, AgentHub denial, Nainai correction, restart-safe
SQLite state, protected-project non-disclosure, and read-only event counts.

## Phase conclusion

Phase 1 is accepted as a governed product read-model layer. It does not claim a
finished graphical cockpit, a complete AgentHub card experience, autonomous
formal decisions, or migration of runtime state from any active project.
