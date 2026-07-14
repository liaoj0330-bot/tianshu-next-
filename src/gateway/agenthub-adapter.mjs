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
