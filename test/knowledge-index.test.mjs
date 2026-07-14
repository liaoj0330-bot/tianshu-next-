import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";
import { proposeProjectChange, decideProjectChange } from "../src/creator/project-changes.mjs";
import { getKnowledgeIndexHealth, getKnowledgeEntity, relateKnowledgeEntities, searchKnowledgeIndex, syncCreatorPortfolioIndex, upsertKnowledgeEntity } from "../src/indexing/knowledge-index.mjs";
import { createGateway } from "../src/gateway/server.mjs";

const runtime=resolve(".knowledge-index-test-runtime"); let db,gateway;
afterEach(async()=>{await gateway?.close();db?.close();rmSync(runtime,{recursive:true,force:true});gateway=null;db=null});
function setup(){
 db=openStore(join(runtime,"state.sqlite"));
 upsertCreatorProjectBaseline(db,{source:{kind:"test",reference:"portfolio",version:"1"},projects:[
  {project_key:"tianshu",display_name:"天枢个人 AI 工作操作系统",lane:"main",baseline_priority:5,execution_policy:"eligible_after_approval",status:"active",evidence:[]},
  {project_key:"protected",display_name:"受保护项目",lane:"protected",baseline_priority:1,execution_policy:"no_access",status:"protected",evidence:[]}
 ]});
 syncCreatorPortfolioIndex(db);
}
test("index unifies aliases, sources and temporal evidence while filtering protected entities",()=>{
 setup();
 const change=proposeProjectChange(db,"tianshu",{change_type:"stage",summary:"进入索引加厚阶段",proposed_value:"indexing",source:{kind:"conversation",reference:"turn-1"},evidence:[{kind:"test"}],confidence:"high"});
 let health=getKnowledgeIndexHealth(db); assert.equal(health.entities,2); assert.equal(health.protected_entities,1); assert.equal(health.evidence,1);
 const found=searchKnowledgeIndex(db,"天枢"); assert.equal(found.length,1); assert.equal(found[0].canonical_key,"tianshu");
 assert.deepEqual(searchKnowledgeIndex(db,"受保护项目"),[]);
 const entity=getKnowledgeEntity(db,found[0].entity_id); assert.equal(entity.evidence[0].status,"candidate"); assert.equal(entity.evidence[0].source_kind,"conversation"); assert.equal(entity.evidence[0].content_hash.length,64);
 decideProjectChange(db,change.change_id,{decision:"accept",decided_by:"creator"});
 assert.equal(getKnowledgeEntity(db,found[0].entity_id).evidence[0].status,"confirmed");
});
test("relations are explicit, evidenced and navigable",()=>{
 setup(); const project=searchKnowledgeIndex(db,"天枢")[0]; const goal=upsertKnowledgeEntity(db,{entity_type:"goal",canonical_key:"goal-1",display_name:"索引层加厚"});
 const relation=relateKnowledgeEntities(db,{from_entity_id:project.entity_id,to_entity_id:goal,relation_type:"has_goal",status:"confirmed"});
 assert.ok(relation); assert.equal(getKnowledgeEntity(db,project.entity_id).outgoing[0].target_name,"索引层加厚");
});
test("gateway exposes health, permission-filtered search and entity detail",async()=>{
 setup(); gateway=createGateway({db}); const address=await gateway.listen(); const base="http://"+address.address+":"+address.port;
 const health=await fetch(base+"/v1/index/health").then(r=>r.json()); assert.equal(health.entities,2);
 const search=await fetch(base+"/v1/index/search?q="+encodeURIComponent("tianshu")).then(r=>r.json()); assert.equal(search.items[0].canonical_key,"tianshu");
 const detail=await fetch(base+"/v1/index/entities/"+search.items[0].entity_id).then(r=>r.json()); assert.equal(detail.entity.display_name,"天枢个人 AI 工作操作系统");
});