import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { canonicalJson, openStore, sha256 } from "../src/core/store.mjs";
import { upsertCreatorProjectBaseline } from "../src/creator/project-priority.mjs";
import {
  BASE_PAGES,
  MANIFEST_PATH,
  buildObsidianReadModel,
} from "../src/product/obsidian-read-model.mjs";

function databaseSnapshot(db) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  return canonicalJson(Object.fromEntries(tables.map((table) => [
    table,
    db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all(),
  ])));
}

function generatedSnapshot(root) {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  return {
    manifest: readFileSync(join(root, MANIFEST_PATH), "utf8"),
    files: Object.fromEntries(manifest.files.map((file) => [
      file.path,
      readFileSync(join(root, file.path), "utf8"),
    ])),
  };
}

function assertLinksResolve(root, files) {
  for (const [source, content] of Object.entries(files)) {
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu)) {
      const target = `${match[1]}.md`;
      assert.ok(existsSync(join(root, target)), `${source} links to missing ${target}`);
    }
  }
}

test("Obsidian read model is isolated, deterministic, recoverable, and read-only over SQLite", () => {
  const root = mkdtempSync(join(tmpdir(), "tianshu-obsidian-"));
  const statePath = join(root, "state.sqlite");
  const output = join(root, "generated-vault");
  const db = openStore(statePath);
  try {
    upsertCreatorProjectBaseline(db, {
      source: { kind: "test", reference: "obsidian-read-model", version: "1" },
      projects: [
        {
          project_key: "tianshu",
          display_name: "天枢个人 AI 工作操作系统",
          lane: "main",
          baseline_priority: 5,
          execution_policy: "eligible_after_approval",
          status: "active",
          evidence: [],
        },
        {
          project_key: "protected-secret",
          display_name: "不应出现在镜像中的项目",
          lane: "protected",
          baseline_priority: 1,
          execution_policy: "no_access",
          status: "protected",
          evidence: [],
        },
      ],
    });
    const machineBefore = databaseSnapshot(db);
    const first = buildObsidianReadModel(db, output);
    const baseline = generatedSnapshot(output);

    assert.equal(first.state_authority, "sqlite");
    assert.equal(databaseSnapshot(db), machineBefore);
    for (const path of Object.values(BASE_PAGES)) assert.ok(existsSync(join(output, path)), path);
    const home = baseline.files[BASE_PAGES.home];
    assert.match(home, /state_authority: sqlite/u);
    assert.match(home, /AgentHub/u);
    assert.match(home, /SQLite：唯一机器状态真相源/u);
    assert.match(home, /Obsidian：奈奈可读、可确认的知识工作台/u);
    assert.match(home, /`90_待处理` 变为本页的动态待确认视图/u);
    assert.match(home, /`98_历史归档` 变为活动与审计的时间筛选/u);
    assert.match(home, /`06_项目记忆层` 与 `30_项目推进区` 合并/u);
    assert.match(home, /`07_资产索引层` 进入证据索引/u);
    assert.doesNotMatch(home, /```json/u);
    const allGenerated = JSON.stringify(baseline.files);
    assert.doesNotMatch(allGenerated, /protected-secret|不应出现在镜像中的项目/u);
    const projectHome = Object.keys(baseline.files).find(
      (path) => path.startsWith("20_项目/项目_") && path.endsWith("/00_项目首页.md"),
    );
    assert.ok(projectHome, "visible project gets a dedicated folder");
    const projectRoot = dirname(projectHome);
    for (const pageName of ["10_当前状态.md", "20_时间线.md", "30_判断与证据.md"]) {
      assert.ok(baseline.files[`${projectRoot}/${pageName}`], pageName);
    }
    assert.match(baseline.files[projectHome], /当前状态/u);
    assert.match(baseline.files[projectHome], /时间线/u);
    assert.match(baseline.files[projectHome], /判断与证据/u);
    assertLinksResolve(output, baseline.files);

    buildObsidianReadModel(db, output);
    assert.deepEqual(generatedSnapshot(output), baseline);
    assert.equal(databaseSnapshot(db), machineBefore);

    const editedPath = join(output, BASE_PAGES.home);
    writeFileSync(editedPath, "manual edit must not become machine state\n", "utf8");
    buildObsidianReadModel(db, output);
    assert.equal(readFileSync(editedPath, "utf8"), baseline.files[BASE_PAGES.home]);
    assert.equal(databaseSnapshot(db), machineBefore);

    const deletedRelative = BASE_PAGES.knowledge;
    rmSync(join(output, deletedRelative));
    buildObsidianReadModel(db, output);
    assert.equal(readFileSync(join(output, deletedRelative), "utf8"), baseline.files[deletedRelative]);

    const personalPath = join(output, "我的临时笔记.md");
    writeFileSync(personalPath, "不属于生成器的文件必须保留\n", "utf8");
    buildObsidianReadModel(db, output);
    assert.equal(readFileSync(personalPath, "utf8"), "不属于生成器的文件必须保留\n");
    assert.equal(databaseSnapshot(db), machineBefore);

    const manifest = JSON.parse(readFileSync(join(output, MANIFEST_PATH), "utf8"));
    for (const file of manifest.files) {
      const content = readFileSync(join(output, file.path));
      assert.equal(sha256(content), file.sha256, relative(dirname(output), join(output, file.path)));
      assert.equal(content.byteLength, file.size_bytes);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
