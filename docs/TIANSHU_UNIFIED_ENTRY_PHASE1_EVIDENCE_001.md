# TianShu Unified Entry Phase 1 Evidence 001

Date: 2026-07-15

## Scope

This phase establishes a product-level intake decision contract and makes TianShu the default AgentHub entry. It does not claim that grounded answers, state comparison, approval-bound dispatch, or the final daily workspace are complete.

## Implemented

- Added five explicit interaction modes: `direct_answer`, `ask_one_question`, `state_candidate`, `action_proposal`, and `dispatch_request`.
- Bare links and paths remain input materials and ask one question instead of becoming task types.
- Possible changes are persisted as candidates and cannot update formal state directly.
- Controlled actions require an approval-bound plan and return `execution_allowed=false`.
- Intake decisions are stored in the SQLite intake payload and returned by `/v1/intakes`.
- AgentHub now opens TianShu Today by default.
- The legacy YCSF screen remains reachable by compatibility paths but is removed from first-level navigation.
- The TianShu result card renders mode, confidence, summary, question, and approval state.

## Automated evidence

- TianShu full suite: 62/62 passed.
- Unified intake focused suite: 5/5 passed.
- AgentHub TianShu bridge: 2/2 passed.
- AgentHub TypeScript check: passed.
- AgentHub production build: passed.

## Live service evidence

The service was restarted from PID 19280 to PID 29768. Four inputs were submitted through `http://127.0.0.1:4317/v1/intake` with `metadata.acceptance_test=true`:

| Case | Expected | Actual | Approval | Execution allowed | SQLite intake |
| --- | --- | --- | --- | --- | --- |
| Bare GitHub URL | `ask_one_question` | `ask_one_question` | no | no | `intake_a1e63741a3e34b4c8c8b` |
| Current project change | `state_candidate` | `state_candidate` | no | no | `intake_c4134cc09b8e416884b4` |
| Priority judgment question | `direct_answer` | `direct_answer` | no | no | `intake_4d2940d7595a47e1bed1` |
| Send message and create task | `dispatch_request` | `dispatch_request` | yes | no | `intake_3fd24b3dd19645c6924a` |

All four records were returned by `/v1/intakes` with the same interaction decision.

## Boundaries and remaining work

- `direct_answer` currently selects the product route; it does not yet compose the grounded answer.
- `state_candidate` does not yet run the full current-state comparison and creator decision card flow automatically.
- `dispatch_request` does not create or execute a plan; this is intentional until the approval-bound plan contract is connected.
- The old YCSF keyword project router still exists behind compatibility paths and must be replaced in Phase 2.
- The current Today screen is an integration surface, not the final visual design.
- No protected project, Teacher PPT, 069, 070, or business-project repository was read, modified, or dispatched.

## Git status

Changes are local. No GitHub push is claimed. AgentHub has substantial pre-existing uncommitted work, so no mixed commit is created in this phase.
