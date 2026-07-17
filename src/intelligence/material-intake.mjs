const URL_PATTERN = /https?:\/\/[^\s]+/giu;
const WINDOWS_PATH_PATTERN = /(?:^|\s)([a-zA-Z]:\\[^\r\n]+)/gmu;
const FILE_MARKER_PATTERN = /\[File(?:\s+[^\]]*)?\]/giu;
const IMAGE_PATTERN = /\[(?:Image|图片)[^\]]*\]|\.(?:png|jpe?g|webp|gif|heic)(?:\s|$)/giu;
const AUDIO_PATTERN = /\[(?:Audio|录音|语音)[^\]]*\]|\.(?:mp3|m4a|wav|aac|flac)(?:\s|$)/giu;
const SUBMITTED_KINDS = new Set(["file", "text", "document", "spreadsheet", "image", "audio", "video"]);

const TOPICS = [
  { key: "ai_quant", label: "AI 量化系统", pattern: /量化|炒股|交易|选股|投资|巴菲特|芒格|梁文峰/giu },
  { key: "ai_education", label: "高校 AI 教育", pattern: /高校|教育|课程|产教融合|宣发/giu },
  { key: "creator_business", label: "内容与个人品牌", pattern: /抖音|内容|账号|个人\s*IP|获客|客户/giu },
  { key: "product", label: "产品与系统建设", pattern: /产品|系统|工作台|AgentHub|天枢|言出法随/giu },
];

function matches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)];
}

function cleanLocator(value) {
  return value.replace(/[，。；;！!？?)）\]}]+$/u, "");
}

function sourceFor(locator) {
  if (!locator.startsWith("http")) return "local_file";
  try {
    const host = new URL(locator).hostname.replace(/^www\./, "");
    if (host.endsWith("douyin.com")) return "douyin";
    return host;
  } catch {
    return "web";
  }
}

function lineContext(text, locator) {
  const line = text.split(/\r?\n/u).find((item) => item.includes(locator)) ?? "";
  return line.replace(locator, "").replace(/^\s*[\d.]+\s*/u, "").trim().slice(0, 180);
}

function linkName(locator, context) {
  if (context) return context.replace(/[｜|]\s*$/u, "").trim().slice(0, 180);
  try {
    return new URL(locator).hostname.replace(/^www\./u, "");
  } catch {
    return "链接材料";
  }
}

function submittedKind(item) {
  if (SUBMITTED_KINDS.has(item?.kind)) return item.kind;
  const mediaType = String(item?.media_type ?? "").toLowerCase();
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("text/")) return "text";
  return "file";
}

export function normalizeSubmittedMaterials(materials) {
  if (!Array.isArray(materials)) return [];
  return materials.filter((item) => item && typeof item === "object").map((item, index) => {
    const kind = submittedKind(item);
    const textContent = typeof item.text_content === "string" ? item.text_content : null;
    const contentDataUrl = typeof item.content_data_url === "string" && item.content_data_url.startsWith("data:") ? item.content_data_url : null;
    const pendingStatus = kind === "image"
      ? "preserved_pending_vision"
      : kind === "audio"
        ? "preserved_pending_transcription"
        : kind === "video"
          ? "preserved_pending_media_analysis"
        : "metadata_preserved_pending_extraction";
    return {
      attachment_id: String(item.attachment_id ?? `attachment_${index + 1}`),
      submitted_position: index + 1,
      kind,
      name: String(item.name ?? `${kind}_${index + 1}`).slice(0, 240),
      media_type: String(item.media_type ?? "application/octet-stream").slice(0, 160),
      size_bytes: Number.isFinite(Number(item.size_bytes)) ? Number(item.size_bytes) : null,
      last_modified_at: item.last_modified_at ? String(item.last_modified_at) : null,
      content_status: textContent != null
        ? "text_preserved"
        : contentDataUrl
          ? pendingStatus
          : String(item.content_status ?? pendingStatus),
      text_content: textContent,
      content_data_url: contentDataUrl,
    };
  });
}

function submittedMaterialItems(materials, startIndex) {
  return materials.map((item, index) => ({
    material_id: `material_${startIndex + index + 1}`,
    kind: item.kind,
    source: "agenthub_attachment",
    locator: null,
    attachment_id: item.attachment_id,
    submitted_position: item.submitted_position,
    name: item.name,
    media_type: item.media_type,
    size_bytes: item.size_bytes,
    content_status: item.content_status,
    context: item.kind === "image" ? "图片输入" : item.kind === "audio" ? "语音或录音输入" : "文件输入",
  }));
}

export function extractMaterialItems(text) {
  const source = String(text ?? "");
  const candidates = [];
  const add = (match, kind, priority, value = match[0]) => {
    const offset = match[0].indexOf(value);
    const start = (match.index ?? 0) + Math.max(0, offset);
    candidates.push({ start, end: start + value.length, kind, priority, value });
  };
  for (const match of matches(source, URL_PATTERN)) {
    add(match, "link", 1);
  }
  for (const match of matches(source, WINDOWS_PATH_PATTERN)) {
    add(match, "file", 2, match[1]);
  }
  for (const match of matches(source, FILE_MARKER_PATTERN)) add(match, "file", 3);
  for (const match of matches(source, IMAGE_PATTERN)) add(match, "image", 3);
  for (const match of matches(source, AUDIO_PATTERN)) add(match, "audio", 3);

  const accepted = [];
  for (const candidate of candidates.sort((left, right) => left.start - right.start || left.priority - right.priority)) {
    if (accepted.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    accepted.push(candidate);
  }
  return accepted.map((item, index) => {
    const context = lineContext(source, item.value);
    if (item.kind === "link") {
      const locator = cleanLocator(item.value);
      return {
        material_id: `material_${index + 1}`,
        kind: "link",
        source: sourceFor(locator),
        locator,
        name: linkName(locator, context),
        media_type: "text/uri-list",
        content_status: "source_preserved_pending_access",
        context,
      };
    }
    if (item.priority === 2) {
      const locator = cleanLocator(item.value.trim());
      return { material_id: `material_${index + 1}`, kind: "file", source: "local_file", locator, context };
    }
    const inputContext = item.kind === "image"
      ? "图片输入"
      : item.kind === "audio"
        ? "语音或录音输入"
        : "文件输入";
    return { material_id: `material_${index + 1}`, kind: item.kind, source: "attachment", locator: null, context: inputContext };
  });
}

export function containsMaterial(text, submittedMaterials = []) {
  return extractMaterialItems(text).length > 0 || normalizeSubmittedMaterials(submittedMaterials).length > 0;
}

function inferTopic(text) {
  const ranked = TOPICS.map((topic) => ({ ...topic, count: matches(text, topic.pattern).length }))
    .filter((topic) => topic.count > 0)
    .sort((left, right) => right.count - left.count);
  return ranked[0] ?? { key: "unclassified", label: "待命名项目线索", count: 0 };
}

function extractUnverifiedClaims(text) {
  const claims = [];
  const patterns = [
    /[^\r\n，。；]{0,28}(?:收益|赚了|做到|翻了?|资金体量)[^\r\n，。；]{0,35}/giu,
    /[^\r\n，。；]{0,20}\d+(?:\.\d+)?%\+?[^\r\n，。；]{0,20}/giu,
  ];
  for (const pattern of patterns) {
    for (const match of matches(text, pattern)) {
      const claim = match[0].trim();
      if (claim && !claims.includes(claim)) claims.push(claim);
    }
  }
  return claims.slice(0, 8);
}

function requestedOutcomes(text) {
  const outcomes = [
    [/资料核验|核验资料/u, "资料核验"],
    [/需求澄清|澄清需求/u, "需求澄清"],
    [/风险边界|合规边界/u, "风险边界"],
    [/最小可行方案|最小可行产品|\bMVP\b/iu, "最小可行方案"],
  ];
  return outcomes.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function prohibitedActions(text) {
  const actions = [
    [/不授权自动交易|禁止自动交易/u, "自动交易"],
    [/不授权资金操作|禁止资金操作/u, "资金操作"],
    [/不授权(?:直接执行)?实盘|禁止(?:直接)?实盘/u, "直接实盘"],
  ];
  return actions.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function buildProjectProposal(text, topic, priority) {
  const explicitlyFormal = /正式项目|纳入项目体系/u.test(text);
  const explicitlySecondary = /不是.{0,12}(?:主航道|主板块|主线)|非主航道|非主板块/u.test(text);
  if (!explicitlyFormal && topic.key === "unclassified") return null;
  return {
    project_key: topic.key === "ai_quant" ? "ai_quant_system" : `${topic.key}_project`,
    display_name: topic.label,
    status_after_confirmation: "active",
    lane: explicitlySecondary ? "secondary_project" : "incubation",
    baseline_priority: explicitlySecondary ? 2 : priority === "next" ? 3 : 2,
    execution_policy: "eligible_after_approval",
    positioning: explicitlySecondary ? "正式小项目，非当前主航道" : "待确认的正式项目候选",
    explicitly_requested: explicitlyFormal,
  };
}

export function analyzeMaterialBundle(text, { observed_at = null, submitted_materials = [] } = {}) {
  const source = String(text ?? "").trim();
  const submitted = normalizeSubmittedMaterials(submitted_materials);
  const analysisSource = [source, ...submitted.map((item) => item.text_content).filter(Boolean)].join("\n").trim();
  if (!analysisSource && !submitted.length) throw new Error("material text is required");
  const extracted = extractMaterialItems(analysisSource);
  const materials = [...extracted, ...submittedMaterialItems(submitted, extracted.length)];
  if (!materials.length) throw new Error("no material found");
  const topic = inferTopic(analysisSource);
  const sourceCounts = Object.fromEntries(materials.reduce((map, item) => map.set(item.source, (map.get(item.source) ?? 0) + 1), new Map()));
  const unverifiedClaims = extractUnverifiedClaims(analysisSource);
  const hasClientSignal = /客户|交付|甲方|合作方/iu.test(analysisSource);
  const hasDeadline = /今天|明天|本周|这周|\d{1,2}[月/-]\d{1,2}[日号]?|截止|deadline/iu.test(analysisSource);
  const priority = hasClientSignal || hasDeadline ? "next" : "incubate";
  const outcomes = requestedOutcomes(analysisSource);
  const boundaries = prohibitedActions(analysisSource);
  const projectProposal = buildProjectProposal(analysisSource, topic, priority);
  const facts = [
    { claim: `收到 ${materials.length} 项素材`, evidence: materials.map((item) => item.material_id) },
    { claim: `素材来源包括：${Object.entries(sourceCounts).map(([name, count]) => `${name} ${count} 项`).join("、")}`, evidence: ["submitted_materials"] },
    { claim: `输入中反复出现“${topic.label}”相关词`, evidence: [`keyword_hits:${topic.count}`] },
  ];
  if (unverifiedClaims.length) facts.push({ claim: `检测到 ${unverifiedClaims.length} 条需要核实的效果或收益表述`, evidence: unverifiedClaims });
  if (projectProposal?.explicitly_requested) facts.push({ claim: `用户明确要求将“${topic.label}”纳入正式项目体系`, evidence: ["creator_submitted_text"] });
  if (outcomes.length) facts.push({ claim: `用户明确要求先完成：${outcomes.join("、")}`, evidence: ["creator_submitted_text"] });
  if (boundaries.length) facts.push({ claim: `用户明确禁止：${boundaries.join("、")}`, evidence: ["creator_submitted_text"] });

  const recommendation = projectProposal?.explicitly_requested
    ? `确认“${topic.label}”为${projectProposal.positioning}，并准备首轮只读调研计划；不授权任何交易、资金或实盘动作。`
    : "批准首轮只读调研；暂不批准开发、交易、对外承诺或业务投入。";

  return {
    kind: "material_bundle",
    title: topic.label,
    summary: `已把零散输入收成“${topic.label}”项目线索包；当前只完成结构化初判，尚未把外部表述当成事实。`,
    observed_at,
    materials,
    project_proposal: projectProposal,
    requested_outcomes: outcomes,
    prohibited_actions: boundaries,
    facts,
    inferences: [
      { claim: `这些素材可能共同指向一个“${topic.label}”小项目`, confidence: topic.count >= 3 ? "medium" : "low", basis: [`topic_hits:${topic.count}`, `material_count:${materials.length}`] },
      { claim: "第一步应是资料可信度核验和方案筛选，而不是直接开发或投入真实业务", confidence: "high", basis: ["external_materials_unverified", "scope_not_confirmed"] },
    ],
    unverified_claims: unverifiedClaims.map((claim) => ({ claim, status: "unverified", source: "creator_submitted_text" })),
    uncertainties: [
      { question: "外部链接中的内容、数据口径和可复现性是否真实？", blocking_for_execution: true, resolution: "逐条访问并建立来源与证据矩阵" },
      { question: "这个线索最终要解决奈奈自己的需求，还是客户交付需求？", blocking_for_execution: false, resolution: "首轮调研后在立项卡中对齐目标对象" },
      ...(!hasDeadline ? [{ question: "目前没有明确截止时间或时间窗口。", blocking_for_execution: false, resolution: "立项时再与当前项目组合排期" }] : []),
    ],
    research_plan: [
      "逐条读取素材并记录可访问性、作者、主题与核心主张",
      "把事实、案例宣传、个人观点和不可验证表述分开",
      "交叉核验关键收益、方法和工具，标记幸存者偏差与合规风险",
      "形成可复用方案矩阵：可学什么、不该学什么、如何适配、最小验证是什么",
      "由独立复核 Agent 检查证据链后，再提交是否立项的判断",
    ],
    judgment: {
      recommendation,
      priority,
      rationale: hasClientSignal ? "输入包含客户信号，应尽快判断是否形成交付项目。" : "目前是有聚类价值的线索，但尚无足够证据挤占主线。",
    },
    schedule: {
      recommended_window: priority === "next" ? "下一个可用工作时段" : "项目孵化区的下一次整理时段",
      first_pass_effort_minutes: materials.length <= 3 ? 30 : materials.length <= 10 ? 60 : 90,
      sequencing: "先核验材料，再决定是否进入正式项目；不与当前主线同时开工。",
      depends_on: ["链接可访问", "首轮证据矩阵完成", "奈奈确认是否立项"],
    },
    alignment: {
      decision: projectProposal?.explicitly_requested ? "是否确认这个项目定位与首轮只读计划？" : "是否授权首轮只读调研？",
      options: ["approve", "revise", "reject"],
      note: projectProposal?.explicitly_requested
        ? "确认后会登记正式小项目并建立首轮只读计划；不会启动 Agent，也不代表批准交易、资金操作或实盘。"
        : "确认只授权资料整理、核验和立项判断，不代表批准后续开发或真实业务动作。",
    },
  };
}
