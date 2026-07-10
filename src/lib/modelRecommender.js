// 환경 기반 모델 추천 엔진.
// 입력: analyze(report) + env(gpu, basePath|null) + catalog + gpu_rules + Note flags.
// 우선순위: Note 플래그 > 워크플로우 참조값 > gpu_rules. 워크플로우 참조 variant가 환경 호환이면 quality 1순위.
// 불변: 입력받지 않은 정보(GPU 미입력)는 확정 판정 금지 → needs에 'gpu'. basePath 없으면 상대경로만.
//       카탈로그 밖 패밀리 날조 금지 → 미감지 시 family null(호출부는 기존 폴백 유지).
import catalog from "../data/model_catalog.json" with { type: "json" };
import gpuRules from "../data/gpu_rules.json" with { type: "json" };
import { parseWorkflowNotes, isVariantExcluded, preferredVariant, notedFolder, parseNoteSections, parseNoteModelEntries } from "./parseWorkflowNotes.js";

const baseName = (v) => (v || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
function fileSim(a, b) {
  const tok = (s) => s.toLowerCase().replace(/\.[^.]+$/, "").split(/[_\-.\s]+/).filter(Boolean);
  const A = new Set(tok(a)), B = new Set(tok(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
const HEADER_SLOT = [[/main\s*model|checkpoint|unet|diffusion/i, "main_model"], [/text\s*encoder|\bclip\b|qwen/i, "text_encoder"], [/\bvae\b/i, "vae"], [/lora/i, "lora"]];
function mkLink(l, sec) { return { url: l.url, label: l.label, file: l.file, folder: sec.folder, strength: sec.strength, sectionHeader: sec.header }; }

// Note 섹션 링크 → 워크플로우 모델 슬롯 매칭. 반환: {linkByBase, authorLinks}. 카탈로그 무관(모든 워크플로우).
export function promoteNoteLinks(report) {
  const sections = parseNoteSections(report?.authorNotes || []);
  const models = report?.models || [];
  const linkByBase = new Map();
  const usedLink = new Set();
  // 1. 정확 파일명 매칭(최강) — 링크 URL의 파일명이 워크플로우 모델 basename과 일치
  models.forEach((m) => {
    const mb = baseName(m.file);
    sections.forEach((sec, si) => sec.links.forEach((l, li) => {
      if (l.file && l.file.toLowerCase() === mb && !linkByBase.has(mb)) { linkByBase.set(mb, mkLink(l, sec)); usedLink.add(`${si}:${li}`); }
    }));
  });
  // 2. 섹션 헤더 키워드 → 슬롯 타입 매칭(파일명 미매칭 슬롯만)
  models.forEach((m) => {
    const mb = baseName(m.file);
    if (linkByBase.has(mb)) return;
    const st = slotTypeFor(m.node);
    if (!st) return;
    for (let si = 0; si < sections.length; si++) {
      const secSlot = (HEADER_SLOT.find(([re]) => re.test(sections[si].header)) || [])[1];
      if (secSlot !== st || !sections[si].links.length) continue;
      let bestLi = -1, bestScore = -1;
      // dir 링크(파일명 없음)는 헤더 신뢰(0.4). 단 lora는 여러 개라 헤더만으로 오매칭 위험 → 파일명 유사도만(dir 0).
      sections[si].links.forEach((l, li) => { const s = l.file ? fileSim(l.file, mb) : (st === "lora" ? 0 : 0.4); if (s > bestScore) { bestScore = s; bestLi = li; } });
      if (bestLi < 0 || bestScore < 0.3) continue; // 최소 유사도 미달 → 오매칭 방지(컨트롤 lora↔turbo/anti-censorship 등)
      linkByBase.set(mb, mkLink(sections[si].links[bestLi], sections[si])); usedLink.add(`${si}:${bestLi}`); break;
    }
  });
  // 2.5 파인딩 r: 리치 노트 per-line 항목(파일별 url·folder·size)로 보강. 미매칭 파일은 추가(직링크 있으면).
  const entries = parseNoteModelEntries(report?.authorNotes || []);
  models.forEach((m) => {
    const mb = baseName(m.file);
    const e = entries.get(mb);
    if (!e) return;
    if (linkByBase.has(mb)) {
      const cur = linkByBase.get(mb);
      linkByBase.set(mb, { ...cur, url: cur.url || e.url, folder: cur.folder || e.folder, size: cur.size || e.size });
    } else if (e.url) {
      linkByBase.set(mb, { url: e.url, label: e.file, file: e.file, folder: e.folder, size: e.size, strength: null, sectionHeader: null });
    }
  });
  // 3. 미매칭 섹션 링크 → 제작자 안내 링크(모델 다운로드성: 파일 직링크 or huggingface/civitai/github)
  const authorLinks = [];
  sections.forEach((sec, si) => sec.links.forEach((l, li) => {
    if (usedLink.has(`${si}:${li}`)) return;
    if (!(l.file || /huggingface\.co|civitai|github\.com/i.test(l.url))) return;
    authorLinks.push({ label: sec.header || l.label, linkLabel: l.label, url: l.url, strength: sec.strength, folder: sec.folder });
  }));
  return { linkByBase, authorLinks };
}

const VARIANT_KEYS = ["raw", "turbo", "distill", "lightning", "schnell", "base"];
// 품질 순위(높을수록 고품질)·속도 순위(높을수록 빠름) — quant 기준.
const QUALITY_RANK = { bf16: 6, fp16: 5, int8: 4, fp8_scaled: 3, fp8_e4m3fn: 3, gguf: 2, nvfp4: 1, fp4_mixed: 1 };
const SPEED_RANK = { nvfp4: 6, fp4_mixed: 6, fp8_e4m3fn: 5, fp8_scaled: 5, gguf: 4, int8: 3, bf16: 2, fp16: 2 };

function slotTargetOf(slotType) {
  return slotType === "main_model" ? "model" : slotType; // note target 명사와 정합(main_model→model)
}
function slotTypeFor(nodeType) {
  if (!nodeType) return null;
  const exact = catalog._meta.slotByNode[nodeType];
  if (exact) return exact;
  for (const [pat, slot] of (catalog._meta.slotByNodePattern || [])) if (new RegExp(pat, "i").test(nodeType)) return slot;
  return null;
}
function detectFamily(models) {
  const score = {};
  for (const [fam, def] of Object.entries(catalog.families)) {
    for (const m of models) {
      const low = (m.file || "").toLowerCase();
      const nt = m.node || "";
      if ((def.detect.filename || []).some((k) => low.includes(k)) || (def.detect.nodeType || []).some((k) => nt.includes(k))) score[fam] = (score[fam] || 0) + 1;
    }
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
function matchVariant(def, file) {
  const low = file.toLowerCase();
  for (const v of (def.variants || [])) if (low.includes(v.match)) return { ...v };
  return null;
}
// env.gpu(+로그 실측 vram) → {arch, vram, rules, vramSource}. 로그 vram이 테이블보다 우선.
// 부분 매칭은 최장 일치(RTX 3060 Ti는 RTX 3060보다 우선). 미입력·미상 → null.
export function gpuProfile(gpu, vramOverride) {
  const logVram = (typeof vramOverride === "number" && vramOverride > 0) ? vramOverride : null;
  if (!gpu) return logVram ? { arch: null, vram: logVram, rules: { prefer: [], caution: [], avoid: [] }, vramSource: "log" } : null;
  let entry = gpuRules.gpus[gpu];
  if (!entry) {
    const g = gpu.toLowerCase().replace(/[^0-9a-z]/g, "");
    let bestLen = -1;
    for (const [name, e] of Object.entries(gpuRules.gpus)) {
      const n = name.toLowerCase().replace(/[^0-9a-z]/g, "");
      if (g.includes(n) && n.length > bestLen) { bestLen = n.length; entry = e; } // 최장 일치(변형 접미 구분)
    }
  }
  if (!entry) return logVram ? { arch: null, vram: logVram, rules: { prefer: [], caution: [], avoid: [] }, vramSource: "log" } : null;
  return { arch: entry.arch, vram: logVram || entry.vram, rules: gpuRules.byArch[entry.arch], vramSource: logVram ? "log" : "table" };
}
function quantStance(quant, profile) {
  if (!profile || !quant) return null;
  const r = profile.rules;
  if (r.avoid.includes(quant)) return "avoid";
  if (r.caution.includes(quant)) return "caution";
  if (r.prefer.includes(quant)) return "prefer";
  return "neutral";
}
function joinPath(base, ...parts) {
  const sep = base.includes("\\") ? "\\" : "/";
  const clean = base.replace(/[\\/]+$/, "");
  const tail = parts.filter(Boolean).map((p) => p.replace(/[\\/]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, "g"), ""));
  return [clean, ...tail].join(sep);
}

// 메인. report.models·authorNotes + env → 추천. family 없으면 slots [](호출부 폴백).
export function recommend(report, env) {
  const models = report?.models || [];
  const flags = parseWorkflowNotes(report?.authorNotes || []);
  const { linkByBase, authorLinks } = promoteNoteLinks(report); // Note 링크 승격(카탈로그 무관)
  const profile = gpuProfile(env?.gpu, env?.vram);
  const family = detectFamily(models);
  const needs = [];
  if (!profile) needs.push("gpu"); // 불변①: GPU 미입력 → 확정 판정 금지, 안내만
  if (!family) return { family: null, label: null, confidence: "none", slots: [], needs, flags, profile, noteLinkByBase: linkByBase, authorLinks };
  const def = catalog.families[family];
  const basePath = env?.modelRoot || env?.basePath || null; // 불변②: 수동 우선, 없으면 상대경로만

  // 이 패밀리의 후보 변형(품질/속도 소구분용) — 환경 호환(avoid 제외) + note 제외 반영.
  const usableVariants = (def.variants || []).filter((v) => {
    if (isVariantExcluded(flags, v.kind === "turbo" ? "turbo" : "raw", "model")) return false;
    const st = quantStance(v.quant, profile);
    return st !== "avoid";
  });
  const bestQuality = [...usableVariants].sort((a, b) => (QUALITY_RANK[b.quant] || 0) - (QUALITY_RANK[a.quant] || 0))[0] || null;
  const bestSpeed = [...usableVariants].sort((a, b) => (SPEED_RANK[b.quant] || 0) - (SPEED_RANK[a.quant] || 0))[0] || null;

  const slots = [];
  for (const m of models) {
    const slotType = slotTypeFor(m.node);
    if (!slotType) continue;
    const folderKey = def.folders[slotType];
    if (!folderKey) continue; // 이 패밀리가 관리하지 않는 슬롯 → 기존 폴백(호출부)
    const value = m.file;
    const norm = value.replace(/\\/g, "/");
    const sub = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : ""; // 워크플로우 값의 서브폴더(케이스 보존)
    const folder = `models/${folderKey}` + (sub ? `/${sub}` : "");
    const absoluteFolder = basePath ? joinPath(basePath, folderKey, sub) : null;
    const variant = matchVariant(def, value);
    const target = slotTargetOf(slotType);
    // note 제외 변형(이 슬롯 대상)
    const exclude = VARIANT_KEYS.filter((v) => isVariantExcluded(flags, v, target));
    const stance = variant ? quantStance(variant.quant, profile) : null;
    // 뱃지: variant 매칭(카탈로그가 아는 변형=출처 포함) → 확정 / 패밀리 폴더만 알면 → 추정
    const badge = variant && def.source ? "확정" : "추정";
    // quality/speed: 주 모델 슬롯만. note 우선(prefer) → 워크플로우 참조 variant(호환 시) → gpu_rules.
    let quality = null, speed = null;
    if (slotType === "main_model") {
      const pref = preferredVariant(flags, "model"); // note가 지정한 변형(raw 등)
      const refCompatible = variant && quantStance(variant.quant, profile) !== "avoid" && !exclude.includes(variant.kind === "turbo" ? "turbo" : "raw");
      // quality 1순위: 워크플로우 참조 variant가 호환이면 그것(krea2_raw_bf16). 아니면 카탈로그 최고 품질.
      quality = refCompatible ? { variant: variant.match, quant: variant.quant, kind: variant.kind } : (bestQuality ? { variant: bestQuality.match, quant: bestQuality.quant, kind: bestQuality.kind } : null);
      // speed: turbo 등 더 빠른 변형(제외 안 됐고 호환). quality와 같으면 null.
      if (bestSpeed && (!quality || bestSpeed.match !== quality.variant) && (SPEED_RANK[bestSpeed.quant] || 0) > (SPEED_RANK[quality?.quant] || 0)) {
        speed = { variant: bestSpeed.match, quant: bestSpeed.quant, kind: bestSpeed.kind };
      }
      // note가 명시 선호한 변형이 있고 참조값이 그와 다르면 reason에 반영(아래)
      if (pref && variant && !value.toLowerCase().includes(pref)) { /* 참조값이 선호와 불일치 — reason에서 안내 */ }
    }
    const reasons = [];
    reasons.push(`${def.label} 패밀리로 판단(감지: ${(def.detect.filename || []).join("·") || def.detect.nodeType.join("·")}).`);
    reasons.push(`${m.node} 슬롯 → models/${folderKey}. 워크플로우 값의 하위 폴더(${sub || "없음"})는 그대로 유지.`);
    if (variant) reasons.push(`파일명 변형: ${variant.kind}·${variant.quant}${stance ? ` (${env?.gpu || "GPU"} 기준 ${stance})` : ""}.`);
    if (badge === "확정" && def.source) reasons.push(`출처(HuggingFace): ${def.source}.`);
    else reasons.push(`이 파일의 배포 출처는 카탈로그에 없어 배치 폴더만 확정. 다운로드는 검색으로 안내.`);
    if (exclude.length) reasons.push(`Note 지시: ${exclude.join("·")} 변형은 이 슬롯에서 제외.`);
    if (!profile) reasons.push(`GPU 미입력 → 양자화 적합성은 판정하지 않음.`);
    // Note 링크 승격: 이 슬롯 파일에 제작자 직링크가 있으면 첨부(다운로드 버튼·강도·폴더 근거).
    const noteLink = linkByBase.get(baseName(value)) || null;
    if (noteLink) {
      reasons.push(`워크플로우 제작자 안내 링크: ${noteLink.label}${noteLink.sectionHeader ? ` (${noteLink.sectionHeader})` : ""}.`);
      if (noteLink.folder && folder !== `models/${folderKey}`) { /* 카탈로그 폴더 우선 */ }
      if (noteLink.folder) reasons.push(`Note 폴더 지시: ${noteLink.folder}${`models/${folderKey}` !== noteLink.folder.replace(/^\/?/, "") ? ` (카탈로그 우선: models/${folderKey})` : ""}.`);
    }
    slots.push({ slotType, node: m.node, workflowValue: value, variant: variant?.match || null, quant: variant?.quant || null, kind: variant?.kind || null, stance, quality, speed, exclude, folder, absoluteFolder, source: def.source, badge, noteLink, reasons });
  }
  const confidence = def.source ? "confirmed" : "detected";
  return { family, label: def.label, confidence, slots, needs, flags, profile, noteLinkByBase: linkByBase, authorLinks };
}
