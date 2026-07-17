import { spawn } from "node:child_process";
import { resolve } from "node:path";

const cwd = resolve(import.meta.dirname, "..");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "Path"));
const child = spawn(process.execPath, [resolve(cwd, "scripts/tianshu-service.mjs")], {
  cwd,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: {
    ...environment,
    TIANSHU_HOST: process.env.TIANSHU_HOST ?? "0.0.0.0",
    TIANSHU_ALLOW_REMOTE: process.env.TIANSHU_ALLOW_REMOTE ?? "1",
    TIANSHU_PORT: process.env.TIANSHU_PORT ?? "4317",
  },
});

child.unref();
console.log(JSON.stringify({ status: "starting", pid: child.pid, host: "0.0.0.0", port: 4317 }));
