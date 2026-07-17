# TianShu Product Contract 001

Status: current
Updated: 2026-07-16

## Product identity

TianShu is a local-first personal intelligent work operating system. It turns
human expression and observed change into explainable judgments, governed
plans, bounded Agent execution, independent verification, creator acceptance,
and reusable confirmed experience.

The current operator is the first real product user and final product
acceptor. The current operator is not the product identity. Names, locale,
timezone, projects, preferences, and channels are product data stored in
SQLite, not compile-time constants.

The current architecture is single-user first. It must remain profile-ready
and migration-safe, but V1.1 does not add SaaS tenancy or organization roles.

## Product loop

```text
expression or observation
  -> context and evidence retrieval
  -> fact / inference / uncertainty separation
  -> answer, question, judgment, or action candidate
  -> creator decision when formal state may change
  -> separately approved execution boundary
  -> executor output
  -> independent verification
  -> creator final acceptance
  -> outcome and feedback
  -> experience candidate
  -> explicit experience promotion
  -> later cited improvement
```

No executor, verifier, client, read model, or automation may collapse these
stages or mark a goal complete on behalf of the creator.

## Product layers

1. Experience layer: Today, conversation, decisions, projects, activity,
   evolution, automation, devices, and settings.
2. Cognitive control layer: intake, classification, retrieval, judgment,
   planning, uncertainty, and candidate generation.
3. Governance layer: identity, authority, confirmation, execution boundaries,
   final acceptance, and audit.
4. Execution layer: Agent registry, queue, leases, runs, retries, cancellation,
   verification, and recovery.
5. State layer: SQLite as the only machine-state authority; Markdown and UI
   projections are rebuildable read models.

AgentHub is a desktop interaction client and Agent runtime host. It is not the
TianShu state authority, decision authority, or product identity.

## Core objects

- Product profile: stable local creator identity and configurable display data.
- Intake: immutable source expression or observed event.
- Record context: product, development, acceptance, or system provenance.
- Workspace assignment: the concern and time horizon an intake belongs to.
- State candidate: proposed formal-state change.
- Judgment: facts, inferences, uncertainty, evidence, alternatives, and action.
- Goal and plan: completion contract and proposed route.
- Execution boundary: Agent roles, paths, timeout, retries, and expected output.
- Task and run: authorized work and an execution attempt.
- Verification: independent evidence assessment.
- Creator decision: authoritative acceptance, rejection, correction, or defer.
- Outcome and experience: reviewed result and a versioned reusable lesson.
- Automation: SQLite-backed trigger and action proposal; never hidden execution.

## Identity contract

- The stable V1 local creator actor ID is `local_creator`.
- The display name is loaded from the primary SQLite product profile.
- Historical `nainai` records remain auditable and are accepted only as a
  compatibility alias at trusted local boundaries.
- New APIs, sessions, policies, and UI copy must not depend on a person's name.
- Profile changes are versioned and may only be made by the local creator.

## Context separation contract

- Every new intake receives a SQLite record context.
- Normal trusted product input defaults to `product` and primary visibility.
- Development and acceptance tools must explicitly set their context.
- Legacy classification is conservative, revisioned, and never deletes source
  evidence.
- Product decision views show primary work first and keep secondary development
  or acceptance evidence accessible without mixing it into daily priorities.

## Completion and acceptance

Automated tests prove engineering behavior. Independent verification proves
evidence eligibility. Neither is final product acceptance. The current creator
performs the final product acceptance after executable tests, runtime evidence,
and real interaction checks are complete.
