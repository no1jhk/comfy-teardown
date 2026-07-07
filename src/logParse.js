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
  const out = { gpu: "", torch: "", cuda: "", comfyVersion: "", basePath: "", installedPacks: [], importFailed: [] };
  const t = text.match(/(?:pytorch|torch)\s*(?:version)?[:\s]+([\d.]+)\+cu(\d+)/i);
  if (t) { out.torch = t[1]; const c = t[2]; out.cuda = c.length >= 3 ? c.slice(0, -1) + "." + c.slice(-1) : c; }
  // ComfyUI 본체 버전 (로그 서두: "ComfyUI version: 0.25.1" / "ComfyUI v0.27.0"). 코어 기능 요구 판정용.
  const cv = text.match(/ComfyUI\s*(?:version)?\s*[:\s]\s*v?(\d+\.\d+(?:\.\d+)?)/i);
  if (cv) out.comfyVersion = cv[1];
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
