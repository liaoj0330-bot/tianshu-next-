# TianShu Productization Phase 1 Evidence 001

Date: 2026-07-16

Status: implementation and internal verification complete; final product acceptance remains with the user.

## Product Outcome

This phase turns the AgentHub development build into the first usable TianShu product surface. The implementation is single-user-first but is not hard-coded to the first user's identity. SQLite remains the only machine-state authority.

The phase delivers:

- a configurable primary product profile with stable actor identity;
- separation of product, development, acceptance, and system records;
- a decision inbox split into formal decisions and development/acceptance evidence;
- typed decision presentation and a working workspace-assignment decision;
- project posture with trend, freshness, evidence count, next outcome, and blockers;
- a SQLite-backed reminder scheduler with once/daily rules and acknowledgement;
- responsive AgentHub shell behavior for narrow windows;
- phone input and direct phone-to-TianShu question routing;
- CapsWriter voice control and clipboard-to-TianShu input bridging.

## SQLite Evidence

- Live schema version: `8` (`reminder_automations`).
- Live product actor: `local_creator`.
- Live display profile: `奈奈` (profile data, not a product identity constant).
- Live automation scan: active with no scheduler error.
- Live formal decisions at verification time: `1`.
- Live development/acceptance evidence decisions: `8`.
- No demo automation was inserted into the live state database.

Schema 8 adds:

- `automations`;
- `automation_occurrences`;
- append-only `automation_event_log`;
- due-scan and pending-occurrence indexes.

## Executable Verification

TianShu full suite:

- `125/125` tests passed;
- includes migration idempotency, creator authority, managed execution, independent verification, restart recovery, AgentHub idempotency, product read models, record-context separation, reminder scheduling, and service scheduler idempotency.

AgentHub focused product suite:

- `5/5` tests passed across TianShu bridge, mobile bridge, and CapsWriter UDP protocol;
- TypeScript typecheck passed.

AgentHub repository-wide suite:

- `270` tests passed;
- `7` skipped;
- `4` YCSF/PPT tests could not run because they write to `D:\AI_Workspace\_YCSF_Entrance`, which is outside the allowed workspace and belongs to a prohibited business repository under the TianShu development rules;
- no attempt was made to bypass that boundary.

## Visual Verification

Desktop screenshot:

- `D:\AI_Workspace\Tools\AgentHub\test-output\tianshu-master-control-desktop.png`
- viewport content width: `1247`;
- TianShu root width: `1023`;
- horizontal overflow: none;
- product panels: `11`;
- focus timer changed from `25:00` to `24:59`;
- a decision result was visible.

Narrow-window screenshot:

- `D:\AI_Workspace\Tools\AgentHub\test-output\tianshu-master-control-mobile.png`
- viewport width: `607`;
- TianShu root width: `499`;
- horizontal overflow: none;
- automation form reachable;
- workspace-assignment result visible;
- all `7` permanent workspace choices reachable.

The hidden screenshot runner disables entry motion because Chromium does not advance the compositor transition in a hidden window. Normal product motion remains unchanged.

## Live Integration Evidence

At final internal verification:

- TianShu service responded on `http://127.0.0.1:4317`;
- AgentHub Electron development build was running;
- AgentHub mobile bridge responded on port `8787`;
- mobile page copy referenced TianShu, not the legacy YCSF surface;
- CapsWriter server listened on TCP `6016`;
- CapsWriter client listened on UDP `6018`;
- an actual START/STOP probe produced CapsWriter log evidence for recording start and stop;
- CapsWriter had the `[V] ` clipboard marker configured for AgentHub ingestion.

## Authority Boundary

- Executors may report outputs but cannot verify or complete a goal.
- Independent verification is required before a run reaches final creator decision.
- Reminders create occurrences only; they do not create tasks or launch Agents.
- Development and acceptance evidence stays auditable but does not affect primary daily priority.
- Protected projects remain excluded from AgentHub display and execution.
- Final product acceptance is not claimed by this document.
