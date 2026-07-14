import { createServer } from "node:http";
import { appendEvent, canonicalJson, newId, now } from "../core/store.mjs";
import { analyzeIntent } from "../intelligence/intent-router.mjs";
import { classifyOperatingDomain } from "../intelligence/domain-router.mjs";
import { createStateSubject, proposeStateUpdate, decideStateUpdate, getCurrentState, buildStateDecisionCard } from "../state/dynamic-state.mjs";
import { createGoal } from "../core/kernel.mjs";
import { recordMemoryCandidate, addMemoryCounterexample, promoteMemoryCandidate, listMemoryCandidates } from "../memory/promotion.mjs";
import { extractCreatorSignals } from "../intelligence/creator-signal-extractor.mjs";
import { DASHBOARD_HTML as PRODUCT_DASHBOARD_HTML } from "./dashboard.mjs";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const DASHBOARD_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>天枢总控</title><style>
body{margin:0;background:#0b1220;color:#edf2f7;font:16px system-ui,"Microsoft YaHei",sans-serif}main{max-width:1180px;margin:0 auto;padding:32px}h1{font-size:32px;margin:0 0 8px}.muted{color:#9fb0c2}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px}.card{background:#142238;border:1px solid #263b55;border-radius:14px;padding:20px}.wide{grid-column:1/-1}textarea{width:100%;min-height:130px;background:#0e192a;color:#edf2f7;border:1px solid #38516d;border-radius:10px;padding:12px;box-sizing:border-box;font:inherit}button{margin-top:12px;background:#2dd4bf;color:#06211e;border:0;border-radius:9px;padding:10px 18px;font-weight:700;cursor:pointer}pre{white-space:pre-wrap;color:#b8c7d9;line-height:1.55}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#1d344e;color:#7ee7d7;font-size:13px}</style></head><body><main>
<div class="muted">TIANSHU ORCHESTRATOR / SINGLE CONTROL PLANE</div><h1>天枢总控</h1><div class="muted">你只需要输入目标，系统负责理解、调度、验收和回写。</div>
<div class="grid"><section class="card"><div class="muted">控制平面</div><h2 id="health">检查中…</h2><span class="pill">SQLite 状态真相</span></section><section class="card"><div class="muted">当前入口</div><h2>自然语言目标</h2><span class="pill">AgentHub / 手机 / 硬件</span></section><section class="card"><div class="muted">当前原则</div><h2>先判断，再执行</h2><span class="pill">独立验收</span></section><section class="card wide"><div class="muted">告诉天枢你要什么</div><textarea id="message" placeholder="例如：最近澳大利亚合作发生重大变化，请判断我的当前优先级，并告诉我还缺什么信息。"></textarea><button onclick="send()">交给天枢处理</button><pre id="result">等待输入…</pre></section><section class="card wide"><div class="muted">最近收到的目标</div><pre id="intakes">加载中…</pre></section></div></main><script>
async function load(){const h=await fetch('/health').then(r=>r.json());document.querySelector('#health').textContent=h.status==='ok'?'在线':'异常';const x=await fetch('/v1/intakes').then(r=>r.json());document.querySelector('#intakes').textContent=x.items.length?x.items.map(i=>i.created_at+'  '+i.source+'  '+i.status).join('\\n'):'暂无目标';}async function send(){const message=document.querySelector('#message').value.trim();if(!message)return;const r=await fetch('/v1/intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'dashboard',message,metadata:{client:'tianshu-dashboard'}})});document.querySelector('#result').textContent=JSON.stringify(await r.json(),null,2);document.querySelector('#message').value='';load();}load();
</script></body></html>`;

async function body(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new Error("invalid JSON body"); }
}

export function createGateway({ db, host = "127.0.0.1", port = 0, health = null } = {}) {
  if (!db) throw new Error("gateway requires SQLite db");
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return json(res, 200, { status: "ok", control_plane: "tianshu-orchestrator", state_store: "sqlite", ...(health ? health() : {}) });
      }
      if (req.method === "GET" && req.url === "/v1/overview") {
        return json(res, 200, {
          control_plane: "tianshu-orchestrator",
          state_store: "sqlite",
          counts: {
            intakes: db.prepare("SELECT COUNT(*) AS count FROM intake_events").get().count,
            goals: db.prepare("SELECT COUNT(*) AS count FROM goals").get().count,
            active_states: db.prepare("SELECT COUNT(*) AS count FROM state_subjects WHERE current_snapshot_id IS NOT NULL").get().count,
            agent_runs: db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count,
          },
          subjects: db.prepare("SELECT subject_id, display_name, current_snapshot_id, updated_at FROM state_subjects ORDER BY updated_at DESC").all(),
        });
      }
      if (req.method === "GET" && req.url === "/v1/workspace") {
        const intakes = db.prepare("SELECT intake_id, source, payload_json, status, created_at FROM intake_events ORDER BY created_at DESC LIMIT 8").all().map((row) => {
          const payload = JSON.parse(row.payload_json);
          return { intake_id: row.intake_id, source: row.source, status: row.status, created_at: row.created_at, message: payload.message ?? payload.payload?.text ?? payload.event_type ?? "device event" };
        });
        const goals = db.prepare("SELECT goal_id, contract_json, status, created_at, updated_at FROM goals ORDER BY updated_at DESC LIMIT 6").all().map((row) => {
          const contract = JSON.parse(row.contract_json);
          return { goal_id: row.goal_id, objective: contract.objective ?? contract.real_goal ?? "Untitled goal", status: row.status, created_at: row.created_at, updated_at: row.updated_at };
        });
        const decisions = db.prepare("SELECT decision_id, decision, reason, created_at FROM decisions ORDER BY created_at DESC LIMIT 6").all();
        return json(res, 200, { state_authority: "sqlite", intakes, goals, decisions });
      }
      if (req.method === "GET" && req.url === "/v1/decisions") {
        return json(res, 200, { items: db.prepare(`SELECT d.decision_id, d.run_id, d.decision, d.reason, d.decided_by, d.created_at, v.passed, v.report_json, v.verifier FROM decisions d LEFT JOIN verifications v ON v.run_id=d.run_id ORDER BY d.created_at DESC`).all().map((row) => ({ ...row, report: row.report_json ? JSON.parse(row.report_json) : null })) });
      }
      const runMatch = req.url.match(/^\/v1\/runs\/([^/]+)$/);
      if (runMatch && req.method === "GET") {
        const run = db.prepare("SELECT * FROM runs WHERE run_id=?").get(runMatch[1]);
        if (!run) return json(res, 404, { error: "run not found" });
        const verification = db.prepare("SELECT * FROM verifications WHERE run_id=?").get(runMatch[1]);
        const decision = db.prepare("SELECT * FROM decisions WHERE run_id=?").get(runMatch[1]);
        return json(res, 200, { run: { ...run, executor_result: run.executor_result_json ? JSON.parse(run.executor_result_json) : null }, verification: verification ? { ...verification, report: JSON.parse(verification.report_json) } : null, decision: decision ?? null });
      }
      if (req.method === "POST" && req.url === "/v1/analyze") {
        const input = await body(req);
        if (!input.text || typeof input.text !== "string") return json(res, 400, { error: "text is required" });
        const analysis = analyzeIntent(input.text);
        return json(res, 200, { analysis: { ...analysis, operating_domain: classifyOperatingDomain(analysis) }, routed_to: "goal_manager" });
      }
      if (req.method === "POST" && req.url === "/v1/state/subjects") {
        const input = await body(req);
        return json(res, 201, createStateSubject(db, input));
      }
      if (req.method === "POST" && req.url === "/v1/goals") {
        const input = await body(req);
        if (!input.original_request || typeof input.original_request !== "string") return json(res, 400, { error: "original_request is required" });
        const analysis = analyzeIntent(input.original_request);
        const contract = {
          objective: input.real_goal ?? input.original_request,
          completion_criteria: input.success_criteria ?? [],
          original_request: input.original_request,
          real_goal: input.real_goal ?? input.original_request,
          success_criteria: input.success_criteria ?? [],
          non_goals: input.non_goals ?? [],
          constraints: input.constraints ?? [],
          required_evidence: input.required_evidence ?? [],
          risk_level: input.risk_level ?? "L1",
          operating_domain: classifyOperatingDomain(analysis),
          source: input.source ?? "gateway",
        };
        return json(res, 201, { goal_id: createGoal(db, contract), status: "contracted", contract, analysis });
      }
      if (req.method === "POST" && req.url === "/v1/memory/candidates") {
        const input = await body(req);
        return json(res, 201, recordMemoryCandidate(db, input));
      }
      const memoryMatch = req.url.match(/^\/v1\/memory\/([^/]+)(?:\/([^/]+))?$/);
      if (memoryMatch && memoryMatch[2] === "promote" && req.method === "POST") {
        const input = await body(req); return json(res, 200, promoteMemoryCandidate(db, memoryMatch[1], input.promoted_by ?? "creator"));
      }
      if (memoryMatch && memoryMatch[2] === "counterexample" && req.method === "POST") {
        const input = await body(req); addMemoryCounterexample(db, memoryMatch[1], input.counterexample); return json(res, 200, { status: "recorded" });
      }
      if (memoryMatch && !memoryMatch[2] && req.method === "GET") return json(res, 200, { items: listMemoryCandidates(db, memoryMatch[1]) });
      const stateMatch = req.url.match(/^\/v1\/state\/([^/]+)(?:\/([^/]+))?$/);
      if (stateMatch && req.method === "GET") {
        const state = getCurrentState(db, stateMatch[1]);
        if (!state) return json(res, 404, { error: "state subject not found" });
        return json(res, 200, state);
      }
      if (stateMatch && stateMatch[2] === "propose" && req.method === "POST") {
        const input = await body(req);
        return json(res, 201, proposeStateUpdate(db, stateMatch[1], input));
      }
      if (stateMatch && stateMatch[2] === "propose-from-text" && req.method === "POST") {
        const input = await body(req);
        if (!input.text || typeof input.text !== "string") return json(res, 400, { error: "text is required" });
        const extracted = extractCreatorSignals(input.text);
        const proposal = proposeStateUpdate(db, stateMatch[1], {
          observed_at: input.observed_at ?? now(),
          source_type: "creator_transcript",
          source_ref: input.source_ref ?? "gateway",
          signals: extracted.signals,
          requirements: input.requirements ?? [],
          next_action: input.next_action ?? (extracted.signals.length ? { title: "确认本轮状态变化", owner: "creator", status: "awaiting_creator_decision" } : null),
        });
        return json(res, 201, { ...proposal, extraction: extracted });
      }
      if (stateMatch && stateMatch[2] === "decision" && req.method === "POST") {
        const input = await body(req);
        return json(res, 200, decideStateUpdate(db, input.cycle_id, input.decision, input));
      }
      if (stateMatch && stateMatch[2] === "card" && req.method === "GET") {
        const cycleId = new URL(req.url, "http://localhost").searchParams.get("cycle_id");
        if (!cycleId) return json(res, 400, { error: "cycle_id is required" });
        return json(res, 200, buildStateDecisionCard(db, cycleId));
      }
      if (req.method === "GET" && (req.url === "/" || req.url === "/dashboard")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(PRODUCT_DASHBOARD_HTML);
      }
      if (req.method === "POST" && req.url === "/v1/intake") {
        const input = await body(req);
        if (!input.message || typeof input.message !== "string") return json(res, 400, { error: "message is required" });
        const intakeId = newId("intake");
        const rawAnalysis = analyzeIntent(input.message);
        const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
        db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(intakeId, input.source ?? "unknown", canonicalJson({ message: input.message, metadata: input.metadata ?? {}, analysis }), now());
        appendEvent(db, "intake", intakeId, "intake.accepted", { source: input.source ?? "unknown" });
        return json(res, 202, { intake_id: intakeId, status: "accepted", routed_to: "tianshu-orchestrator", state_authority: "sqlite", next: "goal_manager", analysis });
      }
      if (req.method === "POST" && req.url === "/v1/device/events") {
        const input = await body(req);
        if (!input.device_id || !input.event_type) return json(res, 400, { error: "device_id and event_type are required" });
        const message = typeof input.payload?.text === "string" ? input.payload.text : `${input.event_type} from ${input.device_id}`;
        const rawAnalysis = analyzeIntent(message);
        const analysis = { ...rawAnalysis, operating_domain: classifyOperatingDomain(rawAnalysis) };
        const eventId = newId("device_event");
        db.prepare("INSERT INTO intake_events VALUES (?, ?, ?, 'accepted', ?)").run(eventId, `device:${input.device_id}`, canonicalJson({ device_id: input.device_id, event_type: input.event_type, payload: input.payload ?? {}, analysis }), input.observed_at ?? now());
        appendEvent(db, "device_event", eventId, "device_event.accepted", { device_id: input.device_id, event_type: input.event_type });
        return json(res, 202, { event_id: eventId, status: "accepted", routed_to: "tianshu-orchestrator", analysis });
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
