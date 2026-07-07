// 환경 기반 모델 추천 엔진.
// 입력: analyze(report) + env(gpu, basePath|null) + catalog + gpu_rules + Note flags.
// 우선순위: Note 플래그 > 워크플로우 참조값 > gpu_rules. 워크플로우 참조 variant가 환경 호환이면 quality 1순위.
// 불변: 입력받지 않은 정보(GPU 미입력)는 확정 판정 금지 → needs에 'gpu'. basePath 없으면 상대경로만.
//       카탈로그 밖 패밀리 날조 금지 → 미감지 시 family null(호출부는 기존 폴백 유지).
import catalog from "../data/model_catalog.json" with { type: "json" };
import gpuRules from "../data/gpu_rules.json" with { type: "json" };
import { parseWorkflowNotes, isVariantExcluded, preferredVariant, notedFolder } from "./parseWorkflowNotes.js";

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
// env.gpu → {arch, vram, rules}. 부분 매칭 허용(RTX 3090 Ti → 3090). 미입력·미상 → null.
export function gpuProfile(gpu) {
  if (!gpu) return null;
  let entry = gpuRules.gpus[gpu];
  if (!entry) {
    const g = gpu.toLowerCase().replace(/[^0-9a-z]/g, "");
    for (const [name, e] of Object.entries(gpuRules.gpus)) {
      if (g.includes(name.toLowerCase().replace(/[^0-9a-z]/g, ""))) { entry = e; break; }
    }
  }
  if (!entry) return null;
  return { arch: entry.arch, vram: entry.vram, rules: gpuRules.byArch[entry.arch] };
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
  const profile = gpuProfile(env?.gpu);
  const family = detectFamily(models);
  const needs = [];
  if (!profile) needs.push("gpu"); // 불변①: GPU 미입력 → 확정 판정 금지, 안내만
  if (!family) return { family: null, label: null, confidence: "none", slots: [], needs, flags, profile };
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
    slots.push({ slotType, node: m.node, workflowValue: value, variant: variant?.match || null, quant: variant?.quant || null, kind: variant?.kind || null, stance, quality, speed, exclude, folder, absoluteFolder, source: def.source, badge, reasons });
  }
  const confidence = def.source ? "confirmed" : "detected";
  return { family, label: def.label, confidence, slots, needs, flags, profile };
}
