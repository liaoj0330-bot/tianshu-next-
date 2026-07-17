import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { openStore, sha256 } from "../src/core/store.mjs";
import { ingestAdvisoryDocument } from "../src/advisory/external-advice.mjs";
import { WU_20260714_REVIEW } from "../src/advisory/wu-20260714-review.mjs";

const DOCUMENTS = [
  { id: "TS-HO-02", title: "言出法随：项目总纲与核心原则(1).md", file: "02_言出法随_项目总纲与核心原则(1).md" },
  { id: "TS-HO-03", title: "天枢：项目阶段履历与当前状态.md", file: "03_天枢_项目阶段履历与当前状态.md" },
  { id: "TS-HO-06", title: "天枢：审美体系与产品体验规范.md", file: "06_天枢_审美体系与产品体验规范.md" },
  { id: "TS-HO-05", title: "工程资产与ChatGPT_Codex_GitHub协作规则.md", file: "05_工程资产与ChatGPT_Codex_GitHub协作规则.md" },
];

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  return value && !value.startsWith("--") ? value : fallback;
}

const sourceDirArgument = argument("--source-dir");
if (!sourceDirArgument) {
  throw new Error("--source-dir is required and must contain the four Wu documents");
}
const sourceDir = resolve(sourceDirArgument);
const statePath = resolve(argument("--state", ".tianshu/state.sqlite"));
if (!statSync(sourceDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("--source-dir must point to the directory containing the four Wu documents");
}

const db = openStore(statePath);
try {
  const imported = [];
  for (const document of DOCUMENTS) {
    const path = resolve(sourceDir, document.file);
    const content = readFileSync(path);
    const source = ingestAdvisoryDocument(db, {
      source_kind: "wu_teacher_document",
      document_id: document.id,
      title: document.title,
      author: "吴老师",
      external_ref: path,
      content_hash: sha256(content),
      trust_scope: "advisory_only",
      metadata: { imported_by: "scripts/import-wu-advice.mjs", file: document.file },
      recommendations: WU_20260714_REVIEW[document.id],
    });
    imported.push({
      document_id: document.id,
      source_id: source.source_id,
      recommendation_count: source.recommendations.length,
      content_hash: source.content_hash,
    });
  }
  process.stdout.write(JSON.stringify({ state_authority: "sqlite", imported }, null, 2) + "\n");
} finally {
  db.close();
}
