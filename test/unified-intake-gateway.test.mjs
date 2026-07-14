import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { openStore } from "../src/core/store.mjs";
import { createGateway } from "../src/gateway/server.mjs";

const runtime = resolve(".unified-intake-gateway-test-runtime");
let db;
let gateway;

afterEach(async () => {
  await gateway?.close();
  db?.close();
  rmSync(runtime, { recursive: true, force: true });
});

test("one intake returns and persists the same product interaction decision", async () => {
  db = openStore(join(runtime, "state.sqlite"));
  gateway = createGateway({ db });
  const address = await gateway.listen();
  const base = `http://${address.address}:${address.port}`;
  const response = await fetch(base + "/v1/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "agenthub-dev", message: "今天高校项目进入专家确认阶段" }),
  });
  const accepted = await response.json();
  assert.equal(response.status, 202);
  assert.equal(accepted.interaction.mode, "state_candidate");
  assert.equal(accepted.interaction.execution_allowed, false);

  const list = await fetch(base + "/v1/intakes").then((item) => item.json());
  assert.equal(list.items[0].message, "今天高校项目进入专家确认阶段");
  assert.deepEqual(list.items[0].interaction, accepted.interaction);
});
