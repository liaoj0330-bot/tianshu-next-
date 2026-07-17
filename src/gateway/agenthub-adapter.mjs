export async function sendAgentHubIntake(baseUrl, message, metadata = {}) {
  const response = await fetch(`${baseUrl}/v1/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "agenthub", message, metadata }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `gateway returned ${response.status}`);
  return payload;
}

async function readGatewayResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error ?? `gateway returned ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

export async function sendAgentHubMessage(baseUrl, message, {
  conversationId,
  messageId,
  idempotencyKey,
  actorId = "local_creator",
  actorKind = "creator",
  metadata = {},
  observedAt,
  materials = [],
} = {}) {
  const response = await fetch(`${baseUrl}/v1/channels/agenthub/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      materials,
      conversation_id: conversationId,
      message_id: messageId,
      idempotency_key: idempotencyKey,
      actor_id: actorId,
      actor_kind: actorKind,
      metadata,
      observed_at: observedAt,
    }),
  });
  return readGatewayResponse(response);
}

export async function getAgentHubSession(baseUrl, sessionId) {
  return readGatewayResponse(await fetch(`${baseUrl}/v1/channels/agenthub/sessions/${encodeURIComponent(sessionId)}`));
}

export async function getAgentHubToday(baseUrl) {
  return readGatewayResponse(await fetch(`${baseUrl}/v1/channels/agenthub/today`));
}
