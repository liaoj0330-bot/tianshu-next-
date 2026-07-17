import { createHash } from "node:crypto";
import { canonicalJson, newId, now } from "../core/store.mjs";
import { normalizePrincipalId } from "../governance/authority.mjs";
import { getProductProfile } from "../product/product-profile.mjs";

export class AgentHubContractError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AgentHubContractError";
    this.statusCode = statusCode;
  }
}

function requiredString(input, field) {
  if (typeof input[field] !== "string" || !input[field].trim()) {
    throw new AgentHubContractError(`${field} is required`);
  }
  return input[field].trim();
}

export function validateAgentHubMessage(db, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentHubContractError("JSON object body is required");
  }
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const materials = input.materials === undefined ? [] : input.materials;
  if (!Array.isArray(materials)) throw new AgentHubContractError("materials must be an array");
  if (materials.length > 100) throw new AgentHubContractError("a message can contain at most 100 materials");
  if (materials.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new AgentHubContractError("every material must be an object");
  }
  if (!message && !materials.length) throw new AgentHubContractError("message or materials are required");
  const conversationId = requiredString(input, "conversation_id");
  const messageId = requiredString(input, "message_id");
  const idempotencyKey = requiredString(input, "idempotency_key");
  const actorId = requiredString(input, "actor_id");
  const actorKind = requiredString(input, "actor_kind");
  const profile = getProductProfile(db);
  const normalizedActorId = normalizePrincipalId(actorId, db);
  if (normalizedActorId !== profile.actor_id || actorKind !== "creator") {
    throw new AgentHubContractError("AgentHub messages must represent the authenticated local creator", 403);
  }
  if (input.metadata !== undefined && (typeof input.metadata !== "object" || input.metadata === null || Array.isArray(input.metadata))) {
    throw new AgentHubContractError("metadata must be an object");
  }
  return {
    message,
    materials,
    conversation_id: conversationId,
    message_id: messageId,
    idempotency_key: idempotencyKey,
    actor_id: normalizedActorId,
    actor_kind: actorKind,
    metadata: input.metadata ?? {},
    observed_at: input.observed_at,
  };
}

export function hashAgentHubRequest(input) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function getOrCreateAgentHubSession(db, input) {
  const existing = db.prepare(`
    SELECT * FROM interaction_sessions
    WHERE channel='agenthub' AND conversation_id=? AND actor_id=?
  `).get(input.conversation_id, input.actor_id);
  if (existing) return existing;
  const timestamp = now();
  const sessionId = newId("session");
  db.prepare(`
    INSERT INTO interaction_sessions(
      session_id,channel,conversation_id,actor_id,actor_kind,status,created_at,updated_at
    ) VALUES (?,'agenthub',?,?,?,'active',?,?)
  `).run(sessionId, input.conversation_id, input.actor_id, input.actor_kind, timestamp, timestamp);
  return db.prepare("SELECT * FROM interaction_sessions WHERE session_id=?").get(sessionId);
}

export function reserveAgentHubRequest(db, session, input) {
  const requestHash = hashAgentHubRequest(input);
  const existing = db.prepare(`
    SELECT * FROM interaction_requests
    WHERE channel='agenthub' AND (message_id=? OR idempotency_key=?)
    ORDER BY created_at LIMIT 1
  `).get(input.message_id, input.idempotency_key);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AgentHubContractError("message_id or idempotency_key was already used for different content", 409);
    }
    if (existing.status === "processing") {
      throw new AgentHubContractError("request is still processing", 409);
    }
    if (existing.status === "failed") {
      throw new AgentHubContractError("the original request failed; use a new message_id and idempotency_key", 409);
    }
    return { replayed: true, request: existing, response: JSON.parse(existing.response_json) };
  }
  const timestamp = now();
  const requestId = newId("interaction_request");
  db.prepare(`
    INSERT INTO interaction_requests(
      request_id,session_id,channel,message_id,idempotency_key,request_hash,
      intake_id,status,response_json,created_at,updated_at
    ) VALUES (?,?,'agenthub',?,?,?,NULL,'processing',NULL,?,?)
  `).run(requestId, session.session_id, input.message_id, input.idempotency_key, requestHash, timestamp, timestamp);
  return {
    replayed: false,
    request: db.prepare("SELECT * FROM interaction_requests WHERE request_id=?").get(requestId),
  };
}

export function completeAgentHubRequest(db, requestId, intakeId, response) {
  db.prepare(`
    UPDATE interaction_requests
    SET intake_id=?,status='accepted',response_json=?,updated_at=?
    WHERE request_id=? AND status='processing'
  `).run(intakeId, canonicalJson(response), now(), requestId);
}

export function failAgentHubRequest(db, requestId, error) {
  db.prepare(`
    UPDATE interaction_requests
    SET status='failed',response_json=?,updated_at=?
    WHERE request_id=? AND status='processing'
  `).run(canonicalJson({ error: error instanceof Error ? error.message : String(error) }), now(), requestId);
}

export function buildAgentHubSessionReadModel(db, sessionId) {
  const session = db.prepare("SELECT * FROM interaction_sessions WHERE session_id=?").get(sessionId);
  if (!session) throw new AgentHubContractError("AgentHub session not found", 404);
  const requests = db.prepare(`
    SELECT r.request_id,r.message_id,r.idempotency_key,r.intake_id,r.status,
           r.response_json,r.created_at,r.updated_at,i.payload_json intake_payload_json
    FROM interaction_requests r
    LEFT JOIN intake_events i ON i.intake_id=r.intake_id
    WHERE r.session_id=? ORDER BY r.created_at,r.request_id
  `).all(sessionId).map((item) => ({
    ...item,
    response: item.response_json ? JSON.parse(item.response_json) : null,
    input: (() => {
      const payload = item.intake_payload_json ? JSON.parse(item.intake_payload_json) : {};
      return {
        message: payload.message ?? "",
        materials: Array.isArray(payload.materials)
          ? payload.materials.map(({ text_content, content_data_url, ...material }) => material)
          : [],
      };
    })(),
    response_json: undefined,
    intake_payload_json: undefined,
  }));
  const profile = getProductProfile(db);
  return {
    session,
    requests,
    authority: {
      creator_id: profile.actor_id,
      creator_profile: profile,
      state_authority: "sqlite",
      agenthub_can_submit: true,
      agenthub_can_confirm: false,
      agenthub_can_execute: false,
    },
  };
}
