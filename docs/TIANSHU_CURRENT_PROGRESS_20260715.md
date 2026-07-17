# TianShu Current Progress Baseline

Updated: 2026-07-17
Status: mobile-and-runtime-verified
State authority: SQLite

## Current assessment

TianShu's engineering control plane is substantially in place. The P1-P4
foundations are implemented, the core P5 governance mechanisms are
available, and AgentHub now provides the mobile-first product entry. The
control plane is approximately 85% complete. The complete end-user product is
approximately 75% complete and must not yet be described as production-finished.

## Verified capabilities

- A single natural-language intake gateway produces grounded answers, state
  candidates, versioned action proposals, and controlled dispatch requests.
- Goal, Plan, Task, Run, Agent, Verification, and creator Decision remain
  linked in SQLite.
- Planning approval and execution-boundary approval are separate decisions.
- Executors cannot verify their own output or complete a goal.
- Timeout, cancellation, bounded retry, restart recovery, project locks, and
  hash-addressed evidence are implemented.
- Claude Code, Hermes, Codex, and OpenClaw are registered behind one dispatcher.
- Cross-session continuity persists resumable checkpoints, recurring problems,
  lessons, and controlled evolution candidates.
- Git project changes can create deduplicated candidates, expose conflicts, and
  stream through SSE without silently changing formal project state.
- The unified knowledge index connects projects, goals, plans, tasks, runs,
  agents, aliases, sources, evidence, temporal validity, and explicit
  relations while filtering protected entities.
- AgentHub provides a mobile-first material entry, one decisive follow-up
  question, project workspaces, explicit progress semantics, approval
  boundaries, and creator decision candidates through the TianShu gateway.

## Runtime evidence

The 2026-07-17 local verification produced the following evidence:

- Full automated suite: **137/137 passed**.
- Service health: `status=ok` and `state_store=sqlite`.
- Worker supervisor: online, with bounded concurrency of 2.
- Latest backup: present with a recorded SHA-256 manifest.
- Unified index: 14 entities, 19 aliases, 13 sources, 14 evidence records,
  6 relations, 100% alias coverage, and 0 current evidence conflicts.
- Three bounded runs have been independently reviewed and accepted by the
  creator; Claude executes and Hermes independently verifies the accepted path.
- The 390px mobile layout and 1440px desktop project layout were checked with
  no horizontal overflow. AI quant is displayed as 0% build progress with 11
  materials; crystal DIY is displayed as 0% build progress with one image.

## Remaining gates

- Complete repeated real code-task trials across executor and independent
  verifier combinations, including failure and recovery cases.
- Continue validating AgentHub with repeated real material batches, including
  corrections, rejected plans, failure recovery, and final creator decisions.
- Add identity, network protection, backup recovery drills, and monitoring
  before describing a deployment as a public production service.
- Connect Feishu task, calendar, and meeting events through governed intake.
- Run a sustained pilot covering continuous observation, daily turn closure,
  recovery, and evidence writeback.
- Increase real-source evidence coverage for projects, goals, tasks, and agents
  without manufacturing data to improve dashboard metrics.

## Protected boundary

Teacher PPT, 069, 070, and business-project repositories remain outside this
repository's read, write, and dispatch scope. Markdown and Obsidian outputs are
read models only; they cannot replace SQLite as machine state.

## Release truth

A passing executor exit code is not completion. A run becomes eligible for
completion only after independent structured verification, and it becomes
complete only after the creator's explicit acceptance. Local commits are not
described as synchronized until the corresponding GitHub push succeeds.
