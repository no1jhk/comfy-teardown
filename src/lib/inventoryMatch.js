// P2.7 — 내 모델 폴더 대조. 순수 함수(브라우저·node 공용).
// 도구는 PC를 직접 못 보므로: 읽기전용 나열 명령(스니펫) → 사용자가 붙여넣은 목록 → 워크플로우 참조 모델과 대조 → 완비 판정.
// 불변: 붙여넣지 않으면 대조하지 않는다(입력 없인 판정 금지). 명령은 읽기만(dir/ls 계열), 쓰기·삭제 없음.
// 파인딩 p: 대조 층(보유 확인)과 카탈로그 층(출처·다운로드)을 분리 — 분모는 워크플로우 참조 모델 전체(미등재 포함).

// 경로 구분자 3종 동치: 백슬래시(\) · 슬래시(/) · 원화기호(₩ U+20A9, 한글 Windows에서 \가 ₩로 표시).
const SEP = /[\\₩]/g;
const baseName = (v) => (v || "").replace(SEP, "/").split("/").pop().toLowerCase();
// 표기 변형 비교 키(2차 패스): basename 소문자 + 하이픈·언더스코어를 단일 구분자(_)로 통일. 확장자 무변. 자동 확정 금지·후보 제시용.
export const variantKey = (v) => baseName(v).replace(/[-_]+/g, "_");
// 폴더명 정규화(위치 비교용): 소문자 + 공백·구분자·언더스코어·점·하이픈 제거.
const normFolder = (s) => String(s || "").toLowerCase().replace(/[\s_.\-/\\₩]/g, "");

// "26.3GB"/"484MB"/"137KB" → GB(십진). modelPlan.sizeToGB와 동일 규약(GB as-is, MB/1000).
function sizeToGB(s) {
  if (!s) return null;
  const m = String(s).match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
  if (!m) return null;
  const v = parseFloat(m[1]); const u = m[2].toUpperCase();
  return u === "TB" ? v * 1000 : u === "GB" ? v : u === "MB" ? v / 1000 : v / 1e6;
}

// 폴더 스캔 출력 텍스트 → Map(파일명소문자 → {size:bytes|null, folder}).
// PowerShell(부모\파일<TAB>바이트) · bash(전체경로<TAB>바이트) · 사람이 붙인 KB/MB/GB 혼용 모두 허용.
// 대소문자 무시, 경로 구분자(\ / ₩) 혼용 허용, 크기 단위 정규화.
export function parseFolderScan(text) {
  const inv = new Map();
  if (!text) return inv;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const norm = line.replace(SEP, "/");
    // 파일 토큰: 모델 확장자로 끝나는 경로/파일명. 탭·2칸+ 공백으로 열 분리 우선(구조적), 없으면 전체 스캔.
    const cols = norm.split(/\t|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const EXT = /\.(?:safetensors|ckpt|pth|pt|gguf|bin|sft|onnx|vae|pte|npz)$/i;
    let fileTok = null;
    // 1순위: 열 전체가 모델 확장자로 끝나면 그 열이 경로(공백 포함 폴더명 보존 — "새 폴더\file").
    for (const c of (cols.length ? cols : [norm])) if (EXT.test(c)) { fileTok = c; break; }
    // 폴백: 비구조 라인에서 토큰 스캔(공백 앞까지).
    if (!fileTok) for (const c of (cols.length ? cols : [norm])) { const mm = c.match(/(\S*\.(?:safetensors|ckpt|pth|pt|gguf|bin|sft|onnx|vae|pte|npz))\b/i); if (mm) { fileTok = mm[1]; break; } }
    if (!fileTok) continue;
    const segs = fileTok.split("/").filter(Boolean);
    const filename = segs[segs.length - 1].toLowerCase();
    const folder = segs.length > 1 ? segs[segs.length - 2].toLowerCase() : "";
    // 크기: 단위형(TB/GB/MB/KB/B) 우선, 없으면 파일 토큰 제거 후 4자리+ 정수(바이트)의 최댓값.
    let size = null;
    const um = norm.match(/(\d[\d,]*(?:\.\d+)?)\s*(TB|GB|MB|KB|B)\b/i);
    if (um) {
      const v = parseFloat(um[1].replace(/,/g, "")); const u = um[2].toUpperCase();
      const mult = u === "TB" ? 1e12 : u === "GB" ? 1e9 : u === "MB" ? 1e6 : u === "KB" ? 1e3 : 1;
      size = Math.round(v * mult);
    } else {
      const nums = (norm.replace(fileTok, "").match(/\d{4,}/g) || []).map(Number);
      if (nums.length) size = Math.max(...nums);
    }
    const prev = inv.get(filename);
    if (!prev || (size && !prev.size)) inv.set(filename, { size, folder });
  }
  return inv;
}

// 파서 실패 진단(무반응 금지). 반환: null(정상) | "error_path"(경로 못 찾음 에러) | "no_items"(목록 아님).
export function scanInputDiagnosis(rawText, parsedCount) {
  const t = String(rawText || "");
  if (!t.trim()) return null;       // 빈 입력 → 발화 없음
  if (parsedCount > 0) return null;  // 파일 파싱됨 → 발화 없음
  if (/PathNotFound|ItemNotFoundException|Cannot find path|is not recognized|No such file or directory|찾을 수 없습니다|does not exist/i.test(t)) return "error_path";
  return "no_items";
}

// 워크플로우 참조 모델 전체와 붙여넣은 목록 대조.
// models: report.models(참조 모델 전체, 미등재 포함) = 대조 분모. plan: 기대 용량·요구 폴더 lookup(카탈로그).
// 반환: results[{file, held, corrupt, misplaced, parsedSize, expected}] · heldSet(보유+제자리) · byFile · complete · scanned.
// corrupt(137KB 사태): 크기 파싱됨 + 기대 용량 10% 미만. misplaced: basename 일치 + 폴더 불일치(요구 폴더 알 때만).
export function reconcileInventory(models, invMap, plan) {
  const scanned = invMap.size > 0;
  // 기대 용량·요구 폴더 lookup — 카탈로그(plan) 우선, 없으면 워크플로우 참조 경로 접두.
  const meta = new Map();
  const put = (base, size, folder) => { if (!base) return; const e = meta.get(base) || {}; meta.set(base, { size: size != null ? size : e.size, folder: folder != null ? folder : e.folder }); };
  for (const it of [...(plan?.items || []), ...(plan?.unknowns || [])]) put(baseName(it.selectedFile || it.workflowValue), it.size, it.folder);
  for (const m of (models || [])) {
    const b = baseName(m.file);
    const norm = String(m.file || "").replace(SEP, "/");
    const wf = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "";
    if (wf && !(meta.get(b) && meta.get(b).folder)) put(b, undefined, wf);
  }
  // 표기 변형 2차 패스 인덱스: 붙여넣은 목록을 variantKey로 묶음(하이픈/언더스코어만 다른 보유 후보 탐색).
  const invByVariant = new Map();
  for (const fn of invMap.keys()) { const vk = variantKey(fn); if (!invByVariant.has(vk)) invByVariant.set(vk, []); invByVariant.get(vk).push(fn); }
  const seen = new Set(); const results = [];
  for (const m of (models || [])) {
    const key = baseName(m.file);
    if (!key || seen.has(key)) continue; seen.add(key);
    const info = meta.get(key) || {};
    const hit = invMap.get(key);
    const held = !!hit;
    // 표기 변형 후보: 완전일치 아닐 때만. 확정 처리 금지·후보 제시(복수면 전부). 다운로드 처방과 병기.
    let variantCandidates = null;
    if (!held) { const cands = (invByVariant.get(variantKey(key)) || []).filter((fn) => fn !== key); if (cands.length) variantCandidates = cands; }
    let corrupt = false;
    if (hit && hit.size && info.size) { const expBytes = (sizeToGB(info.size) || 0) * 1e9; if (expBytes && hit.size < expBytes * 0.1) corrupt = true; }
    // 위치 불일치: basename 일치 + 폴더 불일치. 요구 폴더 모르면 판정 생략(오판보다 관대가 안전, 날조 금지).
    let misplaced = null;
    if (held && hit.folder && info.folder) {
      const heldF = normFolder(hit.folder);
      const segs = String(info.folder).split(SEP).flatMap((p) => p.split("/")).map(normFolder).filter(Boolean);
      if (heldF && segs.length && !segs.some((s) => s === heldF || s.includes(heldF) || heldF.includes(s))) {
        misplaced = { current: hit.folder, required: String(info.folder).replace(/^models[\\/]/i, "") };
      }
    }
    results.push({ file: key, held, corrupt, misplaced, variantCandidates, parsedSize: hit ? hit.size : null, expected: info.size || null });
  }
  const heldSet = new Set(results.filter((r) => r.held && !r.misplaced).map((r) => r.file));
  const byFile = new Map(results.map((r) => [r.file, r]));
  const complete = scanned && results.length > 0 && results.every((r) => r.held && !r.corrupt && !r.misplaced);
  return { results, heldSet, byFile, complete, scanned };
}

// 파인딩 s: 모델 종류 폴더명(이걸 선택하면 상위 폴더를 골라야 함). 하위 폴더 오선택 방어용.
export const TYPE_FOLDERS = ["checkpoints", "vae", "loras", "lora", "diffusion_models", "text_encoders", "unet", "clip", "clip_vision", "controlnet", "upscale_models", "embeddings", "style_models", "gligen", "hypernetworks", "vae_approx", "photomaker"];
export function isTypeFolder(name) { return TYPE_FOLDERS.includes(String(name || "").trim().toLowerCase()); }
// 드라이브 + 폴더명 → 경로 조립. win: "D:\name"(절대). unix: name(브라우저가 루트 못 주므로 그대로). 이미 절대 입력이면 호출측에서 우선.
export function assembleModelPath(drive, folderName, os) {
  const name = String(folderName || "").trim();
  if (!name) return "";
  return os === "win" ? `${drive || "C"}:\\${name}` : name;
}
// 파인딩 t: 조립 산출 경로의 드라이브 문자만 교체(C:\X → N:\X). 선행 "X:"가 없으면 그대로(안전). 조립 여부 판정은 호출측 상태 플래그로(문자열 추정 금지).
export function swapDriveLetter(path, drive) {
  return String(path || "").replace(/^[A-Za-z]:/, `${drive}:`);
}

// 환경 수집 스니펫(읽기전용 나열만). os: "win" | "unix".
// 파인딩 n-1: 입력 경로를 절대 경로 리터럴로 삽입(따옴표). 드라이브 문자(X:\)·UNC·/ 시작이 아니면 스니펫 생성 안 함(드라이브 추정 금지).
// 반환: { snippet: string|null, needsAbsolute: bool, usingDefault: bool }.
export function buildScanSnippet(modelRoot, os) {
  const root = (modelRoot || "").trim();
  const isAbsolute = (p) => /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p) || /^\//.test(p);
  if (root && !isAbsolute(root)) return { snippet: null, needsAbsolute: true, usingDefault: false };
  const usingDefault = !root;
  const target = root || (os === "win" ? "ComfyUI\\models" : "ComfyUI/models");
  const snippet = os === "win"
    ? 'Get-ChildItem -LiteralPath "' + target + '" -Recurse -File | ForEach-Object { "$($_.Directory.Name)\\$($_.Name)`t$($_.Length)" }'
    : "find \"" + target + "\" -type f -exec sh -c 'printf \"%s\\t%s\\n\" \"$1\" \"$(wc -c <\"$1\")\"' _ {} \\;";
  return { snippet, needsAbsolute: false, usingDefault };
}
