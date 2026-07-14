import { resolveRuntimeConfig } from "../src/config/runtime-config.mjs";
import { createTianShuService } from "../src/app/service.mjs";

const config = resolveRuntimeConfig();
const service = await createTianShuService(config);
console.log(JSON.stringify({ status: "online", address: service.address, state: config.statePath }));

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ status: "stopping", signal }));
  await service.stop();
  process.exit(0);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));