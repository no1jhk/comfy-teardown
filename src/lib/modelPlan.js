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

// 파인딩 m: 받기 bat의 폴더 대상 조립(Windows). base(모델 루트) 있으면 절대 "{base}\{종류폴더}", 없으면 상대 "models\{종류폴더}".
// 규칙: 입력경로 자체가 models 루트 → "models" 세그먼트 삽입 금지(표시 폴더의 models/ 접두 제거). 백슬래시 정규화.
export function downloadTargetFolder(base, displayFolder) {
  // 표시폴더에서 선행 "models"(단독 또는 접두) 제거 → 종류 세그먼트만. 백슬래시 정규화.
  const type = String(displayFolder || "").replace(/^models([/\\]|$)/i, "").replace(/\//g, "\\").replace(/^\\+|\\+$/g, "");
  const b = String(base || "").replace(/[/\\]+$/, "").replace(/\//g, "\\").trim();
  if (b) return type ? `${b}\\${type}` : b;
  return type ? `models\\${type}` : "models";
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
    // 파인딩 #3: 폴더 우선순위 = 확정 카탈로그(db) > 노트(제작자 지정) > 추론 슬롯(recSlot) > 로더 타입 폴백(m.folder).
    // (노트 폴더가 추론 슬롯·로더 폴백을 이기게 → UNETLoader가 note diffusion_models/boogu를 models/unet로 덮던 소실 수리.)
    const noteFolderBase = noteLink?.folder ? noteLink.folder.replace(/^models[\/\\]/i, "").replace(/\\/g, "/").replace(/\/+$/, "") : null; // 하위 경로 포함(예 diffusion_models/boogu)
    const recFolderBase = recSlot ? recSlot.folder.replace(/^models\//, "").split("/")[0] : null;
    const folderBase = db?.folder || noteFolderBase || recFolderBase;
    const usesNoteFolder = !db?.folder && !!noteFolderBase; // 노트 폴더 사용 시 전체 경로 → 워크플로우 sub 중복 append 안 함
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
    // 4: VRAM 초과(용량 > VRAM*1.5) 판정. 메시지는 확정형("실행이 어렵습니다"). 하위 양자화 목록/미확인은 alternatives 계산 후 확정.
    const gb = sizeToGB(size);
    const vramTooBig = !!(gb && profile?.vram && gb > profile.vram * 1.5); // 실측 정합: 3090 24GB에서 26.3GB<36 무경고, 8GB 경고.
    const vramWarning = vramTooBig ? `이 GPU(${profile.vram}GB)에서 ${b}(${size})은 실행이 어렵습니다.` : null;
    const item = { role, workflowValue: m.file, selectedFile: b, node: m.node, folder, fullPath, size, sourceRepo, sourcePath, downloadUrl, confidence, badge: BADGE[confidence], vramWarning, vramTooBig, renameHint, nodeSelection: m.file, reason };
    (confidence === "unknown" ? unknowns : items).push(item);
  }
  // 대체 후보 / 제외(주 모델). files DB + note 제외 지시 기준. "추천" 아니라 "OOM 시 대체 후보".
  const mainSlot = rec.slots.find((s) => s.slotType === "main_model");
  const selectedMain = items.find((it) => it.role === "main_model");
  const alternatives = [], exclusions = [];
  const famFiles = (rec.family && catalog.families[rec.family]?.files) || [];
  const excludeTurbo = !!mainSlot?.exclude?.includes("turbo");
  const mainGB = sizeToGB(selectedMain?.size);
  for (const f of famFiles) {
    if (f.role !== "main_model") continue;
    if (selectedMain && f.filename.toLowerCase() === selectedMain.selectedFile) continue;
    const isTurbo = f.variant === "turbo";
    if (excludeTurbo && isTurbo) { exclusions.push({ filename: f.filename, quant: f.quant, size: f.size, reason: "Note가 turbo 메인 모델을 쓰지 말라고 지시했습니다." }); continue; } // Note 기반 제외는 GPU 무관
    // 8: 대체 후보는 선택 메인 대비 방향으로 판정(GPU 의존 → profile 없으면 미출력, 불변①).
    // 더 작으면 OOM(메모리 부족) 대비, 더 크면 상위 품질(VRAM 여유 시·GPU에 맞을 때만). 동급 크기·크기 미상은 방향 불명 → 미노출(불명 판정 금지).
    if (!profile || isTurbo || quantStance(f.quant, profile) === "avoid") continue;
    const altGB = sizeToGB(f.size);
    let reason = null;
    if (mainGB != null && altGB != null) {
      if (altGB < mainGB) reason = `OOM(메모리 부족) 대비 더 작은 양자화입니다 (${f.quant}${f.size ? `, ${f.size}` : ""}).`;
      else if (altGB > mainGB && !(profile.vram && altGB > profile.vram * 1.5)) reason = `VRAM 여유가 있을 때 쓸 수 있는 상위 품질입니다 (${f.quant}${f.size ? `, ${f.size}` : ""}).`;
    }
    if (reason) alternatives.push({ filename: f.filename, quant: f.quant, size: f.size, folder: `models/${f.folder}`, downloadUrl: hfUrl(f.repo, f.repo_path), reason });
  }
  // 4 + 결함2: VRAM 초과 주 모델 — 확인된 하위 양자화(alternatives=카탈로그 등재+GPU 호환)가 있으면 promoted로 교체(확정 대체 제시). 없으면 미확인 문구 + HF 검색.
  if (selectedMain?.vramTooBig && profile?.vram) {
    if (alternatives.length) {
      const alt = alternatives[0]; // raw 계열 중 가장 작은 호환 후보(turbo 제외 유지)
      selectedMain.promoted = { filename: alt.filename, size: alt.size, quant: alt.quant, downloadUrl: alt.downloadUrl, folder: selectedMain.folder, fullPath: selectedMain.fullPath, node: selectedMain.node, reason: `이 GPU(${profile.vram}GB)에서 실행 가능한 확인된 하위 양자화`, originalFile: selectedMain.selectedFile, originalSize: selectedMain.size };
      selectedMain.vramWarning = null; // promoted가 확정 대체를 보여줌(경고 중복 제거)
    } else {
      selectedMain.vramWarning = `이 GPU(${profile.vram}GB)에서 ${selectedMain.selectedFile}(${selectedMain.size})은 실행이 어렵습니다. 확인된 하위 양자화를 찾지 못했습니다.`;
      selectedMain.noConfirmedAlt = true;
    }
  }
  // 4: 주 모델 외 VRAM 초과 모델도 확인된 대체가 없으면 미확인 표기(HF 검색).
  for (const it of items) if (it.vramTooBig && !it.promoted && it !== selectedMain) it.noConfirmedAlt = true;
  return { family: rec.family, label: rec.label, needs: rec.needs, items, alternatives, exclusions, unknowns, authorLinks: rec.authorLinks || [] };
}
