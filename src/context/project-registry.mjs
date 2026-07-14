import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const LEVELS = new Set(["L0", "L1", "L2", "L3"]);

function canonical(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${candidate.includes("\\") ? "\\" : "/"}`) && !isAbsolute(rel));
}

function safeRealpath(path, label) {
  try { return realpathSync(path); } catch { throw new Error(`${label} does not exist: ${path}`); }
}

export function validateProjectDefinition(definition) {
  if (!definition?.project_id || !definition?.name || !definition?.root_path) {
    throw new Error("project requires project_id, name, and root_path");
  }
  if (!Array.isArray(definition.context_files) || definition.context_files.length === 0) {
    throw new Error("project requires at least one context file");
  }
  if (!Array.isArray(definition.allowed_paths)) throw new Error("project requires allowed_paths");
  const root = safeRealpath(resolve(definition.root_path), "project root");
  const allowed = definition.allowed_paths.map((path) => safeRealpath(resolve(path), "allowed path"));
  for (const path of allowed) if (!inside(root, path)) throw new Error(`allowed path escapes project root: ${path}`);
  const context = definition.context_files.map((path) => safeRealpath(resolve(path), "context file"));
  for (const path of context) {
    if (!inside(root, path) || !allowed.some((base) => inside(base, path))) {
      throw new Error(`context file is outside the project allowlist: ${path}`);
    }
    if (!statSync(path).isFile()) throw new Error(`context path is not a file: ${path}`);
  }
  if (definition.default_risk_level && !LEVELS.has(definition.default_risk_level)) {
    throw new Error("default_risk_level must be L0, L1, L2, or L3");
  }
  return { ...definition, root_path: root, allowed_paths: allowed, context_files: context };
}

export function registerProject(registry, definition) {
  const project = validateProjectDefinition(definition);
  if (registry.has(project.project_id)) throw new Error(`project already registered: ${project.project_id}`);
  registry.set(project.project_id, Object.freeze(project));
  return project.project_id;
}

export function getProject(registry, projectId) {
  const project = registry.get(projectId);
  if (!project) throw new Error(`unknown project: ${projectId}`);
  return project;
}

export function buildMinimalContext(registry, projectId) {
  const project = getProject(registry, projectId);
  const files = project.context_files.map((path) => {
    const content = readFileSync(path, "utf8");
    return { path, sha256: createHash("sha256").update(content).digest("hex"), content };
  });
  const context = {
    project_id: project.project_id,
    name: project.name,
    root_path: project.root_path,
    purpose: project.purpose ?? null,
    default_risk_level: project.default_risk_level ?? "L0",
    sources: files,
  };
  return { ...context, context_sha256: createHash("sha256").update(canonical(context)).digest("hex") };
}

export function assertPathAllowed(registry, projectId, targetPath, requiredLevel = "L0") {
  if (!LEVELS.has(requiredLevel)) throw new Error("required level must be L0, L1, L2, or L3");
  const project = getProject(registry, projectId);
  const target = resolve(targetPath);
  if (!project.allowed_paths.some((base) => inside(base, target))) {
    throw new Error(`path denied by project allowlist: ${target}`);
  }
  if (["L2", "L3"].includes(requiredLevel) && !project.approval_levels?.includes(requiredLevel)) {
    throw new Error(`${requiredLevel} action requires explicit project approval`);
  }
  return { project_id: projectId, target_path: target, risk_level: requiredLevel, allowed: true };
}
