# TianShu Current Decisions

This file records current product and engineering decisions. Historical
acceptance reports remain evidence but do not override this file or SQLite
runtime truth.

## 2026-07-15: Personal use precedes integration expansion

- Decision: make TianShu useful in repeated creator use before adding broad
  Feishu, device, or business-project integrations.
- Reason: long-term usefulness depends on correction, suppression, feedback,
  and judgment improvement that isolated demonstrations cannot prove.
- Consequence: V1.1 focuses on one complete real loop and a personal pilot.

## 2026-07-15: Workspace classification follows user concerns

- Decision: use Today, Projects, Life, Relationships, Knowledge, Evolution,
  and Activity as product workspaces.
- Reason: these areas have different time horizons, evidence rules, privacy,
  permissions, and interaction expectations.
- Consequence: Inbox remains transitional and system metrics remain secondary.

## 2026-07-15: Obsidian is governed intake and read model

- Decision: preserve Obsidian as a creator reporting surface, but route formal
  changes through intake, confirmation, and SQLite.
- Reason: long-form reporting is useful; direct Markdown authority would create
  state divergence and bypass creator confirmation.
- Consequence: mirrors must be rebuildable and must never silently mutate state.

## 2026-07-15: Improve existing UI incrementally

- Decision: retain the runtime, Gateway, AgentHub contract, and SQLite model
  while improving product layout and interaction.
- Reason: the current problem is product coherence and visibility, not lack of
  a technical foundation.
- Consequence: UI work follows runtime and proactivity contracts instead of a
  full-stack rewrite.

## 2026-07-16: First user is not the product identity

- Decision: keep TianShu single-user first while moving identity, display name,
  locale, and timezone into a versioned SQLite product profile.
- Reason: the current operator validates the product but must not be compiled
  into its authority, API, session, or UI contracts.
- Consequence: `local_creator` is the stable local actor ID; historical names
  remain compatibility aliases and audit evidence only.

## 2026-07-16: Separate product work from development evidence

- Decision: classify records as product, development, acceptance, or system
  context, with primary, secondary, or hidden visibility.
- Reason: executable acceptance evidence is valuable but must not dominate the
  user's daily decisions or project priorities.
- Consequence: all new inputs receive a SQLite context, legacy classification
  is revisioned, and no original record is deleted.
