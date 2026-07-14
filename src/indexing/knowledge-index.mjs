import { appendEvent, canonicalJson, newId, now, sha256 } from "../core/store.mjs";
const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const parse = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const accessForExecution = (policy) => policy === "no_access" ? "protected" : policy === "read_only" ? "read_only" : "normal";

export function addKnowledgeTerm(db, entityId, term, weight = 1, source = "derived") {
  const value = String(term ?? "").trim(); if (!value) return;
  db.prepare("INSERT INTO knowledge_terms VALUES (?,?,?,?,?) ON CONFLICT(entity_id,normalized_term,source) DO UPDATE SET term=excluded.term,weight=excluded.weight").run(entityId, value, normalize(value), Number(weight), source);
}
export function addKnowledgeAlias(db, entityId, alias, source = "declared") {
  const value = String(alias ?? "").trim(); if (!value) return null;
  const normalized = normalize(value), existing = db.prepare("SELECT alias_id FROM knowledge_aliases WHERE entity_id=? AND normalized_alias=?").get(entityId, normalized);
  if (existing) return existing.alias_id;
  const id = newId("alias"); db.prepare("INSERT INTO knowledge_aliases VALUES (?,?,?,?,?,?)").run(id, entityId, value, normalized, source, now());
  addKnowledgeTerm(db, entityId, value, 8, "alias"); return id;
}
export function upsertKnowledgeEntity(db, input) {
  if (!input.entity_type || !input.canonical_key || !input.display_name) throw new Error("entity type, canonical key and display name are required");
  const stamp = now(), existing = db.prepare("SELECT entity_id FROM knowledge_entities WHERE entity_type=? AND canonical_key=?").get(input.entity_type, input.canonical_key), id = existing?.entity_id ?? newId("entity");
  db.prepare("INSERT INTO knowledge_entities VALUES (?,?,?,?,?,?,?,NULL,?,?,?) ON CONFLICT(entity_type,canonical_key) DO UPDATE SET display_name=excluded.display_name,access_policy=excluded.access_policy,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at").run(id, input.entity_type, input.canonical_key, input.display_name, input.access_policy ?? "normal", input.status ?? "active", input.valid_from ?? stamp, canonicalJson(input.metadata ?? {}), stamp, stamp);
  addKnowledgeAlias(db, id, input.display_name, "canonical"); addKnowledgeTerm(db, id, input.display_name, 10, "display_name");
  for (const alias of input.aliases ?? []) addKnowledgeAlias(db, id, alias, input.alias_source ?? "declared");
  return id;
}
export function recordKnowledgeSource(db, input) {
  if (!input.kind || !input.reference) throw new Error("source kind and reference are required");
  const contentHash = input.content_hash ?? sha256(canonicalJson(input.content ?? input.metadata ?? {})), existing = db.prepare("SELECT source_id FROM knowledge_sources WHERE source_kind=? AND reference=? AND content_hash=?").get(input.kind, input.reference, contentHash);
  if (existing) return existing.source_id;
  const id = newId("source"), stamp = now(); db.prepare("INSERT INTO knowledge_sources VALUES (?,?,?,?,?,?,?,?)").run(id, input.kind, input.reference, contentHash, input.observed_at ?? stamp, input.access_policy ?? "normal", canonicalJson(input.metadata ?? {}), stamp); return id;
}
export function recordKnowledgeEvidence(db, input) {
  if (!input.evidence_key || !input.entity_id || !input.source_id || !input.claim_type) throw new Error("evidence key, entity, source and claim type are required");
  const stamp = now(), existing = db.prepare("SELECT evidence_id FROM knowledge_evidence WHERE evidence_key=?").get(input.evidence_key), id = existing?.evidence_id ?? newId("evidence");
  db.prepare("INSERT INTO knowledge_evidence VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?) ON CONFLICT(evidence_key) DO UPDATE SET value_json=excluded.value_json,confidence=excluded.confidence,status=excluded.status,updated_at=excluded.updated_at").run(id, input.evidence_key, input.entity_id, input.source_id, input.claim_type, canonicalJson(input.value), input.confidence ?? "medium", input.status ?? "candidate", input.valid_from ?? stamp, stamp, stamp); return id;
}
export function syncCreatorPortfolioIndex(db) {
  const rows = db.prepare("SELECT project_key,display_name,lane,execution_policy,status,evidence_json,source_json FROM creator_project_profiles").all(), ids = [];
  for (const row of rows) ids.push(upsertKnowledgeEntity(db, { entity_type:"project", canonical_key:row.project_key, display_name:row.display_name, access_policy:accessForExecution(row.execution_policy), status:row.status==="protected"?"inactive":"active", aliases:[row.project_key], alias_source:"creator_portfolio", metadata:{lane:row.lane,execution_policy:row.execution_policy,evidence:parse(row.evidence_json,[]),source:parse(row.source_json,{})} }));
  return ids;
}
export function indexProjectChange(db, changeId) {
  syncCreatorPortfolioIndex(db);
  const row=db.prepare("SELECT * FROM project_change_candidates WHERE change_id=?").get(changeId); if(!row) throw new Error("project change not found");
  const entity=db.prepare("SELECT entity_id,access_policy FROM knowledge_entities WHERE entity_type='project' AND canonical_key=?").get(row.project_key); if(!entity||entity.access_policy==="protected") return null;
  const source=parse(row.source_json,{}), sourceId=recordKnowledgeSource(db,{kind:source.kind??"project_change",reference:source.reference??changeId,content:{proposed:parse(row.proposed_json),evidence:parse(row.evidence_json,[])},observed_at:row.created_at,access_policy:entity.access_policy,metadata:{change_id:changeId}});
  const evidenceId=recordKnowledgeEvidence(db,{evidence_key:"project_change:"+changeId,entity_id:entity.entity_id,source_id:sourceId,claim_type:"project."+row.change_type,value:parse(row.proposed_json),confidence:row.confidence,status:row.status==="accepted"?"confirmed":row.status==="rejected"?"rejected":row.status==="superseded"?"superseded":"candidate",valid_from:row.created_at});
  addKnowledgeTerm(db,entity.entity_id,row.summary,4,"project_change"); appendEvent(db,"knowledge_evidence",evidenceId,"knowledge.evidence_indexed",{change_id:changeId,entity_id:entity.entity_id}); return evidenceId;
}
export function updateIndexedProjectChangeDecision(db, changeId) {
  const row=db.prepare("SELECT status,decided_at FROM project_change_candidates WHERE change_id=?").get(changeId); if(!row)return null;
  const status=row.status==="accepted"?"confirmed":row.status==="rejected"?"rejected":"superseded"; db.prepare("UPDATE knowledge_evidence SET status=?,valid_to=CASE WHEN ?='confirmed' THEN NULL ELSE ? END,updated_at=? WHERE evidence_key=?").run(status,status,row.decided_at??now(),now(),"project_change:"+changeId); return status;
}
export function relateKnowledgeEntities(db,input){
  if(!input.from_entity_id||!input.to_entity_id||!input.relation_type)throw new Error("relation endpoints and type are required");
  const existing=db.prepare("SELECT relation_id FROM knowledge_relations WHERE from_entity_id=? AND to_entity_id=? AND relation_type=? AND evidence_id IS ?").get(input.from_entity_id,input.to_entity_id,input.relation_type,input.evidence_id??null); if(existing)return existing.relation_id;
  const id=newId("relation"),stamp=now(); db.prepare("INSERT INTO knowledge_relations VALUES (?,?,?,?,?,?,?,NULL,?,?,?)").run(id,input.from_entity_id,input.to_entity_id,input.relation_type,input.evidence_id??null,input.status??"candidate",input.valid_from??stamp,canonicalJson(input.metadata??{}),stamp,stamp); return id;
}
export function searchKnowledgeIndex(db,query,{include_protected=false,limit=20}={}){
  const q=normalize(query); if(!q)return[]; const access=include_protected?"":" AND e.access_policy!='protected'";
  const sql="SELECT e.entity_id,e.entity_type,e.canonical_key,e.display_name,e.access_policy,e.status,MAX(CASE WHEN t.normalized_term=? THEN t.weight*2 ELSE t.weight END) score FROM knowledge_entities e JOIN knowledge_terms t ON t.entity_id=e.entity_id WHERE (t.normalized_term LIKE ? OR ? LIKE '%'||t.normalized_term||'%')"+access+" GROUP BY e.entity_id ORDER BY score DESC,e.display_name LIMIT ?";
  return db.prepare(sql).all(q,"%"+q+"%",q,Number(limit));
}
export function getKnowledgeEntity(db,entityId,{include_protected=false}={}){
  const row=db.prepare("SELECT * FROM knowledge_entities WHERE entity_id=?").get(entityId); if(!row||(row.access_policy==="protected"&&!include_protected))return null;
  return {...row,metadata:parse(row.metadata_json,{}),aliases:db.prepare("SELECT alias,source FROM knowledge_aliases WHERE entity_id=? ORDER BY alias").all(entityId),evidence:db.prepare("SELECT e.evidence_id,e.evidence_key,e.claim_type,e.value_json,e.confidence,e.status,e.valid_from,e.valid_to,s.source_kind,s.reference,s.content_hash FROM knowledge_evidence e JOIN knowledge_sources s ON s.source_id=e.source_id WHERE e.entity_id=? ORDER BY e.created_at DESC").all(entityId).map(item=>({...item,value:parse(item.value_json)})),outgoing:db.prepare("SELECT r.*,e.display_name target_name FROM knowledge_relations r JOIN knowledge_entities e ON e.entity_id=r.to_entity_id WHERE r.from_entity_id=? ORDER BY r.created_at DESC").all(entityId),incoming:db.prepare("SELECT r.*,e.display_name source_name FROM knowledge_relations r JOIN knowledge_entities e ON e.entity_id=r.from_entity_id WHERE r.to_entity_id=? ORDER BY r.created_at DESC").all(entityId)};
}
export function getKnowledgeIndexHealth(db){
  const visible=db.prepare("SELECT entity_id FROM knowledge_entities WHERE access_policy!='protected' AND status='active'").all(),withEvidence=db.prepare("SELECT COUNT(DISTINCT e.entity_id) count FROM knowledge_entities e JOIN knowledge_evidence v ON v.entity_id=e.entity_id WHERE e.access_policy!='protected'").get().count,withAliases=db.prepare("SELECT COUNT(DISTINCT e.entity_id) count FROM knowledge_entities e JOIN knowledge_aliases a ON a.entity_id=e.entity_id WHERE e.access_policy!='protected'").get().count;
  const conflicts=db.prepare("SELECT COUNT(*) count FROM (SELECT entity_id,claim_type FROM knowledge_evidence WHERE status='candidate' GROUP BY entity_id,claim_type HAVING COUNT(DISTINCT value_json)>1)").get().count,missing=visible.filter(({entity_id})=>!db.prepare("SELECT 1 FROM knowledge_evidence WHERE entity_id=?").get(entity_id)).map(({entity_id})=>db.prepare("SELECT entity_id,entity_type,display_name FROM knowledge_entities WHERE entity_id=?").get(entity_id));
  return {entities:db.prepare("SELECT COUNT(*) count FROM knowledge_entities").get().count,visible_entities:visible.length,protected_entities:db.prepare("SELECT COUNT(*) count FROM knowledge_entities WHERE access_policy='protected'").get().count,aliases:db.prepare("SELECT COUNT(*) count FROM knowledge_aliases").get().count,sources:db.prepare("SELECT COUNT(*) count FROM knowledge_sources").get().count,evidence:db.prepare("SELECT COUNT(*) count FROM knowledge_evidence").get().count,relations:db.prepare("SELECT COUNT(*) count FROM knowledge_relations").get().count,evidence_coverage:visible.length?Math.round(withEvidence/visible.length*100):100,alias_coverage:visible.length?Math.round(withAliases/visible.length*100):100,conflicts,gaps:missing};
}
export function rebuildKnowledgeIndex(db) {
  syncCreatorPortfolioIndex(db);
  const entity = (type,key,name,metadata={}) => upsertKnowledgeEntity(db,{entity_type:type,canonical_key:key,display_name:name,metadata});
  const goals=new Map();
  for(const row of db.prepare("SELECT goal_id,contract_json,status,created_at FROM goals").all()){const contract=parse(row.contract_json,{});goals.set(row.goal_id,entity("goal",row.goal_id,contract.objective??row.goal_id,{status:row.status,contract}));}
  const plans=new Map();
  for(const row of db.prepare("SELECT plan_id,goal_id,plan_json,status,risk_level FROM plans").all()){const spec=parse(row.plan_json,{}),id=entity("plan",row.plan_id,spec.objective??spec.action??row.plan_id,{status:row.status,risk_level:row.risk_level,spec});plans.set(row.plan_id,id);if(goals.has(row.goal_id))relateKnowledgeEntities(db,{from_entity_id:goals.get(row.goal_id),to_entity_id:id,relation_type:"has_plan",status:"confirmed"});const projectKey=spec.project_key??spec.project_id;if(projectKey){const p=db.prepare("SELECT entity_id FROM knowledge_entities WHERE entity_type='project' AND canonical_key=?").get(projectKey);if(p)relateKnowledgeEntities(db,{from_entity_id:p.entity_id,to_entity_id:goals.get(row.goal_id),relation_type:"has_goal",status:"confirmed"});}}
  const tasks=new Map();
  for(const row of db.prepare("SELECT task_id,plan_id,status FROM tasks").all()){const id=entity("task",row.task_id,row.task_id,{status:row.status});tasks.set(row.task_id,id);if(plans.has(row.plan_id))relateKnowledgeEntities(db,{from_entity_id:plans.get(row.plan_id),to_entity_id:id,relation_type:"has_task",status:"confirmed"});}
  const runs=new Map();
  for(const row of db.prepare("SELECT run_id,task_id,status,attempt,executor_result_json FROM runs").all()){const id=entity("run",row.run_id,row.run_id,{status:row.status,attempt:row.attempt,executor:parse(row.executor_result_json,{})});runs.set(row.run_id,id);if(tasks.has(row.task_id))relateKnowledgeEntities(db,{from_entity_id:tasks.get(row.task_id),to_entity_id:id,relation_type:"has_run",status:"confirmed"});}
  for(const row of db.prepare("SELECT * FROM agents").all())entity("agent",row.agent_id,row.display_name,{risk_level:row.risk_level,status:row.status});
  for(const row of db.prepare("SELECT * FROM verifications").all()){const runId=runs.get(row.run_id);if(!runId)continue;const sourceId=recordKnowledgeSource(db,{kind:"verification",reference:row.verification_id,content_hash:sha256(row.report_json),observed_at:row.created_at,metadata:{verifier:row.verifier}});recordKnowledgeEvidence(db,{evidence_key:"verification:"+row.verification_id,entity_id:runId,source_id:sourceId,claim_type:"run.verification",value:{passed:Boolean(row.passed),report:parse(row.report_json,{})},confidence:"high",status:"confirmed",valid_from:row.created_at});const agentKey=row.verifier.startsWith("agent:")?row.verifier.slice(6):row.verifier;const reviewer=db.prepare("SELECT entity_id FROM knowledge_entities WHERE entity_type='agent' AND canonical_key=?").get(agentKey);if(reviewer)relateKnowledgeEntities(db,{from_entity_id:runId,to_entity_id:reviewer.entity_id,relation_type:"reviewed_by",status:"confirmed"});}
  for(const row of db.prepare("SELECT change_id FROM project_change_candidates").all())indexProjectChange(db,row.change_id);
  return getKnowledgeIndexHealth(db);
}