import { createServer } from "node:http";
import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new Error("invalid JSON body"); }
}

export function createGateway({ db, host = "127.0.0.1", port = 0 } = {}) {
  if (!db) throw new Error("gateway requires SQLite db");
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return json(res, 200, { status: "ok", control_plane: "tianshu-orchestrator", state_store: "sqlite" });
      }
      if (req.method === "POST" && req.url === "/v1/intake") {
        const input = await body(req);
        if (!input.message || typeof input.message !== "string") return json(res, 400, { error: "message is required" });
        const intakeId = newId("intake");
        db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(intakeId, input.source ?? "unknown", canonicalJson({ message: input.message, metadata: input.metadata ?? {} }), now());
        appendEvent(db, "intake", intakeId, "intake.accepted", { source: input.source ?? "unknown" });
        return json(res, 202, { intake_id: intakeId, status: "accepted", routed_to: "tianshu-orchestrator", state_authority: "sqlite", next: "goal_manager" });
      }
      if (req.method === "GET" && req.url === "/v1/intakes") {
        return json(res, 200, { items: db.prepare("SELECT intake_id, source, status, created_at FROM intake_events ORDER BY created_at DESC").all() });
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) { return json(res, 400, { error: error.message }); }
  });
  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
