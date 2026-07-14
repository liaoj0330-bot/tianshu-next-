# TianShu Next

TianShu Next is the isolated successor implementation of the TianShu task control
plane. It is developed separately from the active Control Center and business projects.

## Completed phases

P1 trusted kernel:

- immutable Goal Contract and execution Plan;
- approval bound to a canonical plan hash;
- explicit Task and Run state machines;
- executor, verifier, and creator-decision authority separation;
- append-only events and restart recovery detection.

P2 real Codex executor:

- resolves a complete standalone Codex release instead of relying on a PATH shim;
- closes stdin explicitly for non-interactive execution;
- runs with `workspace-write`, `approval_policy=never`, and an exact repository root;
- records redacted stdout, stderr, final message, and verification artifacts;
- verifies tracked and untracked Git changes plus declared content/newline policy;
- treats exit code zero as executor output, not completion evidence.

Run the P1 acceptance suite:

```powershell
cd D:\AI_Workspace\00_工具隔离\TianShu_Next
npm test
```

Current acceptance suite: 11 tests. A real Codex Goal/Plan/Approval/Run/Verification/
Decision path has completed successfully in `.real-smoke`.

## Dynamic state MVP

The isolated dynamic-state module adds:

- immutable stable/current/future snapshots in SQLite;
- explicit update proposals instead of direct state overwrite;
- confidence and source gates that keep inference out of current facts;
- at most three deduplicated questions per cycle;
- one selected next action;
- creator accept/correct/reject authority;
- historical snapshots when current information changes or becomes invalid;
- a concise Markdown decision-card read model written only to isolated runtime paths.

Run its controlled three-cycle engineering replay:

```powershell
npm run state-replay
```

The replay is not a real creator validation cycle, does not write the official Obsidian
Vault, and cannot be used to claim that product Stage B has passed.

Start or continue a persistent real validation cycle with the isolated CLI:

```powershell
npm run state-live -- init --db <state.sqlite> --input <seed.json>
npm run state-live -- propose --db <state.sqlite> --subject <subject> --input <cycle.json> --output <card.md>
npm run state-live -- decide --db <state.sqlite> --input <decision.json>
npm run state-live -- show --db <state.sqlite> --subject <subject>
```

A proposed cycle remains `awaiting_creator_decision`; it does not change the current
snapshot until the creator explicitly accepts or corrects it.

See `docs/TIANSHU_FINAL_IMPLEMENTATION_PLAN_002.md` for the remaining phase gates.
