// 워크플로우 구조 분석 코어 — normalize(파싱) / analyze(진단) / note·folder·repo 매핑.
// Teardown.jsx(JSX)에서 그대로 이동(동작 불변). test/regression.mjs가 node에서 직접 import해 analyze까지 검증하기 위한 분리.
// logParse.js 패턴: 순수 로직 + 데이터(JSON)만 의존, React·DOM 없음.
import compat from "../data/compatibility.json" with { type: "json" };
import nodeRepoMap from "../data/node_repo_map.json" with { type: "json" };
import mgrList from "../data/manager-model-list.json" with { type: "json" };
import tsPatterns from "../data/troubleshooting_patterns.json" with { type: "json" };
import coreFeatureRules from "../data/core_feature_rules.json" with { type: "json" };
import { compareVersion } from "../logParse.js";

// 코어 기능 요구 스캔 — 워크플로우가 특정 ComfyUI 버전/확장을 요구하는 기능을 쓰는지. 로그 버전 대조는 호출부(요약)에서.
export function scanCoreFeatures(nodes) {
  const out = [];
  for (const rule of (coreFeatureRules.rules || [])) {
    const hit = (nodes || []).some((n) => {
      if (rule.detect.nodeType && !new RegExp(rule.detect.nodeType, "i").test(n.type || "")) return false;
      if (rule.detect.widgetValue && !(n.widgets || []).some((w) => typeof w === "string" && w.toLowerCase() === rule.detect.widgetValue.toLowerCase())) return false;
      return true;
    });
    if (hit) out.push(rule);
  }
  return out;
}

export const MODEL_EXTS = [".safetensors",".ckpt",".pt",".pth",".bin",".gguf",".onnx",".glb",".fbx",".obj",".vrm",".gltf"];
export const FRONTEND_ONLY = new Set(["Note","MarkdownNote","Reroute","PrimitiveNode","SetNode","GetNode"]);

export const REPO_BY_CNR = {
  "comfyui-trellis2": "visualbruno/ComfyUI-Trellis2",
  "comfyui-unirig": "PozzettiAndrea/ComfyUI-UniRig",
  "ComfyUI-HyMotion": "Aero-Ex/ComfyUI-HyMotion",
  "ComfyUI-HY-Motion1": "Aero-Ex/ComfyUI-HyMotion",
  "comfyui-rmbg": "1038lab/ComfyUI-RMBG",
  "comfyui-geometrypack": "PozzettiAndrea/ComfyUI-GeometryPack",
  "controlaltai-nodes": "gseth/ControlAltAI-Nodes",
  "comfyui-kjnodes": "kijai/ComfyUI-KJNodes",
  "comfyui_memory_cleanup": "LAOGOU-666/Comfyui-Memory_Cleanup",
  "rgthree": "rgthree/rgthree-comfy",
};
export const REPO_BY_PREFIX = [
  ["Trellis2", "visualbruno/ComfyUI-Trellis2"],
  ["UniRig", "PozzettiAndrea/ComfyUI-UniRig"],
  ["MIA", "PozzettiAndrea/ComfyUI-UniRig"],
  ["HYMotion", "Aero-Ex/ComfyUI-HyMotion"],
  ["GeomPack", "PozzettiAndrea/ComfyUI-GeometryPack"],
  ["RMBG", "1038lab/ComfyUI-RMBG"],
  ["Fast Groups", "rgthree/rgthree-comfy"],
];
export const RENAME_HINT = {
  "hymotionlite.ckpt": "다운로드 원본은 latest.ckpt → 이 이름으로 리네임 필요",
};

// compatibility.json → node repo lookup (cnr_id 소문자화 + aliases → owner/repo)
export function compatNodeRepo(cnrId) {
  if (!cnrId) return null;
  const low = cnrId.toLowerCase();
  const direct = compat.nodes[low];
  if (direct) return direct.repo.replace("https://github.com/", "");
  for (const [, node] of Object.entries(compat.nodes)) {
    if (node.aliases?.some((a) => a.toLowerCase() === low)) return node.repo.replace("https://github.com/", "");
  }
  return REPO_BY_CNR[cnrId] || null;
}

// HuggingFace 연결: 확실한 것만 정확한 repo, 나머지는 검색 링크(없는 건 지어내지 않음)
const HF_EXACT = {
  "clip-vit-large-patch14.safetensors": "openai/clip-vit-large-patch14",
};
const HF_NODL = [".glb",".fbx",".obj",".vrm",".gltf"]; // 3D 자산은 HF 다운로드 대상 아님
export function hfLink(file) {
  const base = file.replace(/\\/g, "/").split("/").pop();
  const low = base.toLowerCase();
  if (HF_NODL.some((e) => low.endsWith(e))) return null;
  if (HF_EXACT[low]) return { url: `https://huggingface.co/${HF_EXACT[low]}`, exact: true };
  const q = base.replace(/\.[^.]+$/, "");
  return { url: `https://huggingface.co/models?search=${encodeURIComponent(q)}`, exact: false };
}

// compatibility.json → model info lookup (파일명 소문자화 → 직링크+폴더+VRAM)
export function compatModelInfo(file) {
  const parts = file.replace(/\\/g, "/").split("/");
  const base = parts[parts.length - 1];
  const stem = base.toLowerCase().replace(/\.[^.]+$/, "");
  // 1층: 내 compat (최우선 — 양자화·VRAM·대안 큐레이션)
  if (compat.models[stem]) {
    const m = compat.models[stem];
    return { url: m.url, exact: true, source: "curated", folder: m.folder, vram_gb: m.vram_gb, size_gb: m.size_gb, alternatives: m.alternatives, name: m.name };
  }
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i].toLowerCase();
    if (compat.models[seg]) {
      const m = compat.models[seg];
      return { url: m.url, exact: true, source: "curated", folder: m.folder, vram_gb: m.vram_gb, size_gb: m.size_gb, alternatives: m.alternatives, name: m.name };
    }
  }
  // 2층: Manager model-list (광범위 직링크)
  if (mgrList?.models?.[stem]) {
    const m = mgrList.models[stem];
    return { url: m.url, exact: true, source: "manager", folder: m.folder, size_label: m.size, name: m.name };
  }
  // 3층: 검색 폴백
  return hfLink(file);
}

// node_repo_map.json → class_type exact match index
const NODE_REPO_INDEX = {};
for (const m of (nodeRepoMap?.mappings || [])) NODE_REPO_INDEX[m.class_type] = m;

export function repoForUnmapped(type, mgrMap) {
  // 1. node_repo_map exact match (큐레이션 DB, 최우선)
  const nrm = NODE_REPO_INDEX[type];
  if (nrm) return { repo: nrm.repo || null, src: "curated" };
  // 2. manager_node_map (extension-node-map 역매핑, 비동기 로드)
  if (mgrMap) {
    const idx = mgrMap.map[type];
    if (idx === -1) return { repo: "CORE", src: "manager" };
    if (typeof idx === "number" && mgrMap.repos[idx]) return { repo: "https://github.com/" + mgrMap.repos[idx], src: "manager" };
  }
  // 3. prefix fallback (접두어 추측)
  for (const [pre, repo] of REPO_BY_PREFIX) if (type.startsWith(pre)) return { repo, src: "prefix" };
  // 3b. 접미 라벨 " (rgthree)" → rgthree-comfy (추정). rgthree는 노드 표시명 끝에 라벨을 붙인다.
  if (/ \(rgthree\)$/i.test(type)) return { repo: "rgthree/rgthree-comfy", src: "prefix" };
  // 4. compatNodeRepo (cnr_id 기반 — unmapped에선 cnr_id 없지만 type→cnr 역추정 시도 가능)
  return { repo: null, src: null };
}
export function nodeRepoDetail(type) {
  return NODE_REPO_INDEX[type] || null;
}

// 파인딩 r: 리치 노트 지원. HTML→텍스트(태그 제거·엔티티 해제·<a href> 링크 보존).
export function htmlToText(s) {
  return String(s || "")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)") // 링크는 "텍스트 (URL)"로 보존
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&#0?47;|&#x2f;/gi, "/")
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{2,}/g, "\n").trim();
}
// 노트 텍스트 추출: Note/MarkdownNote + 범용 리치 노트(내용으로 판정, 노드 type 하드코딩 아님).
// JSON은 {content:"<html>"}(리치 노트)만 채택 — presets·config 등 content 없는 JSON은 노트 아님(오인식 방지: 예 DenoLTXModelDownloader).
function extractNoteText(n, wv) {
  if (n.type === "Note" || n.type === "MarkdownNote") {
    const t = typeof n.properties?.text === "string" && n.properties.text.trim() ? n.properties.text : wv.filter((w) => typeof w === "string").join("\n");
    return /<[a-z][^>]*>/i.test(t) ? htmlToText(t) : t;
  }
  const parts = [];
  const scan = (raw) => {
    if (typeof raw !== "string" || !raw.trim()) return;
    const s = raw.trim();
    if (s.startsWith("{") || s.startsWith("[")) { // JSON: content(리치 노트)만
      if (/"content"\s*:/.test(s)) { try { const o = JSON.parse(s); if (typeof o?.content === "string") parts.push(htmlToText(o.content)); } catch { /* not json */ } }
      return;
    }
    const hasLink = /href\s*=|https?:\/\//i.test(s);
    const hasFile = /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)\b/i.test(s);
    if (hasLink && hasFile) parts.push(/<[a-z][^>]*>/i.test(s) ? htmlToText(s) : s);
  };
  for (const w of wv) scan(w);
  if (typeof n.properties?.text === "string") scan(n.properties.text);
  return parts.length ? parts.join("\n") : null;
}

export function normalizeNode(n, subgraph) {
  const wv = Array.isArray(n.widgets_values) ? n.widgets_values : [];
  return { id: n.id, type: n.type, cnr_id: n.properties?.cnr_id ?? null,
    ver: n.properties?.ver ?? null, mode: n.mode ?? 0,
    widgets: wv,
    autoDownload: n.properties?.auto_download === true, // 결함h: 실행 시 모델 자동 다운로드 위젯(BOOLEAN true)
    noteText: extractNoteText(n, wv),
    color: n.color ?? null, bgcolor: n.bgcolor ?? null,
    pos: Array.isArray(n.pos) ? n.pos : (n.pos && typeof n.pos === "object" ? [n.pos[0] ?? n.pos.x, n.pos[1] ?? n.pos.y] : null), // 소형1: 그룹 멤버십(bbox) 판정용
    subgraph: subgraph ?? null };
}
export function normalize(wf) {
  if (wf && Array.isArray(wf.nodes)) {
    const nodes = wf.nodes.map((n) => normalizeNode(n, null));
    const subs = wf.definitions?.subgraphs;
    if (Array.isArray(subs)) {
      for (let si = 0; si < subs.length; si++) {
        const sg = subs[si];
        if (Array.isArray(sg?.nodes)) {
          for (const n of sg.nodes) nodes.push(normalizeNode(n, si));
        }
      }
    }
    const subgraphIds = new Set((Array.isArray(subs) ? subs : []).map((s) => s?.id).filter(Boolean)); // 서브그래프 정의 ID(UUID) — anomalous 대조용
    const groups = (Array.isArray(wf.groups) ? wf.groups : []).map((g) => ({ title: g.title || g.name || "", bounding: Array.isArray(g.bounding) ? g.bounding : null })); // 소형1: 그룹(제목·bbox)
    return { format: "UI", nodes, links: Array.isArray(wf.links) ? wf.links : [], subgraphIds, groups, frontendVersion: wf.extra?.frontendVersion || null };
  }
  if (wf && typeof wf === "object") {
    const e = Object.entries(wf).filter(([, v]) => v && typeof v === "object");
    if (e.length && e.some(([, v]) => v.class_type)) return { format: "API", nodes: e.map(([id, v]) => ({
      id, type: v.class_type || null, cnr_id: null, ver: null, mode: 0,
      widgets: Object.values(v.inputs || {}).filter((x) => typeof x === "string"),
      subgraph: null })) };
  }
  return null;
}

// 노드 타입 → 모델 폴더 매핑 (ComfyUI 표준). 노드가 로드하는 위치가 곧 정답.
export const SEEDVR2_FOLDER = "models/SEEDVR2"; // 결함c: numz/ComfyUI-SeedVR2_VideoUpscaler 자동 다운로드 경로(전부 대문자, DiT·VAE·GGUF 단일 폴더)
const NODE_FOLDER_MAP = [
  [/SeedVR2/i, SEEDVR2_FOLDER], // dit 패턴보다 앞 — SeedVR2LoadDiTModel이 hymotion으로 오매핑되지 않게
  [/CLIPLoader|DualCLIPLoader|TripleCLIPLoader|TextEncoderLoader/i, "models/text_encoders"], // TextEncoderLoader: LTXAVTextEncoderLoader 등 — 이름의 TextEncoder가 폴더 단서
  [/UNETLoader|UnetLoader/i, "models/unet"],
  [/VAELoader/i, "models/vae"],
  [/LoraLoader/i, "models/loras"],
  [/LatentUpscaleModelLoader/i, "models/latent_upscale_models"],
  [/UpscaleModelLoader/i, "models/upscale_models"],
  [/ControlNetLoader|ControlNetApply/i, "models/controlnet"],
  [/CheckpointLoader|CheckpointSave/i, "models/checkpoints"],
  [/StyleModelLoader/i, "models/style_models"],
  [/GLIGENLoader/i, "models/gligen"],
  [/HypernetworkLoader/i, "models/hypernetworks"],
  [/motion|dit|hymotion/i, "models/hymotion"],
];
export function folderByNodeType(type) {
  if (!type) return null;
  for (const [re, folder] of NODE_FOLDER_MAP) if (re.test(type)) return folder;
  return null;
}
export function guessFolder(file, type) {
  // 1. 노드 타입 기준 (ComfyUI 표준 — 확정)
  const byNode = folderByNodeType(type);
  if (byNode) return byNode;
  // 2. 파일 확장자/이름 보조 (노드 타입으로 못 잡을 때만)
  const f = file.toLowerCase(), ext = "." + f.split(".").pop();
  if ([".glb",".fbx",".obj",".vrm",".gltf"].includes(ext)) return "3D 메시·리그 입출력 자산";
  if (ext === ".onnx") return "models/onnx";
  return "확인 필요";
}
// 절대경로 판정: Windows 드라이브(X:\) 또는 Unix 절대경로(/dir/...). rewritePath와 같은 기준.
function isAbsPath(s) {
  if (typeof s !== "string") return false;
  const norm = s.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(norm) || /^\/[^/].*\//.test(norm);
}
export function portabilityScan(nodes) {
  const hits = [];
  for (const n of nodes) for (const w of n.widgets) {
    if (typeof w !== "string") continue;
    if (w === "flash_attn") hits.push({ node: n.type, value: w, risk: "flash_attn 어텐션은 설치(빌드)가 까다로울 수 있습니다(특히 Windows). 설치가 막히면 sdpa로 변경하세요." });
    else if (isAbsPath(w)) hits.push({ node: n.type, value: w, kind: "abspath", risk: "이 경로는 워크플로우를 만든 사람의 PC 폴더예요. 당신 PC엔 이 폴더가 없을 수 있으니, 이 경로는 무시하고 같은 파일을 당신 ComfyUI 폴더에 두면 됩니다." });
    else if (((w.match(/\\/g) || []).length >= 2 || /\\[\w.-]+\.[A-Za-z0-9]{2,5}(?:$|[\s"'])/.test(w)) && !/\s\\|\\\s/.test(w)) {
      // 결함j: 경로 형태일 때만(다중 백슬래시 또는 백슬래시 뒤 확장자 파일명). 자연어 문장 속 1회성 백슬래시("shadow.\her face")는 제외.
      if (/_\d{8}_/.test(w) && /\.(fbx|glb|obj)$/i.test(w))
        hits.push({ node: n.type, value: w, risk: "워크플로우에 박힌 과거 파일 경로입니다. 내 입력 파일을 다시 넣거나 해당 단계를 다시 실행하면 됩니다 (다른 PC엔 이 경로가 없습니다)." });
      else hits.push({ node: n.type, value: w, risk: "Windows 경로 구분자(\\)입니다. Mac/Linux에선 / 로 바꿔야 합니다." });
    }
    else if (/\.(png|jpe?g|webp|bmp|gif|tiff?|mp4|mov|webm|mkv|avi|wav|mp3|flac|ogg)$/i.test(w) && !/[\\/]/.test(w))
      hits.push({ node: n.type, value: w, risk: "워크플로우에 박힌 입력 파일명입니다. 다른 PC엔 이 파일이 없을 수 있으니 내 입력 파일을 input 폴더에 다시 넣으세요." });
  }
  return hits;
}
// Detect bypass/muted nodes whose output feeds an ACTIVE node → downstream input may break.
// bypass(4) with an upstream link is skipped (ComfyUI may passthrough); muted(2) always cuts the chain.
export function detectBypassBreaks(norm) {
  const links = norm.links || [];
  if (!links.length) return [];
  const byId = {};
  for (const n of norm.nodes) byId[String(n.id)] = n;
  const isOff = (m) => m === 2 || m === 4;
  const out = [];
  for (const n of norm.nodes) {
    if (!isOff(n.mode)) continue;
    const targets = links.filter((l) => Array.isArray(l) && String(l[1]) === String(n.id))
      .map((l) => byId[String(l[3])]).filter((t) => t && !isOff(t.mode));
    if (!targets.length) continue;
    if (n.mode === 4 && links.some((l) => Array.isArray(l) && String(l[3]) === String(n.id))) continue;
    out.push({ id: n.id, type: n.type, mode: n.mode, targets: [...new Set(targets.map((t) => t.type).filter(Boolean))] });
  }
  return out;
}
// troubleshooting_patterns의 ignorable_import_warnings → 노드 타입 매칭 힌트(모듈/노드명 소문자).
const IGNORABLE_HINTS = (tsPatterns.patterns?.find((p) => p.id === "ignorable_import_warnings")?.match || [])
  .map((m) => (m.match(/named '([^']+)'/)?.[1] || m).toLowerCase());
// type이 정상 class_type이 아니라 UUID 형태 → 정의 누락 가능(이상 노드). broken(type=null)과 별개.
export function isUuidType(t) {
  return typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}
export function isIgnorableNode(type) {
  if (!type) return false;
  const t = type.toLowerCase();
  return IGNORABLE_HINTS.some((h) => t.includes(h));
}
// MarkdownNote/Note 텍스트에서 다운로드 URL 추출 → {url, stem}. 제작자가 박은 직링크 우선용.
export function extractNoteLinks(notes) {
  const out = [];
  for (const t of notes) {
    const urls = t.match(/https?:\/\/[^\s)\]"'`]+/g) || [];
    for (const u of urls) {
      const fname = u.split("/").pop().split("?")[0];
      const stem = fname.replace(/\.[^.]+$/, "").toLowerCase();
      if (stem) out.push({ url: u, stem });
    }
  }
  return out;
}

export function analyze(norm, mgrMap) {
  const packVers = {}, packNodes = {}, unmappedRaw = [], frontendOnly = [], muted = [], models = [], broken = [], anomalous = [];
  const authorNotes = norm.nodes.map((n) => n.noteText).filter((t) => t && t.trim());
  const noteLinks = extractNoteLinks(authorNotes);
  // 소형1: 그룹 멤버십(노드 pos ∈ 그룹 bbox [x,y,w,h]) → 그룹 제목. bypass 그룹 전용 모델 분류(접기1)용.
  const groupsG = Array.isArray(norm.groups) ? norm.groups.filter((g) => Array.isArray(g.bounding) && g.bounding.length >= 4) : [];
  const groupOf = (n) => {
    if (!groupsG.length || !Array.isArray(n.pos)) return null;
    const px = n.pos[0], py = n.pos[1];
    for (const g of groupsG) { const [gx, gy, gw, gh] = g.bounding; if (px >= gx && px <= gx + gw && py >= gy && py <= gy + gh) return g.title || "그룹"; }
    return null;
  };
  for (const n of norm.nodes) {
    if (!n.type) { broken.push({ id: n.id }); continue; }
    if (isUuidType(n.type)) { if (norm.subgraphIds?.has(n.type)) continue; anomalous.push({ id: n.id, type: n.type }); continue; } // 서브그래프 정의 ID면 정상 참조(재귀로 내부 진단) → anomalous·Findings 제외
    if (n.cnr_id) { (packVers[n.cnr_id] ||= new Set()).add(n.ver); (packNodes[n.cnr_id] ||= new Set()).add(n.type); }
    else if (FRONTEND_ONLY.has(n.type)) frontendOnly.push(n.type);
    else {
      const nrd = nodeRepoDetail(n.type);
      const { repo, src: repoSrc } = repoForUnmapped(n.type, mgrMap);
      unmappedRaw.push({ id: n.id, type: n.type, repo: repo === "CORE" ? null : repo, repoSrc,
        isCore: repo === "CORE",
        clone_url: nrd?.clone_url || null, manager_searchable: nrd?.manager_searchable ?? null,
        registry: nrd?.registry ?? null, install_note: nrd?.notes || null });
    }
    if (n.mode === 2 || n.mode === 4) muted.push({ id: n.id, type: n.type, mode: n.mode });
    for (const w of n.widgets) if (typeof w === "string" && MODEL_EXTS.some((e) => w.toLowerCase().endsWith(e))) {
      const filePath = w.replace(/\\/g, "/");
      const base = filePath.split("/").pop().toLowerCase();
      const ci = compatModelInfo(filePath);
      const origin = n.subgraph != null ? `서브그래프 #${n.subgraph}에서 발견` : null;
      const noteUrl = noteLinks.find((l) => l.stem === base.replace(/\.[^.]+$/, ""))?.url || null;
      models.push({ node: n.type, file: filePath, folder: ci?.exact ? `models/${ci.folder}` : guessFolder(w, n.type), rename: RENAME_HINT[base] || null, compat: ci?.exact ? ci : null, origin, noteUrl, muted: n.mode === 2 || n.mode === 4, groupTitle: groupOf(n) });
    }
  }
  // 소형1: bypass 그룹 전용 모델 — 어떤 basename의 모든 참조 노드가 muted이고 그중 그룹 소속이 있으면 "다른 그룹용"(접기1). 매핑 불가(그룹 없음)면 빈 객체(현행 유지).
  const byBaseG = new Map();
  for (const m of models) {
    const b = m.file.split("/").pop().toLowerCase();
    const e = byBaseG.get(b) || { anyActive: false, group: null };
    if (!m.muted) e.anyActive = true; else if (m.groupTitle && !e.group) e.group = m.groupTitle;
    byBaseG.set(b, e);
  }
  const bypassGroupModels = {};
  for (const [b, e] of byBaseG) if (!e.anyActive && e.group) bypassGroupModels[b] = e.group;
  // 6-1단(정적 버전 요구): cnr_id="comfy-core" 노드의 최고 ver = "이 버전 기준으로 저장". frontendVersion 병기.
  let savedCore = null, savedCoreNode = null;
  for (const n of norm.nodes) { if (/comfy-core/i.test(n.cnr_id || "") && n.ver) { if (!savedCore || compareVersion(n.ver, savedCore) > 0) { savedCore = n.ver; savedCoreNode = n.type; } } }
  const savedVersion = savedCore ? { core: savedCore, coreNode: savedCoreNode, frontend: norm.frontendVersion || null } : null;
  // 1(Summary): 전부 JSON 정적 추출. 실패 항목은 null(미표기, 날조 금지).
  const isMuted = (n) => n.mode === 2 || n.mode === 4;
  // (1) 그룹 현황: 제목·노드 수·활성/bypass(전 노드 muted면 bypass)
  const groupStatus = groupsG.map((g) => {
    const title = g.title || "그룹";
    const members = norm.nodes.filter((n) => groupOf(n) === title);
    const active = members.filter((n) => !isMuted(n)).length;
    return { title, nodeCount: members.length, bypassed: members.length > 0 && active === 0 };
  }).filter((g) => g.nodeCount > 0);
  // (4) 입출력 종류(활성 노드만). 미디어 입력 있으면 그것만, 없으면 텍스트(프롬프트).
  const IO = [[/LoadImage|LoadImageOutput|ImageLoad/i, "in", "이미지"], [/LoadAudio/i, "in", "오디오"], [/LoadVideo|VHS_LoadVideo/i, "in", "영상"], [/CLIPTextEncode|TextInput|PrimitiveString/i, "in", "텍스트"], [/SaveImage|PreviewImage/i, "out", "이미지"], [/SaveAudio|PreviewAudio/i, "out", "오디오"], [/VideoCombine|SaveVideo|VHS_VideoCombine/i, "out", "영상"]];
  const inSet = new Set(), outSet = new Set();
  for (const n of norm.nodes) { if (isMuted(n)) continue; for (const [re, dir, kind] of IO) if (re.test(n.type || "")) (dir === "in" ? inSet : outSet).add(kind); }
  const media = [...inSet].filter((k) => k !== "텍스트");
  const inputs = media.length ? media : [...inSet];
  const outputs = [...outSet];
  const io = (inputs.length || outputs.length) ? { inputs, outputs } : null;
  // (3) 핵심 파라미터: KSampler(위치 기반: [seed,control,steps,cfg,sampler,...]) + EmptyLatent류 해상도·배치. 있는 것만.
  const kp = {};
  for (const n of norm.nodes) {
    const wv = Array.isArray(n.widgets) ? n.widgets : [];
    if (n.type === "KSampler" && wv.length >= 5) {
      if (kp.steps == null && typeof wv[2] === "number") kp.steps = wv[2];
      if (kp.cfg == null && typeof wv[3] === "number") kp.cfg = wv[3];
      if (kp.sampler == null && typeof wv[4] === "string") kp.sampler = wv[4];
    } else if (/KSampler|SamplerCustom/i.test(n.type || "")) {
      const strs = wv.filter((v) => typeof v === "string");
      const s = strs.find((v) => /euler|dpm|lcm|ddim|uni_pc|heun|res_|ipndm/i.test(v));
      if (s && kp.sampler == null) kp.sampler = s;
      const st = wv.find((v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 150);
      if (st != null && kp.steps == null) kp.steps = st;
    }
    if (/EmptyLatent|EmptySD3|EmptyHunyuan|EmptySDXL/i.test(n.type || "")) {
      const dims = wv.filter((v) => typeof v === "number" && v >= 64 && v <= 8192);
      if (dims.length >= 2 && kp.resolution == null) kp.resolution = `${dims[0]}x${dims[1]}`;
      const batch = wv.find((v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 64);
      if (batch != null && kp.batch == null) kp.batch = batch;
    }
  }
  const keyParams = Object.keys(kp).length ? kp : null;
  // (2) 파이프라인 한 줄: 입력 → 감지된 핵심 단계 → 출력(정적 키워드). 2단계 미만이면 미표기.
  // 단계 감지: 활성 노드 type + 그룹 제목(둘 다 정적 JSON). 그룹 제목에 stage 키워드가 있으면 그 단계 포함(예 PiD "Upscale" 그룹).
  const hasStage = (re) => norm.nodes.some((n) => !isMuted(n) && re.test(n.type || "")) || groupStatus.some((g) => !g.bypassed && re.test(g.title || ""));
  const stages = [];
  if (inputs.length) stages.push(inputs.join("·") + " 입력");
  if (hasStage(/Florence|WD14|Caption|Interrogat|JoyCaption|Tagger|캡션/i)) stages.push("캡션");
  if (hasStage(/Upscale|ESRGAN|SeedVR2|RealESRGAN|업스케일/i)) stages.push("업스케일");
  if (outputs.length) stages.push(outputs.join("·") + " 저장");
  const pipeline = stages.length >= 2 ? stages.join(" → ") : null;
  // (5) 비활성 노드(muted) + 소속 그룹
  const inactiveNodes = muted.map((m) => { const n = norm.nodes.find((x) => x.id === m.id); return { type: m.type, group: n ? groupOf(n) : null }; });
  const structSummary = { groups: groupStatus, io, keyParams, pipeline, inactive: inactiveNodes };
  const packs = Object.keys(packVers).map((id) => {
    const vers = [...packVers[id]].filter(Boolean).map(String);
    return { id, vers, repo: compatNodeRepo(id), nodeTypes: [...packNodes[id]],
      isCore: id === "comfy-core", conflict: id !== "comfy-core" && vers.length > 1 };
  }).sort((a, b) => (a.isCore - b.isCore) || b.vers.length - a.vers.length);

  const byRepo = {};
  for (const p of packs) if (p.repo) (byRepo[p.repo] ||= []).push(p.id);
  const sameRepo = Object.entries(byRepo).filter(([, ids]) => ids.length > 1).map(([repo, ids]) => ({ repo, ids }));

  // Deduplicate models by file path (top-level + subgraph merged)
  const modelMap = new Map();
  for (const m of models) {
    const key = m.file.toLowerCase();
    if (modelMap.has(key)) {
      const ex = modelMap.get(key);
      if (m.origin && !ex.origin) ex.origin = m.origin;
      else if (m.origin && ex.origin && !ex.origin.includes(m.origin)) ex.origin += `, ${m.origin}`;
    } else {
      modelMap.set(key, { ...m });
    }
  }
  const dedupModels = [...modelMap.values()];

  // 결함i: 커스텀 pack 통일 집계 = cnr_id 커스텀 팩 + 미매핑 repo 그룹(중복 1) + 미매핑 solo(각 1). 카운트·처방 동일 기준.
  const uKeys = new Set(); let uSolo = 0;
  for (const u of unmappedRaw) { if (u.isCore) continue; const key = u.repo || u.clone_url; if (key) uKeys.add(key); else uSolo++; }
  const customPackTotal = packs.filter((p) => !p.isCore).length + uKeys.size + uSolo;
  return {
    format: norm.format, totalNodes: norm.nodes.length,
    customPackCount: packs.filter((p) => !p.isCore).length, customPackTotal,
    packs, unmapped: unmappedRaw.filter((u) => !u.isCore), frontendOnly: [...new Set(frontendOnly)],
    muted, models: dedupModels, sameRepo, broken, anomalous, portability: portabilityScan(norm.nodes),
    bypassBreaks: detectBypassBreaks(norm),
    bypassGroupModels, // 소형1: basename → bypass 그룹 제목(다른 그룹용 = 접기1 분류)
    savedVersion, // 6: 정적 저장 버전 {core, coreNode, frontend}
    structSummary, // 1: Summary 정적 추출 {groups, io, keyParams, pipeline, inactive}
    ignorable: [...new Set(norm.nodes.filter((n) => isIgnorableNode(n.type)).map((n) => n.type))],
    coreFeatures: scanCoreFeatures(norm.nodes),
    nodeTypes: [...new Set(norm.nodes.map((n) => n.type).filter(Boolean))], // 로그 혼입 대조용(현재 워크플로우 노드 타입)
    nodeIds: norm.nodes.map((n) => String(n.id)),
    nodeIdType: Object.fromEntries(norm.nodes.filter((n) => n.type).map((n) => [String(n.id), n.type])), // missing_node_type 크로스링크용(id→class_type)
    autoDownloadNodes: [...new Set(norm.nodes.filter((n) => n.autoDownload && n.type).map((n) => n.type))], // 결함h: 실행 시 모델 자동 다운로드 노드
    authorNotes,
  };
}
