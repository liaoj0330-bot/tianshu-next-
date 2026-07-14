import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const cwdIndex = args.indexOf("-C");
const outputIndex = args.indexOf("-o");
const repoRoot = args[cwdIndex + 1];
const outputPath = args[outputIndex + 1];
const prompt = args.at(-1);

// Real `codex exec` waits for piped stdin before starting. The adapter must send EOF.
for await (const _chunk of process.stdin) {
  // No additional prompt input is accepted by this fixture.
}

if (prompt.includes("crlf_success")) {
  writeFileSync(join(repoRoot, "fixture.txt"), "codex adapter verified\r\n");
} else if (prompt.includes("success")) {
  writeFileSync(join(repoRoot, "fixture.txt"), "codex adapter verified\n");
} else if (prompt.includes("scope_violation")) {
  writeFileSync(join(repoRoot, "fixture.txt"), "codex adapter verified\n");
  writeFileSync(join(repoRoot, "outside.txt"), "not allowed\n");
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, "Done.\n");
console.log("fake Codex completed");
