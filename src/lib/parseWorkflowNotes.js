// 워크플로우 Note(제작자 메모) 의미 해석 — 대상 명사(target)까지 파싱.
// 핵심 함정(krea2): "use the raw model, not the turbo" + "turbo lora at strength 0.8"
//   → RAW는 model에만, turbo는 model에서만 제외, turbo LORA는 유지. 키워드만으로 turbo 전체 제외 금지.
// 반환 flag: { directive: prefer|exclude|keep|folder, value, target, raw }
//   target 기본값 = "model"(변형 지시어에 명시 대상이 없으면 주 모델로 한정 → lora 오제외 방지).

const VARIANTS = ["raw", "turbo", "distill", "distilled", "lightning", "schnell", "base"];
const TARGETS = [
  ["lora", ["lora", "loras"]],
  ["vae", ["vae"]],
  ["text_encoder", ["text encoder", "text_encoder", "text-encoder", "clip"]],
  ["model", ["model", "unet", "diffusion", "checkpoint", "ckpt", "dit"]],
];
const RE_EXCLUDE = /\b(not|no|avoid|don'?t|do\s+not|never|exclude|skip|instead\s+of)\b/;
const RE_KEEP = /\b(keep|retain|stay|still\s+use|leave|remain)\b/;
const RE_PREFER = /\b(use|prefer|pick|choose|select|want|should\s+use|go\s+with|load)\b/;

function normVariant(v) { return v === "distilled" ? "distill" : v; }

// 대상 명사 탐지. lora가 언급되면 lora 우선(모델 키워드보다). 없으면 null.
function findTarget(low) {
  for (const [name, kws] of TARGETS) if (kws.some((k) => low.includes(k))) return name;
  return null;
}

export function parseWorkflowNotes(notes) {
  const flags = [];
  const text = Array.isArray(notes) ? notes.join("\n") : String(notes || "");
  if (!text.trim()) return flags;
  // 절 단위 분리(줄바꿈·마침표·세미콜론·쉼표). 각 절에서 변형·대상·지시어를 독립 판정.
  const clauses = text.split(/[\n.;,!?]+/).map((s) => s.trim()).filter(Boolean);
  for (const c of clauses) {
    const low = c.toLowerCase();
    // (1) 폴더 지정: "goes in models/X" / "put in models/X" / "in the X folder". 원문(c)에서 추출 → 케이스 보존.
    const fm = c.match(/(?:goes?\s+in(?:to)?|put\s+(?:it\s+|them\s+)?(?:in|into)|place[sd]?\s+in(?:to)?|belongs?\s+in|save\s+(?:it\s+)?(?:in|to)|drop\s+(?:it\s+)?in)\s+(?:the\s+)?([A-Za-z0-9_./\\ -]+)/i);
    if (fm) {
      let folder = fm[1].replace(/\s+folder.*$/i, "").replace(/[\s]+$/, "").trim();
      if (folder) flags.push({ directive: "folder", value: folder, target: null, raw: c });
    }
    // (2) 변형 지시어: 변형 키워드가 있어야 함
    const vRaw = VARIANTS.find((v) => new RegExp(`\\b${v}\\b`).test(low));
    if (!vRaw) continue;
    const value = normVariant(vRaw);
    const explicitTarget = findTarget(low);
    const target = explicitTarget || "model"; // 미명시 → 주 모델로 한정(함정 방지)
    const excl = RE_EXCLUDE.test(low);
    const keep = RE_KEEP.test(low);
    const prefer = RE_PREFER.test(low);
    let directive = null;
    if (excl) directive = "exclude";
    else if (keep) directive = "keep";
    else if (prefer) directive = "prefer";
    // (3) lora + 변형인데 지시어 동사가 없고 제외도 아니면 → keep(예: "turbo lora at strength 0.8"은 사용 의도)
    if (!directive && explicitTarget === "lora" && !excl) directive = "keep";
    if (directive) flags.push({ directive, value, target, raw: c });
  }
  return flags;
}

// 특정 슬롯 타입(target)에서 특정 변형이 제외되는지. exclude 플래그가 그 target에 있으면 true.
// keep/prefer 플래그가 있으면 명시적으로 유지(제외 상쇄). 함정 해결의 핵심 헬퍼.
export function isVariantExcluded(flags, variant, target) {
  const rel = flags.filter((f) => f.value === variant && (f.target === target || f.target === null));
  if (rel.some((f) => f.directive === "keep" || f.directive === "prefer")) return false;
  return rel.some((f) => f.directive === "exclude");
}

// 특정 target에서 선호되는 변형(prefer 플래그). 없으면 null.
export function preferredVariant(flags, target) {
  const f = flags.find((x) => x.directive === "prefer" && (x.target === target || x.target === null));
  return f ? f.value : null;
}

// Note에서 지정한 폴더(첫 folder 플래그). 없으면 null.
export function notedFolder(flags) {
  const f = flags.find((x) => x.directive === "folder");
  return f ? f.value : null;
}

// 노드명·라벨 정규화: 소문자·공백/하이픈/언더스코어/괄호 제거.
function normNodeName(s) { return String(s || "").toLowerCase().replace(/[\s_\-()]/g, ""); }
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) { const tmp = dp[i]; dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return dp[m];
}
// Note 링크 라벨 ↔ 미확인 노드명 매칭(오탈자 허용). 완전 정규화 일치 또는 편집거리 ≤ 2.
// 길이차 3 초과는 배제 → "comfyui-smart-resolution-calc" 같은 부분 포함 트랩 방지(실측: SmartResolution에 오매칭 금지).
export function matchLabelToNode(label, nodeName) {
  const a = normNodeName(label), b = normNodeName(nodeName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 3) return false;
  return editDistance(a, b) <= 2;
}

// URL 끝에서 모델 파일명 추출(safetensors 등). tree/blob 경로면 null(파일 직링크 아님).
function fileFromUrl(url) {
  const last = url.split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop();
  return /\.(safetensors|gguf|ckpt|pt|pth|bin)$/i.test(last) ? last : null;
}
// Note를 섹션(## 헤더 또는 **볼드** 헤더)으로 분할 → {header, links[{label,url,file}], folder, strength, body}.
// 제작자가 모델별 직링크·폴더·강도를 섹션으로 적는 관례를 구조화(액션 테이블 승격용).
export function parseNoteSections(notes) {
  const text = Array.isArray(notes) ? notes.join("\n\n") : String(notes || "");
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const sections = [];
  let cur = { header: "", body: [] };
  const flush = () => { if (cur.header || cur.body.some((l) => l.trim())) sections.push(finalizeSection(cur)); };
  for (const ln of lines) {
    const h = ln.match(/^\s*#{1,4}\s+(.+?)\s*$/) || ln.match(/^\s*\*\*(.+?)\*\*\s*$/);
    if (h) { flush(); cur = { header: h[1].trim(), body: [] }; }
    else cur.body.push(ln);
  }
  flush();
  return sections;
}
function finalizeSection(sec) {
  const body = sec.body.join("\n");
  const links = [];
  for (const m of body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) links.push({ label: m[1].trim(), url: m[2].trim(), file: fileFromUrl(m[2]) });
  // 마크다운 아닌 평문 URL도(중복 제외)
  for (const m of body.matchAll(/(?<!\()\bhttps?:\/\/[^\s)\]"'`]+/g)) { const url = m[0]; if (!links.some((l) => l.url === url)) links.push({ label: sec.header || url, url, file: fileFromUrl(url) }); }
  const fm = body.match(/goes?\s+in(?:to)?\s+(?:the\s+)?([A-Za-z0-9_/\\.-]+)/i);
  const folder = fm ? fm[1].replace(/[.\s]+$/, "").trim() : null;
  const sm = body.match(/([0-9]+(?:\.[0-9]+)?)\s*strength/i) || body.match(/strength\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const strength = sm ? sm[1] : null;
  return { header: sec.header, links, folder, strength, body };
}
