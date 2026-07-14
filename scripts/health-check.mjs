import { resolveRuntimeConfig } from "../src/config/runtime-config.mjs";

const config = resolveRuntimeConfig();
const response = await fetch("http://" + config.host + ":" + config.port + "/health");
const body = await response.json();
if (!response.ok || body.status !== "ok" || body.state_store !== "sqlite") process.exitCode = 1;
console.log(JSON.stringify(body));