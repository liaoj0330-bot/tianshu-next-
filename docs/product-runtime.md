# TianShu Product Runtime

Status: current
Updated: 2026-07-15

## Runtime loop

Every input or observed event follows one governed path:

```text
Input or observation
  -> classify source and workspace
  -> retrieve confirmed creator context and evidence
  -> distinguish fact, inference, uncertainty, and requested action
  -> choose a response: record, ask, judge, propose, or stop
  -> request creator confirmation where required
  -> execute only within an approved boundary
  -> independently verify outputs
  -> request final creator acceptance
  -> record outcome and feedback in SQLite
  -> propose memory or evolution candidates
  -> use only confirmed experience in later judgments
```

## Workspace information architecture

Workspace classification is important because different information has
different time horizons, permissions, and expected actions. A single undivided
inbox causes current facts, long-term identity, project evidence, and system
operations to contaminate one another.

| Workspace | User question | Contains | Does not contain |
| --- | --- | --- | --- |
| Today | What needs my attention now? | one focus, due changes, one question, confirmations | permanent storage or system metrics |
| Projects | What is changing in my work? | project state, evidence, risks, decisions, next outcomes | private life records by default |
| Life | What constraints and commitments affect me? | wellbeing, schedule constraints, personal commitments | work execution state |
| Relationships | Who needs thoughtful attention? | relationship context, reminders, draft communications | autonomous external messages |
| Knowledge | What evidence can support a decision? | sources, evidence, relations, provenance | unconfirmed identity claims |
| Evolution | What did TianShu learn and what needs review? | memory candidates, lessons, counterexamples, model changes | automatically active rules |
| Activity | What is the system doing? | runs, verification, failure, retry, recovery, audit evidence | primary daily decision surface |

`Inbox` is an intake state, not a permanent workspace. Every item must either
be classified, remain explicitly unresolved, or be rejected.

## Obsidian boundary

Obsidian is a reporting entry because it supports long-form reflection and
familiar personal organization. Its governed path is:

```text
Creator report in Obsidian
  -> intake with source reference and content hash
  -> proposed workspace classification
  -> extracted facts, uncertainties, and candidates
  -> creator confirmation when formal state may change
  -> SQLite update
  -> regenerated readable Obsidian mirror
```

Editing a mirror must not directly change formal state. Deleting the mirror
must not lose state. The same mirror must be reproducible from SQLite.

## Decision contract

Every product judgment should expose judgment, creator context used, evidence,
facts versus inferences, uncertainty, alternatives when material, confidence,
one recommended next action, and the consequence of confirmation.

## Completion truth

Execution output is evidence, not completion. Independent verification can
make a result eligible for acceptance. Only creator acceptance completes the
goal.
