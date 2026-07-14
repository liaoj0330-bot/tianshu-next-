import { createHash } from "node:crypto";
import { buildMinimalContext, getProject } from "./project-registry.mjs";

export function assessProject(registry, projectId, observation) {
  const project = getProject(registry, projectId);
  if (!observation?.summary || !Array.isArray(observation?.facts)) {
    throw new Error("observation requires summary and facts");
  }
  const facts = observation.facts.map((fact) => ({
    text: String(fact.text),
    source: fact.source ?? "creator_statement",
    confidence: fact.confidence ?? "high",
  }));
  const uncertain = (observation.unknowns ?? []).map((text) => String(text));
  const nextAction = observation.next_action ? String(observation.next_action) : null;
  if (!nextAction) throw new Error("observation requires exactly one next_action");
  const context = buildMinimalContext(registry, projectId);
  const card = {
    project_id: project.project_id,
    project_name: project.name,
    conclusion: observation.summary,
    facts,
    uncertain,
    next_action: nextAction,
    execution_mode: "read_only",
    business_write: "closed",
    context_sha256: context.context_sha256,
  };
  return {
    ...card,
    decision_card_sha256: createHash("sha256").update(JSON.stringify(card)).digest("hex"),
  };
}
