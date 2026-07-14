import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";

const LEVELS = new Set(["L0", "L1", "L2", "L3"]);

export function registerAgent(db, definition) {
  if (!definition?.agent_id || !definition?.display_name || !definition?.command) throw new Error("agent requires id, display_name, and command");
  if (!LEVELS.has(definition.risk_level ?? "L0")) throw new Error("invalid agent risk level");
  const timestamp = now();
  db.prepare("INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, ?)")
    .run(definition.agent_id, definition.display_name, definition.command, canonicalJson(definition.args ?? []), canonicalJson(definition.capabilities ?? []), definition.risk_level ?? "L0", timestamp, timestamp);
  appendEvent(db, "agent", definition.agent_id, "agent.registered", { command: definition.command });
  return definition.agent_id;
}

export function listAgents(db) {
  return db.prepare("SELECT * FROM agents ORDER BY agent_id").all().map((agent) => ({ ...agent, args: JSON.parse(agent.command_args_json), capabilities: JSON.parse(agent.capabilities_json) }));
}

export function getAgent(db, agentId) {
  const agent = db.prepare("SELECT * FROM agents WHERE agent_id=?").get(agentId);
  if (!agent) throw new Error(`unknown agent: ${agentId}`);
  return { ...agent, args: JSON.parse(agent.command_args_json), capabilities: JSON.parse(agent.capabilities_json) };
}
