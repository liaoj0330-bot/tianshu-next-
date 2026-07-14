export function classifyOperatingDomain(analysis) {
  const domains = new Set(analysis?.domains ?? []);
  const hasWork = domains.has("project") || domains.has("creator");
  const hasLife = domains.has("life");
  if (hasWork && hasLife) return "mixed_with_separate_records";
  if (hasLife) return "life";
  if (hasWork) return "work";
  return domains.has("system") ? "system" : "unclassified";
}
