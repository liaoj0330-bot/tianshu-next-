import { appendEvent, now } from "../core/store.mjs";
import { getProject, registerProject, validateProjectDefinition } from "./project-registry.mjs";

export function saveProject(db, definition) {
  const project = validateProjectDefinition(definition);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM projects WHERE project_id = ?").get(project.project_id)) {
      throw new Error(`project already registered: ${project.project_id}`);
    }
    db.prepare(`INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(project.project_id, project.name, project.root_path, project.purpose ?? null,
        project.default_risk_level ?? "L0", JSON.stringify(project.approval_levels ?? []), timestamp, timestamp);
    const insertPath = db.prepare("INSERT INTO project_paths VALUES (?, ?, ?)");
    for (const path of project.allowed_paths) insertPath.run(project.project_id, path, "allowed");
    for (const path of project.context_files) insertPath.run(project.project_id, path, "context");
    appendEvent(db, "project", project.project_id, "project.registered", {
      root_path: project.root_path,
      allowed_paths: project.allowed_paths,
      context_files: project.context_files,
    });
    db.exec("COMMIT");
    return project.project_id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadProjectRegistry(db) {
  const registry = new Map();
  for (const row of db.prepare("SELECT * FROM projects ORDER BY project_id").all()) {
    const paths = db.prepare("SELECT path, path_kind FROM project_paths WHERE project_id = ? ORDER BY path").all(row.project_id);
    registerProject(registry, {
      project_id: row.project_id,
      name: row.name,
      root_path: row.root_path,
      purpose: row.purpose,
      default_risk_level: row.default_risk_level,
      approval_levels: JSON.parse(row.approval_levels_json),
      allowed_paths: paths.filter((path) => path.path_kind === "allowed").map((path) => path.path),
      context_files: paths.filter((path) => path.path_kind === "context").map((path) => path.path),
    });
  }
  return registry;
}

export function getPersistedProject(db, projectId) {
  return getProject(loadProjectRegistry(db), projectId);
}
