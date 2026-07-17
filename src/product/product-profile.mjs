export const PRIMARY_PROFILE_ID = "primary";
export const DEFAULT_CREATOR_ID = "local_creator";
const now = () => new Date().toISOString();

function requiredText(value, field, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > maxLength) throw new Error(`${field} is too long`);
  return normalized;
}

export function getProductProfile(db) {
  const profile = db.prepare(`
    SELECT profile_id,actor_id,display_name,locale,timezone,onboarding_status,
           created_at,updated_at
    FROM product_profiles WHERE profile_id=?
  `).get(PRIMARY_PROFILE_ID);
  if (!profile) throw new Error("primary product profile is not initialized");
  return profile;
}

export function updateProductProfile(db, input = {}) {
  const current = getProductProfile(db);
  const displayName = requiredText(input.display_name ?? current.display_name, "display_name", 80);
  const locale = requiredText(input.locale ?? current.locale, "locale", 32);
  const timezone = requiredText(input.timezone ?? current.timezone, "timezone", 80);
  const onboardingStatus = input.onboarding_status ?? current.onboarding_status;
  if (!["needs_profile", "ready"].includes(onboardingStatus)) throw new Error("invalid onboarding_status");
  const updatedBy = requiredText(input.updated_by, "updated_by", 120).toLowerCase();
  if (![current.actor_id, "creator", "nainai", "奈奈", current.display_name.toLowerCase()].includes(updatedBy)) {
    throw new Error("only the local creator can update the product profile");
  }
  const changed = displayName !== current.display_name || locale !== current.locale ||
    timezone !== current.timezone || onboardingStatus !== current.onboarding_status;
  if (!changed) return current;
  const timestamp = now();
  const version = db.prepare("SELECT COALESCE(MAX(version),0)+1 version FROM product_profile_revisions WHERE profile_id=?").get(current.profile_id).version;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO product_profile_revisions(
        revision_id,profile_id,version,display_name,locale,timezone,
        onboarding_status,updated_by,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(`profile_revision_${version}`, current.profile_id, version, displayName, locale,
      timezone, onboardingStatus, current.actor_id, timestamp);
    db.prepare(`
      UPDATE product_profiles
      SET display_name=?,locale=?,timezone=?,onboarding_status=?,updated_at=?
      WHERE profile_id=?
    `).run(displayName, locale, timezone, onboardingStatus, timestamp, current.profile_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getProductProfile(db);
}
