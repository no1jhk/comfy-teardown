// 로그·팩 파싱 순수 함수 모음. Teardown.jsx(JSX)와 test/regression.mjs(node) 양쪽에서 import 가능하게 분리.
// 로직 변경 없음 — Teardown.jsx에서 그대로 이동한 것.

// 파일명 토큰 유사도(Jaccard) — 'gemma_3_12B_it_fp4_mixed' vs 'gemma_3_12B_it_fp8_scaled' 처럼 공통 토큰 비율.
export function tokenSim(a, b) {
  const tok = (s) => s.toLowerCase().replace(/\.[^.]+$/, "").split(/[_\-.\s]+/).filter(Boolean);
  const A = new Set(tok(a)), B = new Set(tok(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// ComfyUI 콘솔 로그 → GPU/torch/CUDA + Import times 블록에서 설치 팩·로드 실패 팩(경로 마지막 폴더명, 소문자).
export function parseComfyLog(text) {
  const out = { gpu: "", torch: "", cuda: "", comfyVersion: "", vramGB: null, basePath: "", customNodesPath: "", installedPacks: [], importFailed: [] };
  // 실측 VRAM (콘솔 "Total VRAM 8192 MB"). gpu_rules 테이블보다 항상 우선(테이블은 폴백).
  const vm = text.match(/Total VRAM\s+(\d+)\s*MB/i);
  if (vm) out.vramGB = Math.round(parseInt(vm[1], 10) / 1024);
  const t = text.match(/(?:pytorch|torch)\s*(?:version)?[:\s]+([\d.]+)\+cu(\d+)/i);
  if (t) { out.torch = t[1]; const c = t[2]; out.cuda = c.length >= 3 ? c.slice(0, -1) + "." + c.slice(-1) : c; }
  // ComfyUI 본체 버전 (로그 서두: "ComfyUI version: 0.25.1" / "ComfyUI v0.27.0"). 코어 기능 요구 판정용.
  const cv = text.match(/ComfyUI\s*(?:version)?\s*[:\s]\s*v?(\d+\.\d+(?:\.\d+)?)/i);
  if (cv) out.comfyVersion = cv[1];
  // custom_nodes 경로 (설치 스크립트·브리핑 clone 대상). Import/Prestartup 경로의 custom_nodes 디렉터리.
  const cn = text.match(/([A-Za-z]:[\\/][^\n]*?[\\/]custom_nodes)[\\/]/i) || text.match(/(\/[^\n]*?\/custom_nodes)\//);
  if (cn) out.customNodesPath = cn[1];
  const g = text.match(/(?:NVIDIA\s*)?(?:GeForce\s*)?RTX\s*(\d{4})\s*(Ti|Super)?/i);
  if (g) out.gpu = "RTX " + g[1] + (g[2] ? " " + g[2] : "");
  else { const g2 = text.match(/([AB]\d{3,4}|RTX\s*A?\d{4,5})/i); if (g2) out.gpu = g2[0].trim(); }
  // "Adding extra search path <종류> <경로>" → 모델 루트(basePath) 자동 추출. 각 경로의 부모(마지막=종류 폴더 제외)의 공통 접두.
  const extraPaths = [...text.matchAll(/^\s*Adding extra search path\s+\S+\s+(.+?)\s*$/gim)].map((mm) => mm[1]);
  if (extraPaths.length) {
    const sep = extraPaths[0].includes("\\") ? "\\" : "/";
    const parents = extraPaths.map((p) => { const seg = p.replace(/[\\/]+$/, "").split(/[\\/]/); seg.pop(); return seg; });
    let common = parents[0] || [];
    for (const s of parents.slice(1)) { let i = 0; while (i < common.length && i < s.length && common[i] === s[i]) i++; common = common.slice(0, i); }
    if (common.length) out.basePath = common.join(sep);
  }
  // Import/Prestartup times 블록(헤더 무관·라인 단위): "0.1 seconds: /path/PackName" 경로 마지막 폴더명 → 설치 확인. "(IMPORT FAILED)"는 로드 실패.
  const re = /^\s*[\d.]+\s*seconds?\s*(\(IMPORT FAILED\))?\s*:\s*(.+?)\s*$/gim;
  const inst = new Set(), failed = new Set();
  let m;
  while ((m = re.exec(text))) {
    const base = m[2].replace(/[\\/]+$/, "").split(/[\\/]/).pop().replace(/\.py$/i, "").toLowerCase();
    if (!base) continue;
    if (m[1]) failed.add(base); else inst.add(base);
  }
  for (const b of failed) inst.delete(b); // 로드 실패 팩은 설치 성공에서 제외(로드 실패가 우선)
  out.installedPacks = [...inst]; out.importFailed = [...failed];
  // 블록 존재 플래그 — 불완전(잘린) 로그 감지용. Prestartup만 있고 Import times 없으면 시작 단계에서 잘린 것.
  out.hasImportBlock = /Import times for custom nodes/i.test(text);
  out.hasPrestartupBlock = /Prestartup times for custom nodes/i.test(text);
  out.truncated = out.hasPrestartupBlock && !out.hasImportBlock;
  return out;
}

// 로그를 "got prompt" 경계로 세션 분할 → 최신(마지막) 세션만. 타 워크플로우 실행 이력 혼입 방지.
export function latestLogSession(log) {
  if (!log) return "";
  const parts = log.split(/got prompt/i);
  return parts.length > 1 ? "got prompt" + parts[parts.length - 1] : log;
}

// 오류·경고 줄 + 전후 context줄만 추출(정상 진행 줄 제거). 브리핑 비대화용(원문 전체 운반 금지).
const ERR_LINE_RE = /error|traceback|warning|fail|exception|not in \[|does not exist|invalid prompt|missing|cannot execute|no module|모듈|오류|실패/i;
export function extractErrorLines(log, context = 2) {
  if (!log) return { text: "", errorCount: 0 };
  const lines = log.split(/\r?\n/);
  const keep = new Set();
  let errorCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (ERR_LINE_RE.test(lines[i])) { errorCount++; for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j); }
  }
  if (!keep.size) return { text: "", errorCount: 0 };
  const idx = [...keep].sort((a, b) => a - b);
  const out = []; let prev = -2;
  for (const i of idx) { if (i > prev + 1) out.push("..."); out.push(lines[i]); prev = i; }
  return { text: out.join("\n"), errorCount };
}

// 결함k: 디스크 공간 부족 에러 클래스. 직접형 + 간접형 조합.
export function hasDiskError(log) {
  if (!log) return false;
  // 직접형: 명시적 디스크 부족 메시지.
  if (/WinError 112|No space left on device|errno 28|디스크 공간이 부족/i.test(log)) return true;
  // 간접형: writer channel 실패(증상) + 동일 세션 내 free disk space 경고(원인) 조합.
  // (hasDiskError는 latestLogSession으로 호출되므로 두 신호가 같은 세션 안에 있을 때만 성립.)
  const writerFail = /Internal Writer Error|Background writer channel closed/i.test(log);
  const diskWarn = /Not enough free disk space|free disk space/i.test(log);
  return writerFail && diskWarn;
}

// semver 비교(a<b → -1, a==b → 0, a>b → 1). "0.25.1" vs "0.27" 등. 코어 버전 요구 판정용.
export function compareVersion(a, b) {
  const pa = String(a || "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// 처방 repo 폴더명이 로그의 설치 팩에 있는지 (소문자 basename 비교)
export function packInstalled(repoOrClone, installedPacks) {
  if (!repoOrClone || !installedPacks?.length) return false;
  const base = repoOrClone.replace(/\.git$/, "").replace(/[\\/]+$/, "").split(/[\\/]/).pop().toLowerCase();
  return installedPacks.includes(base);
}

// errlog의 "Value not in list" 직접 파싱(troubleshooting_patterns와 별개). 요구파일 없음 + PC에 있는 후보 목록.
// 여러 노드가 동시에 안 맞을 수 있어 배열 반환. 유사도 1순위는 확신할 때만 best로(아니면 후보만).
export function parseValueNotInList(log) {
  if (!log) return [];
  const out = [];
  const re = /(\w+):\s*'([^']+?)'\s+not in\s+\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(log))) {
    const widget = m[1], required = m[2], listStr = m[3];
    const candidates = (listStr.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)).filter(Boolean);
    if (!candidates.length) continue;
    const ranked = candidates.map((c) => ({ name: c, sim: tokenSim(required, c) })).sort((a, b) => b.sim - a.sim);
    const best = ranked[0], second = ranked[1];
    const confident = best.sim >= 0.4 && (!second || best.sim - second.sim >= 0.2);
    out.push({ widget, required, candidates, best: confident ? best.name : null });
  }
  return out;
}

// 로그의 "노드 타입 없음 = 실행 불가" 확정 실패 시그니처 → red 승격(VNIL과 동일 계열).
// ComfyUI 실제 메시지 + 사용자 지정 토큰. 노드 ID를 뽑을 수 있으면 함께 반환(카피에서 "노드 ID #N" 안내).
export function parseMissingNodeType(log) {
  if (!log) return [];
  const raw = [];
  let m;
  // (a) 실행 검증 실패(가장 확실): "Cannot execute because node XXX does not exist." (같은 줄 Node ID '#14' 있으면 첨부)
  const reExec = /Cannot execute because node\s+(\S+?)\s+does not exist\.?(?:[^\n]*?Node ID\s*['"]?#?(\d+))?/gi;
  while ((m = reExec.exec(log))) raw.push({ nodeType: m[1] || null, nodeId: m[2] || null });
  // (b) 프론트 로드 경고: "following node types were not found:" 뒤 타입 목록
  const reNotFound = /following node types were not found:?\s*([^\n]+)/gi;
  while ((m = reNotFound.exec(log))) for (const t of m[1].split(/[,\s]+/).map((s) => s.replace(/[.\[\]'"]/g, "").trim()).filter(Boolean)) raw.push({ nodeType: t, nodeId: null });
  // (c) 사용자 지정 토큰 missing_node_type (같은 줄 #id 있으면 첨부)
  const reTok = /missing_node_type(?:[^\n]*?#(\d+))?/gi;
  while ((m = reTok.exec(log))) raw.push({ nodeType: null, nodeId: m[1] || null });
  // 병합: 같은 nodeId는 하나로(타입 있는 쪽 우선). "Cannot execute + Node ID"와 "missing_node_type + #id"가 같은 줄에 겹쳐도 이중 계상 방지.
  const byId = new Map(), byType = new Map(); let bare = false;
  for (const r of raw) {
    if (r.nodeId) { const e = byId.get(r.nodeId) || { nodeType: null, nodeId: r.nodeId }; if (!e.nodeType && r.nodeType) e.nodeType = r.nodeType; byId.set(r.nodeId, e); }
    else if (r.nodeType) { if (!byType.has(r.nodeType)) byType.set(r.nodeType, { nodeType: r.nodeType, nodeId: null }); }
    else bare = true;
  }
  const idTypes = new Set([...byId.values()].map((e) => e.nodeType).filter(Boolean));
  const out = [...byId.values(), ...[...byType.values()].filter((e) => !idTypes.has(e.nodeType))];
  if (!out.length && bare) out.push({ nodeType: null, nodeId: null });
  return out;
}
