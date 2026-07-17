# TianShu Product Experience System

Status: current
Updated: 2026-07-15

## Experience objective

The interface is a cognitive cockpit, not a chat window or generic operations
dashboard. Visual hierarchy must reveal the current cognitive stage and the
creator's decision boundary.

## Primary views

### Today

Show one focus, the reason, current constraints, one useful question, and the
confirmations that genuinely need creator attention.

### Decision

Separate facts, inferences, uncertainty, evidence, recommendation,
alternatives, and creator controls.

### Action

Expose draft, awaiting authorization, queued, running, verifying, awaiting
acceptance, failed, cancelled, retried, and recovered states.

### Evolution

Show the experience produced by a loop, its source, scope, counterexamples,
confirmation state, version, and later judgments it influenced.

## Interaction rules

- Natural language is an input method, not the entire product layout.
- Raw JSON is an audit detail, not the primary response.
- Confirmation actions must state their consequence before submission.
- Desktop and mobile preserve the same decision order.
- Empty, loading, failure, offline, conflict, and recovery states are required.
- UI changes reuse current APIs and data contracts unless a contract is proven
  insufficient.

## Visual rules

- Maintain strong brand identity without decorative futurism.
- Use restrained contrast, clear reading order, and compact functional groups.
- Avoid generic sidebar-plus-card-grid composition and uniform visual weight.
- Avoid excessive gradients, glow, particles, and ornamental animation.
- Use motion only to explain state transition or changed evidence.
- Never hide authorization, uncertainty, or failure behind visual polish.

## Verification

Every material UI change requires desktop and mobile screenshots, long-text
coverage, critical state coverage, functional tests, and creator visual
acceptance.
