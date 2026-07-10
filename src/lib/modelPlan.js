// modelPlan — 단일 진실 공급원(Single Source of Truth).
// report+env → {items, alternatives, exclusions, unknowns}. Solution·인벤토리·처방전 MD·LLM 브리핑 전부 이것만 참조(드리프트 제거).
// 근거 4단계: confirmed(files DB 실측) > workflow_author(Note 안내) > inferred(패턴 추정) > unknown(확인 필요).
// 불변: confirmed는 files DB에 실존하는 파일만. 그 외는 절대 confirmed 아님(추론형 추천 금지).
import catalog from "../data/model_catalog.json" with { type: "json" };
import { recommend, gpuProfile } from "./modelRecommender.js";

const baseName = (v) => (v || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
// files DB 조회(전 패밀리). filename 정확 일치만 → confirmed 자격.
function fileDbLookup(filename) {
  const b = baseName(filename);
  for (const [fam, def] of Object.entries(catalog.families)) for (const f of (def.files || [])) if (f.filename.toLowerCase() === b) return { ...f, family: fam };
  return null;
}
function hfUrl(repo, repoPath) { return repo && repoPath ? `https://huggingface.co/${repo}/blob/main/${repoPath}` : null; }
function joinPath(base, ...parts) {
  const sep = base.includes("\\") ? "\\" : "/";
  const clean = base.replace(/[\\/]+$/, "");
  const tail = parts.filter(Boolean).map((p) => p.replace(/[\\/]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, "g"), ""));
  return [clean, ...tail].join(sep);
}
function quantStance(quant, profile) {
  if (!profile || !quant) return null;
  const r = profile.rules;
  if (r.avoid.includes(quant)) return "avoid";
  if (r.caution.includes(quant)) return "caution";
  if (r.prefer.includes(quant)) return "prefer";
  return "neutral";
}

// 근거 등급 → 사용자 표시 뱃지(4단계).
export const BADGE = { confirmed: "확정", workflow_author: "워크플로우 안내", inferred: "추정 후보", unknown: "확인 필요" };

// "26.3GB"/"484MB" → GB 숫자. 모르면 null.
function sizeToGB(s) {
  if (!s) return null;
  const m = String(s).match(/([\d.]+)\s*(GB|MB)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return /mb/i.test(m[2]) ? v / 1000 : v;
}

export function buildModelPlan(report, env) {
  const rec = recommend(report, env); // 패밀리/슬롯/폴더 override/note/exclude 재사용
  const models = report?.models || [];
  const basePath = env?.modelRoot || env?.basePath || null;
  const profile = gpuProfile(env?.gpu, env?.vram);
  const recByBase = new Map(rec.slots.map((s) => [baseName(s.workflowValue), s]));
  const noteByBase = rec.noteLinkByBase instanceof Map ? rec.noteLinkByBase : new Map();
  const items = [], unknowns = [];
  const seen = new Set();
  for (const m of models) {
    const b = baseName(m.file);
    if (seen.has(b)) continue; seen.add(b);
    const db = fileDbLookup(m.file);
    const recSlot = recByBase.get(b);
    const noteLink = noteByBase.get(b);
    const role = db?.role || recSlot?.slotType || null;
    const norm = m.file.replace(/\\/g, "/");
    const sub = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : ""; // 워크플로우 값의 서브폴더(케이스 보존)
    // 파인딩 r: 폴더 = 카탈로그 우선, 없으면 노트 지정 폴더(하위 경로 포함, 예 diffusion_models/boogu). 노트 폴더는 전체 경로라 워크플로우 sub 중복 append 안 함.
    const catFolderBase = db?.folder || (recSlot ? recSlot.folder.replace(/^models\//, "").split("/")[0] : null); // 카탈로그 폴더(diffusion_models 등)
    const noteFolderBase = noteLink?.folder ? noteLink.folder.replace(/^models[\/\\]/i, "").replace(/\\/g, "/").replace(/\/+$/, "") : null;
    const folderBase = catFolderBase || noteFolderBase;
    const usesNoteFolder = !catFolderBase && !!noteFolderBase;
    const folder = folderBase ? `models/${folderBase}` + (!usesNoteFolder && sub ? `/${sub}` : "") : (m.folder || null);
    const fullPath = basePath && folderBase ? (usesNoteFolder ? joinPath(basePath, folderBase) : joinPath(basePath, folderBase, sub)) : null;
    let confidence, sourceRepo = null, sourcePath = null, size = null, downloadUrl = null, reason = "", renameHint = null;
    if (db) {
      confidence = "confirmed"; sourceRepo = db.repo; sourcePath = db.repo_path; size = db.size;
      // 결함7: repo_filename(repo 실파일명) 확인 시에만 파일 직링크. 미확인은 repo 트리 링크(파일 직링크 날조 금지).
      const repoFn = db.repo_filename || (db.repo_path && !db.repo_path.endsWith("/") ? db.repo_path.split("/").pop() : null);
      downloadUrl = repoFn ? hfUrl(db.repo, db.repo_path) : (db.repo ? `https://huggingface.co/${db.repo}/tree/main` : null);
      // repo 실파일명과 워크플로우 참조명이 다르면 리네임 안내(받은 파일을 참조명으로).
      const wfBase = m.file.replace(/\\/g, "/").split("/").pop();
      if (repoFn && repoFn.toLowerCase() !== b) renameHint = `받은 파일 이름을 ${wfBase}으로 바꾸거나, 노드에서 받은 파일을 선택해 주세요.`;
      reason = `검증된 카탈로그(${db.repo})에 이 파일이 실존${size ? ` (${size})` : ""}${repoFn && repoFn.toLowerCase() !== b ? ` · repo 실파일명 ${repoFn}` : ""}.`;
    } else if (noteLink) {
      confidence = "workflow_author"; downloadUrl = noteLink.url;
      if (noteLink.size) size = noteLink.size; // 파인딩 r: 노트 명시 용량
      reason = `워크플로우 제작자가 이 파일의 출처를 안내했습니다${noteLink.sectionHeader ? ` (${noteLink.sectionHeader})` : ""}${size ? ` · 안내 용량 ${size}` : ""}. 공식 카탈로그 확인은 아닙니다.`;
    } else if (recSlot) {
      confidence = "inferred";
      reason = `파일명·노드 패턴으로 ${rec.label} 구성요소로 보이는 추정 후보입니다. 공식 카탈로그 확인이 필요합니다.`;
    } else {
      confidence = "unknown";
      reason = `출처를 확인하지 못했습니다.`;
    }
    // VRAM 경고: 선택 모델 용량이 VRAM의 1.5배 초과면 대용량 경고(대체 후보 권장). 실측 정합: 3090 24GB에서 26.3GB는 36 미만이라 무경고(실제 실행됨), 8GB에서는 경고.
    const gb = sizeToGB(size);
    const vramWarning = (gb && profile?.vram && gb > profile.vram * 1.5)
      ? `이 모델은 ${size}로 ${profile.vram}GB VRAM에서 매우 느리거나 실행되지 않을 수 있습니다. 대체 후보를 권합니다.`
      : null;
    const item = { role, workflowValue: m.file, selectedFile: b, node: m.node, folder, fullPath, size, sourceRepo, sourcePath, downloadUrl, confidence, badge: BADGE[confidence], vramWarning, renameHint, nodeSelection: m.file, reason };
    (confidence === "unknown" ? unknowns : items).push(item);
  }
  // 대체 후보 / 제외(주 모델). files DB + note 제외 지시 기준. "추천" 아니라 "OOM 시 대체 후보".
  const mainSlot = rec.slots.find((s) => s.slotType === "main_model");
  const selectedMain = items.find((it) => it.role === "main_model");
  const alternatives = [], exclusions = [];
  const famFiles = (rec.family && catalog.families[rec.family]?.files) || [];
  const excludeTurbo = !!mainSlot?.exclude?.includes("turbo");
  for (const f of famFiles) {
    if (f.role !== "main_model") continue;
    if (selectedMain && f.filename.toLowerCase() === selectedMain.selectedFile) continue;
    const isTurbo = f.variant === "turbo";
    if (excludeTurbo && isTurbo) { exclusions.push({ filename: f.filename, quant: f.quant, size: f.size, reason: "Note가 turbo 메인 모델을 쓰지 말라고 지시했습니다." }); continue; } // Note 기반 제외는 GPU 무관
    // 대체 후보(OOM 시)는 GPU 의존 판정 → profile 없으면 미출력(불변①: 입력 없인 확정 판정 금지)
    if (profile && !isTurbo && quantStance(f.quant, profile) !== "avoid") alternatives.push({ filename: f.filename, quant: f.quant, size: f.size, folder: `models/${f.folder}`, downloadUrl: hfUrl(f.repo, f.repo_path), reason: `OOM(메모리 부족) 발생 시 대체 후보입니다 (${f.quant}${f.size ? `, ${f.size}` : ""}).` });
  }
  // 결함2: 저VRAM 경고가 뜬 주 모델은 대체 후보로 승격(같은 kind 안에서만 — Note RAW 강제 준수). 받기 행 본체를 대체로 교체, 원 참조값은 하위 표기.
  if (selectedMain?.vramWarning && alternatives.length && profile?.vram) {
    const alt = alternatives[0]; // raw 계열 중 가장 작은 호환 후보(turbo 제외 유지)
    selectedMain.promoted = { filename: alt.filename, size: alt.size, quant: alt.quant, downloadUrl: alt.downloadUrl, folder: selectedMain.folder, fullPath: selectedMain.fullPath, node: selectedMain.node, reason: `이 PC(${profile.vram}GB VRAM) 기준 권장`, originalFile: selectedMain.selectedFile, originalSize: selectedMain.size };
  }
  return { family: rec.family, label: rec.label, needs: rec.needs, items, alternatives, exclusions, unknowns, authorLinks: rec.authorLinks || [] };
}
