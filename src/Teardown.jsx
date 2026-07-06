import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload, Boxes, ChevronRight, GitBranch,
  CircleAlert, Copy, Check, Plus, Minus, Download,
  Terminal, ImagePlus, X, Loader2, FolderOpen,
} from "lucide-react";
import { LOGO } from "./assets/logo.js";
import compat from "./data/compatibility.json";
import { buildRecipes, groupNodesByRepo } from "./data/redNodeRecipe.js";
import mgrList from "./data/manager-model-list.json";
import nodeRepoMap from "./data/node_repo_map.json";
import tsPatterns from "./data/troubleshooting_patterns.json";
import modelAliases from "./data/model_aliases.json";
import modelSizes from "./data/model_sizes.json";

/* ──────────────────────────────────────────────────────────────
   Teardown — ComfyUI 무거운 파이프라인 환경 진단 (MVP v1.0)
   화면 순서: Summary → Solution → Findings → Inventory
   ※ AI 진단(에러 로그 + JSON 컨텍스트 → LLM)은 v1.1 예정.

   타이포 규칙(일관성):
   - 섹션 제목(Summary/Solution/…): DISPLAY 32
   - 블록 제목(1·2·3 / Inventory 1·2): BlockHead — 동일 컴포넌트로 통일
   - 1차 식별자(파일명·노드명·pack명): MONO 18.5
   - 설명/보조: 12~13.5
   - 줄바꿈: 기본은 단어 단위(자연 줄바꿈). 끊을 공백이 없는 토큰
     (파일경로·repo)만 overflowWrap:"anywhere"로 박스 넘칠 때만 부드럽게.
     wordBreak:"break-all"(글자단위 강제 절단)은 쓰지 않는다.
   ────────────────────────────────────────────────────────────── */

// comfy.org 공식 톤: 배경 #201926 플럼 / 텍스트는 순백 아닌 밝은 회색 / 노랑은 포인트만
const C = {
  bg: "#201926", bgDeep: "#1A1420", surface: "#2A2333", surfaceHi: "#342C3F", line: "#3A3248",
  quiet: "#241D2E",
  divider: "rgba(255,255,255,0.09)",
  text: "#C2BFB9", dim: "#A39BAE", faint: "#76707F",
  point: "#F4FF75",
  green: "#C1BFBA", amber: "#C1BFBA", red: "#EF5350", redMuted: "#B59A9B", violet: "#A678E0",
};
const INK = "#1A1505"; // 노랑 배경 위 텍스트
const MONO = "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,Menlo,monospace";
const DISPLAY = "'PP Formula','Space Grotesk','Neue Haas Grotesk Display Pro',Inter,sans-serif"; // 제목용 — comfy.org 공식은 PP Formula(유료). 없으면 Space Grotesk로 폴백.
const SANS = "Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const MODEL_EXTS = [".safetensors",".ckpt",".pt",".pth",".bin",".gguf",".onnx",".glb",".fbx",".obj",".vrm",".gltf"];
const WEIGHT_EXTS = [".ckpt",".safetensors",".pt",".pth",".bin",".gguf",".onnx"];

const FRONTEND_ONLY = new Set(["Note","MarkdownNote","Reroute","PrimitiveNode","SetNode","GetNode"]);

const REPO_BY_CNR = {
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
const REPO_BY_PREFIX = [
  ["Trellis2", "visualbruno/ComfyUI-Trellis2"],
  ["UniRig", "PozzettiAndrea/ComfyUI-UniRig"],
  ["MIA", "PozzettiAndrea/ComfyUI-UniRig"],
  ["HYMotion", "Aero-Ex/ComfyUI-HyMotion"],
  ["GeomPack", "PozzettiAndrea/ComfyUI-GeometryPack"],
  ["RMBG", "1038lab/ComfyUI-RMBG"],
  ["Fast Groups", "rgthree/rgthree-comfy"],
];
const RENAME_HINT = {
  "hymotionlite.ckpt": "다운로드 원본은 latest.ckpt → 이 이름으로 리네임 필요",
};

// compatibility.json → node repo lookup (cnr_id 소문자화 + aliases → owner/repo)
function compatNodeRepo(cnrId) {
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
function hfLink(file) {
  const base = file.replace(/\\/g, "/").split("/").pop();
  const low = base.toLowerCase();
  if (HF_NODL.some((e) => low.endsWith(e))) return null;
  if (HF_EXACT[low]) return { url: `https://huggingface.co/${HF_EXACT[low]}`, exact: true };
  const q = base.replace(/\.[^.]+$/, "");
  return { url: `https://huggingface.co/models?search=${encodeURIComponent(q)}`, exact: false };
}

// 확정 다운로드 직링크만 반환. 검색 URL 떠넘기기 금지 → 못 구하면 null("확인 필요").
// 우선순위: compat/Manager(eff) → web_search 확정 결과 → HF_EXACT 화이트리스트.
function directDownloadUrl(eff, file, research, noteUrl) {
  if (noteUrl) return noteUrl;
  if (eff?.url) return eff.url;
  if (research?.result?.found && research.result.url) return research.result.url;
  const hf = hfLink(file);
  return hf?.exact ? hf.url : null;
}

// compatibility.json → model info lookup (파일명 소문자화 → 직링크+폴더+VRAM)
function compatModelInfo(file) {
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

// model_aliases.json → 같은 모델의 다른 이름(별칭) 안내. 확실한 그룹만(추측 금지).
function modelAliasInfo(file) {
  const stem = file.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  for (const g of (modelAliases.groups || [])) {
    const norms = (g.aliases || []).map((a) => a.toLowerCase());
    if (norms.includes(stem)) {
      const others = g.aliases.filter((a) => a.toLowerCase() !== stem);
      if (others.length) return { others, note: g.note };
    }
  }
  return null;
}

// GB 숫자 → 사람이 읽기 쉬운 단위. 1GB 미만은 MB, 그 이상은 GB. (348MB · 1.45GB · 18GB)
function fmtSize(gb) {
  if (typeof gb !== "number" || !(gb > 0)) return null;
  return gb < 1 ? `${Math.round(gb * 1000)}MB` : `${gb}GB`;
}
// model_sizes.json → 알려진 정상 용량(GB). 정확 일치만(오판 방지). 모르면 null.
function knownModelSize(file) {
  const stem = file.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  const gb = modelSizes.sizes?.[stem];
  return typeof gb === "number" ? gb : null;
}
function stemOf(file) {
  return file.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
}

// ── P7 적립(learned) ── web_search로 확인된 정보를 localStorage에만 후보로 쌓는다.
// 확정 DB(json 파일)는 도구가 절대 자동 수정하지 않는다. 확정은 사람이 내보내기 스니펫을 병합·커밋할 때만.
const LEARNED_KEY = "td-learned-v1";
function loadLearned() {
  try { const r = localStorage.getItem(LEARNED_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveLearned(arr) {
  try { localStorage.setItem(LEARNED_KEY, JSON.stringify(arr)); } catch { /* localStorage 차단 환경이면 메모리에만 */ }
}
// 적립 후보 → 대상 파일별 JSON 스니펫(사람이 확인 후 병합). 각 항목에 미검증 표시를 박는다.
function buildLearnedSnippet(learned) {
  const out = {};
  for (const x of learned) {
    if (x.type === "model_link")
      (out["compatibility.json → models (확인 후 병합)"] ||= {})[x.key] = { url: x.value.url, folder: x.value.folder || "", _note: "web_search 적립 · 미검증 · 확인 필요", _savedAt: x.at };
    else if (x.type === "node_repo")
      (out["node_repo_map.json → mappings (확인 후 추가)"] ||= []).push({ class_type: x.key, repo: x.value.repo, clone_url: x.value.clone_url || null, _note: "web_search 적립 · 미검증 · 확인 필요", _savedAt: x.at });
  }
  return JSON.stringify(out, null, 2);
}

// ComfyUI 시작 로그에서 GPU/torch/CUDA 추출
function parseComfyLog(text) {
  const out = { gpu: "", torch: "", cuda: "" };
  const t = text.match(/(?:pytorch|torch)\s*(?:version)?[:\s]+([\d.]+)\+cu(\d+)/i);
  if (t) { out.torch = t[1]; const c = t[2]; out.cuda = c.length >= 3 ? c.slice(0, -1) + "." + c.slice(-1) : c; }
  const g = text.match(/(?:NVIDIA\s*)?(?:GeForce\s*)?RTX\s*(\d{4})\s*(Ti|Super)?/i);
  if (g) out.gpu = "RTX " + g[1] + (g[2] ? " " + g[2] : "");
  else { const g2 = text.match(/([AB]\d{3,4}|RTX\s*A?\d{4,5})/i); if (g2) out.gpu = g2[0].trim(); }
  return out;
}

const GPU_OPTIONS = ["RTX 3060","RTX 3070","RTX 3080","RTX 3090","RTX 4060","RTX 4070","RTX 4080","RTX 4090","RTX 5070","RTX 5080","RTX 5090"];

// quantization detection & GPU generation matching
function detectQuant(filename) {
  const f = filename.toLowerCase();
  if (f.includes("mxfp8")) return "mxfp8";
  if (f.includes("fp8")) return f.includes("scaled") ? "fp8_scaled" : "fp8_e4m3fn";
  if (f.includes("fp4")) return "fp4_mixed";
  if (f.endsWith(".gguf") || /\bq[0-9]_/.test(f) || f.includes("q4_k") || f.includes("q8_0")) return "gguf";
  if (f.includes("bf16")) return "bf16";
  if (f.includes("fp16")) return "fp16";
  if (f.includes("fp32")) return "fp32";
  return null;
}
function gpuGeneration(gpuStr) {
  if (!gpuStr) return null;
  const g = gpuStr.toLowerCase().replace(/[^0-9a-z]/g, "");
  const gens = compat.quant_rules.gpu_generations;
  for (const [gen, list] of Object.entries(gens)) {
    for (const model of list) {
      if (g.includes(model.toLowerCase().replace(/[^0-9a-z]/g, ""))) return gen;
    }
  }
  return null;
}
// fp8/fp4 모델 → GGUF 대체본·노드 직링크(compatibility.json gguf_alternatives, web_search 확정). 모르면 null.
function ggufAlternative(file) {
  const low = file.toLowerCase();
  const alts = compat.gguf_alternatives || {};
  for (const k of Object.keys(alts)) {
    if (k === "_desc") continue;
    const a = alts[k];
    if ((a.match || []).some((mm) => low.includes(mm.toLowerCase()))) return a;
  }
  return null;
}
function quantWarnings(models, gpuStr) {
  const gen = gpuGeneration(gpuStr);
  if (!gen) return [];
  const out = [];
  for (const m of models) {
    const q = detectQuant(m.file);
    if (!q) continue;
    const rule = compat.quant_rules.formats[q];
    if (!rule) continue;
    const support = rule[gen];
    if (support === false || support === "partial") {
      out.push({ file: m.file, quant: q, gen, support, alt: rule.alt || "GGUF", gguf: ggufAlternative(m.file) });
    }
  }
  return out;
}
const GEN_LABEL = { ampere: "Ampere(30xx)", ada: "Ada(40xx)", blackwell: "Blackwell(50xx)" };

// node_repo_map.json → class_type exact match index
const NODE_REPO_INDEX = {};
for (const m of (nodeRepoMap?.mappings || [])) NODE_REPO_INDEX[m.class_type] = m;

function repoForUnmapped(type, mgrMap) {
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
  // 4. compatNodeRepo (cnr_id 기반 — unmapped에선 cnr_id 없지만 type→cnr 역추정 시도 가능)
  return { repo: null, src: null };
}
function nodeRepoDetail(type) {
  return NODE_REPO_INDEX[type] || null;
}

// troubleshooting_patterns.json → error log keyword matching (OR per pattern)
// 파일명 토큰 유사도(Jaccard) — 'gemma_3_12B_it_fp4_mixed' vs 'gemma_3_12B_it_fp8_scaled' 처럼 공통 토큰 비율.
function tokenSim(a, b) {
  const tok = (s) => s.toLowerCase().replace(/\.[^.]+$/, "").split(/[_\-.\s]+/).filter(Boolean);
  const A = new Set(tok(a)), B = new Set(tok(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
// errlog의 "Value not in list" 직접 파싱(troubleshooting_patterns와 별개). 요구파일 없음 + PC에 있는 후보 목록.
// 여러 노드가 동시에 안 맞을 수 있어 배열 반환. 유사도 1순위는 확신할 때만 best로(아니면 후보만).
function parseValueNotInList(log) {
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
function matchTroubleshootingPatterns(log) {
  if (!log || !log.trim()) return [];
  const text = log.toLowerCase();
  const hits = [];
  for (const p of (tsPatterns?.patterns || [])) {
    if (p.match.some((kw) => text.includes(kw.toLowerCase()))) {
      hits.push(p);
    }
  }
  return hits;
}

function normalizeNode(n, subgraph) {
  const wv = Array.isArray(n.widgets_values) ? n.widgets_values : [];
  const isNote = n.type === "Note" || n.type === "MarkdownNote";
  return { id: n.id, type: n.type, cnr_id: n.properties?.cnr_id ?? null,
    ver: n.properties?.ver ?? null, mode: n.mode ?? 0,
    widgets: wv,
    noteText: isNote ? (typeof n.properties?.text === "string" && n.properties.text.trim() ? n.properties.text : wv.filter((w) => typeof w === "string").join("\n")) : null,
    subgraph: subgraph ?? null };
}
function normalize(wf) {
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
    return { format: "UI", nodes, links: Array.isArray(wf.links) ? wf.links : [] };
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
const NODE_FOLDER_MAP = [
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
function folderByNodeType(type) {
  if (!type) return null;
  for (const [re, folder] of NODE_FOLDER_MAP) if (re.test(type)) return folder;
  return null;
}
function guessFolder(file, type) {
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
function portabilityScan(nodes) {
  const hits = [];
  for (const n of nodes) for (const w of n.widgets) {
    if (typeof w !== "string") continue;
    if (w === "flash_attn") hits.push({ node: n.type, value: w, risk: "flash_attn 어텐션 — Windows 빌드가 까다롭습니다. 설치가 막히면 sdpa로 변경하세요." });
    else if (isAbsPath(w)) hits.push({ node: n.type, value: w, kind: "abspath", risk: "이 경로는 워크플로를 만든 사람의 PC 폴더예요. 당신 PC엔 이 폴더가 없을 수 있으니, 이 경로는 무시하고 같은 파일을 당신 ComfyUI 폴더에 두면 됩니다." });
    else if (/[A-Za-z0-9._-]+\\[A-Za-z0-9._\\-]+/.test(w)) {
      if (/_\d{8}_/.test(w) && /\.(fbx|glb|obj)$/i.test(w))
        hits.push({ node: n.type, value: w, risk: "워크플로에 박힌 과거 파일 경로입니다. 내 입력 파일을 다시 넣거나 해당 단계를 다시 실행하면 됩니다 (다른 PC엔 이 경로가 없습니다)." });
      else hits.push({ node: n.type, value: w, risk: "Windows 경로 구분자(\\)입니다. Mac/Linux에선 / 로 바꿔야 합니다." });
    }
    else if (/\.(png|jpe?g|webp|bmp|gif|tiff?|mp4|mov|webm|mkv|avi|wav|mp3|flac|ogg)$/i.test(w) && !/[\\/]/.test(w))
      hits.push({ node: n.type, value: w, risk: "워크플로에 박힌 입력 파일명입니다. 다른 PC엔 이 파일이 없을 수 있으니 내 입력 파일을 input 폴더에 다시 넣으세요." });
  }
  return hits;
}
// Rewrite hardcoded absolute path: keep meaningful tail, replace prefix with user root.
// Detects absolute paths (Windows X:\... or Unix /...) and finds the best split point.
function rewritePath(original, modelRoot) {
  if (!modelRoot || !original) return null;
  const norm = original.replace(/\\/g, "/");
  // Only rewrite absolute paths
  if (!/^[A-Za-z]:\//.test(norm) && !norm.startsWith("/")) return null;
  const root = modelRoot.replace(/[\\/]+$/, "");
  // Prefer splitting at known ComfyUI directory segments
  const segments = ["models/", "custom_nodes/", "input/", "output/"];
  for (const seg of segments) {
    const idx = norm.toLowerCase().indexOf(seg);
    if (idx >= 0) return `${root}/${norm.slice(idx)}`;
  }
  // Fallback: keep filename only
  const fname = norm.split("/").pop();
  return fname ? `${root}/${fname}` : null;
}
// Detect bypass/muted nodes whose output feeds an ACTIVE node → downstream input may break.
// bypass(4) with an upstream link is skipped (ComfyUI may passthrough); muted(2) always cuts the chain.
function detectBypassBreaks(norm) {
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
function isUuidType(t) {
  return typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}
function isIgnorableNode(type) {
  if (!type) return false;
  const t = type.toLowerCase();
  return IGNORABLE_HINTS.some((h) => t.includes(h));
}
// MarkdownNote/Note 텍스트에서 다운로드 URL 추출 → {url, stem}. 제작자가 박은 직링크 우선용.
function extractNoteLinks(notes) {
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
function analyze(norm, mgrMap) {
  const packVers = {}, packNodes = {}, unmappedRaw = [], frontendOnly = [], muted = [], models = [], broken = [], anomalous = [];
  const authorNotes = norm.nodes.map((n) => n.noteText).filter((t) => t && t.trim());
  const noteLinks = extractNoteLinks(authorNotes);
  for (const n of norm.nodes) {
    if (!n.type) { broken.push({ id: n.id }); continue; }
    if (isUuidType(n.type)) { anomalous.push({ id: n.id, type: n.type }); continue; }
    if (n.cnr_id) { (packVers[n.cnr_id] ||= new Set()).add(n.ver); (packNodes[n.cnr_id] ||= new Set()).add(n.type); }
    else if (FRONTEND_ONLY.has(n.type)) frontendOnly.push(n.type);
    else {
      const nrd = nodeRepoDetail(n.type);
      const { repo, src: repoSrc } = repoForUnmapped(n.type, mgrMap);
      unmappedRaw.push({ id: n.id, type: n.type, repo: repo === "CORE" ? null : repo, repoSrc,
        isCore: repo === "CORE",
        clone_url: nrd?.clone_url || null, manager_searchable: nrd?.manager_searchable ?? null,
        install_note: nrd?.notes || null });
    }
    if (n.mode === 2 || n.mode === 4) muted.push({ id: n.id, type: n.type, mode: n.mode });
    for (const w of n.widgets) if (typeof w === "string" && MODEL_EXTS.some((e) => w.toLowerCase().endsWith(e))) {
      const filePath = w.replace(/\\/g, "/");
      const base = filePath.split("/").pop().toLowerCase();
      const ci = compatModelInfo(filePath);
      const origin = n.subgraph != null ? `서브그래프 #${n.subgraph}에서 발견` : null;
      const noteUrl = noteLinks.find((l) => l.stem === base.replace(/\.[^.]+$/, ""))?.url || null;
      models.push({ node: n.type, file: filePath, folder: ci?.exact ? `models/${ci.folder}` : guessFolder(w, n.type), rename: RENAME_HINT[base] || null, compat: ci?.exact ? ci : null, origin, noteUrl });
    }
  }
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

  return {
    format: norm.format, totalNodes: norm.nodes.length,
    customPackCount: packs.filter((p) => !p.isCore).length,
    packs, unmapped: unmappedRaw.filter((u) => !u.isCore), frontendOnly: [...new Set(frontendOnly)],
    muted, models: dedupModels, sameRepo, broken, anomalous, portability: portabilityScan(norm.nodes),
    bypassBreaks: detectBypassBreaks(norm),
    ignorable: [...new Set(norm.nodes.filter((n) => isIgnorableNode(n.type)).map((n) => n.type))],
    authorNotes,
  };
}

// ── AI 정밀 진단(v1.1) ──────────────────────────────────────────
// 키는 .env.local 의 VITE_ANTHROPIC_API_KEY 에서 읽는다(배포본엔 노출 안 함).
// 키가 없으면 버튼이 안내문만 띄우고 호출하지 않는다.
const AI_KEY = import.meta.env?.VITE_ANTHROPIC_API_KEY || "";
const AI_MODEL = "claude-sonnet-4-5-20250929";

// report(룰 분석 결과)를 LLM에 줄 컨텍스트 문자열로 압축.
function reportToContext(report, env) {
  const packs = report.packs.map((p) => `${p.id}${p.repo ? ` (${p.repo})` : ""} [${p.vers.join(", ") || "ver?"}]${p.conflict ? " ⚠버전충돌" : ""}`);
  const models = report.models.map((m) => `${m.node}: ${m.file} → ${m.folder}`);
  const muted = report.muted.map((m) => `${m.type}(${m.mode === 4 ? "bypass" : "muted"})`);
  const port = report.portability.map((h) => `${h.node}: ${h.value} — ${h.risk}`);
  const lines = [
    `전체 노드: ${report.totalNodes} / 커스텀 pack: ${report.customPackCount}`,
    `패키지·버전:\n${packs.map((x) => "  - " + x).join("\n") || "  없음"}`,
    `참조 모델·자산:\n${models.map((x) => "  - " + x).join("\n") || "  없음"}`,
    `이식 위험 값:\n${port.map((x) => "  - " + x).join("\n") || "  없음"}`,
    `비활성 노드: ${muted.join(", ") || "없음"}`,
  ];
  if (env && (env.gpu || env.torch || env.cuda)) {
    lines.push(`사용자 환경: GPU=${env.gpu || "?"} / torch=${env.torch || "?"} / CUDA=${env.cuda || "?"}`);
  }
  return lines.join("\n");
}

// 에러 로그 + report 컨텍스트 → Claude API → 구조화 JSON 진단.
// 반환: {title, severity, rootCause, relatedNode, fixes[], command, confidence, caveat}
async function runAiDiagnosis(errlog, report, env) {
  if (!AI_KEY) {
    return { _noKey: true };
  }
  const ctx = reportToContext(report, env);
  const prompt = `당신은 ComfyUI 무거운 파이프라인(Trellis2/UniRig/HYMotion) 환경 디버깅 전문가입니다.
아래는 사용자가 실행하려는 워크플로의 구조 분석 결과와, 실행 중 발생한 에러 로그입니다.
이 에러를 **이 워크플로의 구체적인 노드·모델과 결합해서** 진단하세요. 일반론이 아니라 "당신의 OO 노드가/이 모델이" 식으로 짚어야 합니다.
확신이 없으면 솔직하게 caveat에 적고 confidence를 낮추세요. 없는 URL·파일을 지어내지 마세요.

[워크플로 구조]
${ctx}

[에러 로그]
${errlog}

각 해결 단계는 충분히 구체적으로 쓰세요. step에는 한 줄 요약(무엇을 할지)을, detail에는 그 단계를 실제로 따라할 수 있는 자세한 설명(어디서·어떻게·왜, 주의점, 대안)을 2~4문장으로 적으세요. 일반론 금지 — 이 워크플로의 실제 노드·모델·경로를 짚으세요. 단계는 4~7개 권장.

다음 JSON 형식으로만 답하세요. 마크다운·코드펜스 없이 순수 JSON만:
{
  "title": "한 줄 진단 제목 (이 워크플로 맥락 반영)",
  "severity": "high|mid|low",
  "rootCause": "근본 원인 2~3문장. 워크플로의 어느 노드·모델과 연결되는지 명시",
  "relatedNode": "관련 노드 타입 (워크플로에 실제 있는 것, 없으면 빈 문자열)",
  "fixes": [
    { "step": "단계 한 줄 요약", "detail": "이 단계를 따라할 수 있는 자세한 설명 2~4문장" }
  ],
  "command": "실행할 명령어 (있으면, 없으면 빈 문자열)",
  "confidence": "high|mid|low",
  "caveat": "확신이 낮거나 추가 확인이 필요하면 솔직하게. 없으면 빈 문자열"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const textOut = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const clean = textOut.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// 모르는 노드 1개를 web_search로 자동 조사 → 출처 저장소 + 설치 주의사항.
// 로컬(키 있음)에서만 호출됨. 결과는 정적 지식 DB를 살찌우는 후보가 된다.
// 반환: {found, repo, installNote, confidence}
async function researchNode(nodeType) {
  if (!AI_KEY) return { _noKey: true };
  const prompt = `ComfyUI 커스텀 노드 "${nodeType}"의 출처를 웹에서 찾아주세요.
이 노드가 어느 GitHub 저장소(커스텀 노드 팩)에 속하는지, 설치할 때 비개발자가 알아야 할 주의사항(설치 위치, 필요 환경, 추가 빌드 등)이 있는지 확인하세요.
확실하지 않으면 솔직하게 found를 false, confidence를 low로 하세요. 없는 저장소를 지어내지 마세요.

다음 JSON으로만 답하세요. 마크다운·코드펜스 없이 순수 JSON만:
{
  "found": true,
  "repo": "owner/repo 형식 (찾았으면, 못 찾으면 빈 문자열)",
  "installNote": "설치 위치·환경·주의사항 중 핵심을 비개발자 말로 1~2문장 (없으면 빈 문자열)",
  "confidence": "high|mid|low"
}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const textOut = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const clean = textOut.replace(/```json|```/g, "").trim();
  const m = clean.match(/\{[\s\S]*\}/); // web_search는 앞뒤 텍스트가 섞일 수 있어 JSON 블록만 추출
  return JSON.parse(m ? m[0] : clean);
}

// 3층: Manager 실시간 fetch (raw URL, 세션 1회, 내장본 보강/교차검증)
let liveMgrCache = null;
let liveMgrPromise = null;
const MGR_RAW_URL = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/model-list.json";

async function fetchLiveManager() {
  if (liveMgrCache) return liveMgrCache;
  if (liveMgrPromise) return liveMgrPromise;
  liveMgrPromise = (async () => {
    try {
      const res = await fetch(MGR_RAW_URL);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const map = {};
      for (const m of (data.models || [])) {
        const fn = m.filename || "";
        if (!fn) continue;
        const stem = fn.toLowerCase().replace(/\.[^.]+$/, "");
        map[stem] = { url: m.url || "", folder: m.save_path || "", size: m.size || "", name: m.name || "" };
      }
      liveMgrCache = map;
      return map;
    } catch {
      liveMgrCache = {};
      return {};
    }
  })();
  return liveMgrPromise;
}

async function liveModelInfo(file) {
  const stem = file.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.[^.]+$/, "");
  const live = await fetchLiveManager();
  if (live[stem]) {
    const m = live[stem];
    return { url: m.url, exact: true, source: "manager_live", folder: m.folder, size_label: m.size, name: m.name };
  }
  return null;
}

// web_search로 모델 다운로드 URL 검색 (researchNode 패턴 확장)
async function researchModel(filename) {
  if (!AI_KEY) return { _noKey: true };
  const prompt = `ComfyUI 모델 파일 "${filename}"의 다운로드 링크를 웹에서 찾아주세요.
HuggingFace·GitHub·CivitAI 등에서 이 파일을 직접 다운로드할 수 있는 URL을 찾으세요.
확실하지 않으면 솔직하게 found를 false로 하세요. 없는 URL을 지어내지 마세요.

다음 JSON으로만 답하세요. 마크다운·코드펜스 없이 순수 JSON만:
{
  "found": true,
  "url": "직접 다운로드 가능한 URL (찾았으면, 못 찾으면 빈 문자열)",
  "folder": "ComfyUI models/ 아래 어디에 넣을지 (알면, 모르면 빈 문자열)",
  "confidence": "high|mid|low"
}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000); // 20s 타임아웃 — 무응답 시 "찾는 중…" 방치 방지
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AI_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const textOut = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const clean = textOut.replace(/```json|```/g, "").trim();
    const mm = clean.match(/\{[\s\S]*\}/);
    return JSON.parse(mm ? mm[0] : clean);
  } finally {
    clearTimeout(timer);
  }
}

// 에러 로그(텍스트)를 패턴 매칭해 진단 항목으로 변환 (룰 기반 v1.1 초기 버전, LLM 불필요)
// report가 있으면 컨텍스트(노드명·pack)를 결합해 더 구체적인 제안을 붙인다.
// 분석 결과(report)를 순서 있는 "처방" 액션으로 변환 (룰 기반, LLM 불필요)
function buildPrescription(r, envGpu) {
  const steps = [];
  // quantization warnings (맨 앞)
  const qw = quantWarnings(r.models, envGpu);
  if (qw.length) {
    steps.push({
      key: "quant",
      title: `양자화 비호환 ${qw.length}건 — 이 GPU에서 안 돌아갈 수 있음`,
      severity: "high",
      items: qw.map((w) => ({
        file: w.file,
        desc: `${w.quant}은 ${GEN_LABEL[w.gen] || w.gen} GPU에서 ${w.support === false ? "지원 안 됨" : "부분 지원(불안정)"} → ${w.alt}(으)로 교체하세요`,
        gguf: w.gguf,
      })),
    });
  }
  const cloneSet = new Map(); // url → note
  for (const p of r.packs) {
    if (p.isCore) continue;
    const packUrl = nodeRepoMap?.pack_repo_index?.[p.id];
    if (packUrl) cloneSet.set(packUrl, null);
    else if (p.repo) cloneSet.set(`https://github.com/${p.repo}.git`, null);
  }
  for (const u of r.unmapped) {
    if (u.clone_url) cloneSet.set(u.clone_url, u.manager_searchable === false ? `Manager 검색 안 됨 (${u.type})` : null);
    else if (u.repo) cloneSet.set(u.repo.startsWith("https://") ? u.repo.replace(/\/?$/, ".git") : `https://github.com/${u.repo}.git`, null);
  }
  const cloneList = [...cloneSet.keys()];
  const unknown = r.unmapped.filter((u) => !u.repo && !u.clone_url).length;
  const installNotes = r.unmapped.filter((u) => u.install_note).map((u) => ({ file: u.type, desc: u.install_note }));
  if (cloneList.length) steps.push({
    key: "install",
    title: `커스텀 노드 한 번에 설치 (clone 스크립트 · ${cloneList.length}개)`,
    desc: "custom_nodes 폴더에서 git clone (또는 Manager의 Git URL 설치).",
    command: cloneList.map((url) => `git clone ${url}`).join("\n"),
    warn: unknown ? `출처 미상 ${unknown}개는 web_search 확인 필요.` : null,
    installNotes: installNotes.length ? installNotes : null,
  });
  const dl = r.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)));
  if (dl.length) steps.push({
    key: "models",
    title: `모델 한 번에 받기 (${dl.length}개)`,
    desc: "지정 폴더에 배치. 리네임 표시는 이름을 정확히 맞추세요.",
    models: dl,
    integrity: true,
  });
  const env = r.portability.filter((h) => h.value === "flash_attn");
  if (env.length) steps.push({
    key: "env",
    title: "환경 의존 설정 우회",
    desc: "설치가 막히면 대체값으로 바꾸세요.",
    items: env.map((h) => ({ action: `${h.node} — attention을 flash_attn → sdpa 로 변경` })),
  });
  // 끊어진 경로·입력 파일은 단독 처방으로 두지 않는다(대부분 "내 입력 파일을 다시 넣으면 됨").
  // 정보는 Findings "이식 위험 값"에 그대로 표시 — Solution 중복 step 제거.
  return steps;
}

// 진단 결과(report)를 사람이 읽는 Markdown으로 변환 → 복기·기록용 .md 저장
// (의존성 없이 순수 문자열 조립. 노션/GitHub에 그대로 붙여넣기 가능)
// 처방 정보 → OS별 설치 스크립트 문자열. 확정 URL만 실행문, 미확인은 주석. (PRD_v1.1 §2)
function buildInstallScript(report, os) {
  const isWin = os === "bat";
  const L = [];
  const cmt = isWin ? "REM" : "#";

  L.push(isWin ? "@echo off" : "#!/bin/bash");
  L.push(`${cmt} Teardown 설치 스크립트: ${report.source}`);
  L.push(`${cmt} 생성: ${new Date().toISOString().slice(0, 10)}`);
  L.push(`${cmt} ★ 반드시 ComfyUI custom_nodes 폴더 안에서 실행하세요.`);
  L.push(`${cmt}   엉뚱한 폴더에서 실행하면 노드가 잘못된 위치에 설치됩니다.`);
  L.push("");
  if (isWin) {
    L.push(`for %%I in ("%CD%") do set DIRNAME=%%~nxI`);
    L.push(`if /I not "%DIRNAME%"=="custom_nodes" (`);
    L.push(`  echo [오류] 현재 폴더가 custom_nodes가 아닙니다: %CD%`);
    L.push(`  echo ComfyUI custom_nodes 폴더에서 실행하세요.`);
    L.push(`  pause`);
    L.push(`  exit /b 1`);
    L.push(`)`);
  } else {
    L.push(`if [ "$(basename "$(pwd)")" != "custom_nodes" ]; then`);
    L.push(`  echo "[오류] 현재 폴더가 custom_nodes가 아닙니다: $(pwd)"`);
    L.push(`  echo "ComfyUI custom_nodes 폴더에서 실행하세요."`);
    L.push(`  exit 1`);
    L.push(`fi`);
  }
  L.push("");

  // clone URL 수집: clone_url(정확) > pack_repo_index > repo 추정
  const cloneUrls = new Map(); // url → notes
  for (const p of report.packs) {
    if (p.isCore) continue;
    const packUrl = nodeRepoMap?.pack_repo_index?.[p.id];
    if (packUrl) cloneUrls.set(packUrl, null);
    else if (p.repo) cloneUrls.set(`https://github.com/${p.repo}.git`, null);
  }
  for (const u of report.unmapped) {
    if (u.clone_url) cloneUrls.set(u.clone_url, u.manager_searchable === false ? `Manager 검색 안 됨 (${u.type})` : null);
    else if (u.repo) cloneUrls.set(u.repo.startsWith("https://") ? u.repo.replace(/\/?$/, ".git") : `https://github.com/${u.repo}.git`, null);
  }
  if (cloneUrls.size) {
    L.push(`${cmt} === 커스텀 노드 ${cloneUrls.size}개 ===`);
    for (const [url, note] of cloneUrls) {
      if (note) L.push(`${cmt} ${note}`);
      L.push(`git clone ${url}`);
    }
    L.push("");
  }
  const unknownNodes = report.unmapped.filter((u) => !u.repo && !u.clone_url).length;
  if (unknownNodes) {
    L.push(`${cmt} 출처 미상 노드 ${unknownNodes}개: web_search 확인 필요.`);
    L.push("");
  }

  const dl = report.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)));
  if (dl.length) {
    L.push(`${cmt} === 모델 ${dl.length}개 (ComfyUI 루트 기준 경로) ===`);
    L.push(isWin ? "cd .." : "cd ..");
    L.push(`${cmt} ⚠ 큰 모델 다운로드 중에는 ComfyUI/PC를 재부팅하지 마세요. 끊기면 빈 파일이 됩니다.`);
    L.push(`${cmt} ⚠ 받은 뒤 용량 확인. 수 KB/MB로 작으면 깨진 것이니 삭제 후 재다운로드.`);
    L.push(`${cmt}   (.safetensors가 비정상적으로 작으면 JSONDecodeError 발생)`);
    L.push("");
    for (const m of dl) {
      const info = m.compat;
      const folder = (info && info.folder) || m.folder || "models";
      const folderWin = folder.replace(/\//g, "\\");
      const fname = m.file.replace(/\\/g, "/").split("/").pop();
      const ks = knownModelSize(m.file);
      const sizeNote = info?.size_gb ? `정상 약 ${fmtSize(info.size_gb)}` : info?.size_label ? `정상 약 ${info.size_label}` : ks ? `정상 약 ${fmtSize(ks)}` : "용량 확인 필요";
      if (info && info.exact && info.url) {
        L.push(isWin ? `if not exist "${folderWin}" mkdir "${folderWin}"` : `mkdir -p "${folder}"`);
        L.push(isWin
          ? `curl -L -o "${folderWin}\\${fname}" "${info.url}"`
          : `curl -L -o "${folder}/${fname}" "${info.url}"`);
        L.push(`${cmt}   → ${sizeNote}`);
      } else {
        L.push(`${cmt} [수동] ${fname} → ${folder} (URL 미확인) · ${sizeNote}`);
      }
    }
    L.push("");
  }

  const flash = report.portability.filter((h) => h.value === "flash_attn");
  if (flash.length) {
    L.push(`${cmt} === 환경 우회 (수동) ===`);
    for (const h of flash) L.push(`${cmt} ${h.node}: attention을 flash_attn → sdpa 로 변경 (노드 설정 또는 코드).`);
    L.push("");
  }

  L.push(`${cmt} 완료. ComfyUI 재시작 후 워크플로 로드.`);
  return L.join(isWin ? "\r\n" : "\n");
}

// GGUF 대체 세트를 마크다운 들여쓰기 텍스트로 (브리핑·md 공용). fp8+Ampere 시 LLM에 같이 전달.
function ggufLines(gguf) {
  const L = [`  - GGUF 대체(이 GPU에서 동작): ${gguf.note}`];
  for (const c of gguf.components || []) {
    L.push(`    - ${c.role} → ${c.folder}`);
    for (const f of c.files) L.push(`      - ${f.name}${f.size ? ` (${f.size})` : ""}${f.note ? ` · ${f.note}` : ""}: ${f.url}`);
  }
  if (gguf.node) L.push(`    - 필요 노드: ${gguf.node.name} (${gguf.node.repo})`);
  return L;
}
function buildMarkdown(report, summary, rx, env) {
  const L = [];
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  L.push(`# Teardown 진단 리포트`);
  L.push(``);
  L.push(`- 대상: \`${report.source}\``);
  L.push(`- 포맷: ${report.format}`);
  L.push(`- 생성: ${stamp}`);
  L.push(``);
  if (summary) L.push(`> ${summary.diagLine}`);
  L.push(``);

  // Summary 지표
  L.push(`## Summary`);
  L.push(``);
  L.push(`| 항목 | 값 |`);
  L.push(`| --- | --- |`);
  L.push(`| 전체 노드 | ${report.totalNodes} |`);
  L.push(`| 커스텀 pack | ${report.customPackCount} |`);
  L.push(`| 모델 | ${summary ? summary.weightCount : 0} |`);
  L.push(`| 버전 충돌 | ${report.packs.filter((p) => p.conflict).length} |`);
  L.push(`| 이식 위험 | ${report.portability.length} |`);
  L.push(``);
  if (summary && summary.issues.length) {
    for (const it of summary.issues) L.push(`- **${it.head}**. ${it.body}`);
    L.push(``);
  }

  // 에러 로그 (있을 때만) — 원본 로그를 그대로 담아 복기·LLM 재질의에 쓰게 함
  if (report.errlog && report.errlog.trim()) {
    L.push(`## 에러 로그`);
    L.push(``);
    L.push("```");
    L.push(report.errlog.trim());
    L.push("```");
    L.push(``);
  }

  // Solution (처방)
  if (rx.length) {
    L.push(`## Solution`);
    L.push(``);
    rx.forEach((step, i) => {
      L.push(`### ${i + 1}. ${step.severity === "high" ? "⚠ " : ""}${step.title}`);
      if (step.desc) L.push(step.desc);
      if (step.command) {
        L.push(``);
        L.push("```bash");
        L.push(step.command);
        L.push("```");
        L.push(`> 한 줄씩 복사·실행 권장 (중간에 인증·중복 에러 시 멈출 수 있음)`);
      }
      if (step.warn) L.push(`- ⚠ ${step.warn}`);
      if (step.models) {
        L.push(`> 다운로드 전, 해당 폴더에 같은 파일이나 비슷한 이름(별칭)이 이미 있는지 먼저 확인하세요.`);
        for (const m of step.models) {
          const dlUrl = directDownloadUrl(m.compat, m.file, null, m.noteUrl);
          const link = dlUrl ? ` · [다운로드](${dlUrl})` : " · (다운로드 링크 확인 필요)";
          const mks = knownModelSize(m.file);
          const msz = m.compat?.size_gb ? fmtSize(m.compat.size_gb) : m.compat?.size_label || (mks ? fmtSize(mks) : null);
          const szTxt = msz ? ` · 정상 ${msz}` : "";
          const vram = m.compat ? ` (VRAM ${m.compat.vram_gb}GB)` : "";
          L.push(`- \`${m.file}\` → ${m.folder}${szTxt}${vram}${link}`);
          if (m.rename) L.push(`  - ⤷ ${m.rename}`);
        }
      }
      if (step.items) for (const it of step.items) {
        if (it.file) {
          L.push(`- \`${it.file}\`. ${it.desc}`);
          if (it.gguf) for (const ln of ggufLines(it.gguf)) L.push(ln);
        } else {
          L.push(`- ${it.action}`);
        }
      }
      L.push(``);
    });
  }

  // Findings (근거)
  L.push(`## Findings`);
  L.push(``);
  L.push(`### 1. 이식 위험 값 (${report.portability.length})`);
  if (report.portability.length === 0) L.push(`- 없음`);
  else for (const h of report.portability) L.push(`- \`${h.value}\` (${h.node}). ${h.risk}`);
  L.push(``);
  L.push(`### 2. 패키지 · 버전 (${report.packs.length})`);
  for (const p of report.packs) {
    const repo = p.repo ? ` · ${p.repo}` : "";
    const conf = p.conflict ? ` · ⚠ 버전 충돌` : "";
    L.push(`- \`${p.id}\`${repo}. ${p.vers.join(", ") || "버전 미기록"}${conf} (${p.nodeTypes.length}종)`);
  }
  L.push(``);

  // 양자화 호환성 + GGUF 대체
  const mdQw = quantWarnings(report.models, env?.gpu);
  if (mdQw.length) {
    L.push(`### 3. 양자화 호환성 (${mdQw.length})`);
    for (const w of mdQw) L.push(`- \`${w.file}\`: ${w.quant} → ${GEN_LABEL[w.gen] || w.gen} ${w.support === false ? "미지원" : "부분지원"} → ${w.alt} 권장`);
    const seen = new Set();
    for (const w of mdQw) {
      if (!w.gguf) continue;
      const key = w.gguf.note;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const ln of ggufLines(w.gguf)) L.push(ln);
    }
    L.push(``);
  }

  // Inventory
  L.push(`## Inventory`);
  L.push(``);
  L.push(`### 1. 모델 · 자산 (${report.models.length})`);
  if (report.models.length === 0) L.push(`- 없음`);
  else for (const m of report.models) L.push(`- \`${m.file}\` → ${m.folder}${m.rename ? ` (⤷ ${m.rename})` : ""}`);
  L.push(``);
  L.push(`### 2. 비활성 노드 (${report.muted.length})`);
  if (report.muted.length === 0) L.push(`- 없음`);
  else for (const m of report.muted) L.push(`- \`${m.type}\`. ${m.mode === 4 ? "bypass" : "muted"}`);
  L.push(``);

  L.push(`---`);
  L.push(`> pytorch·cuda·python 호환성은 JSON에 없어 미표시 (각 pack requirements.txt 영역). 에러 로그 기반 AI 진단은 v1.1 예정.`);
  L.push(`> Generated by Teardown`);

  return L.join("\n");
}

// LLM에 바로 붙여넣을 "브리핑" — 구조 분석 요약 + 에러 로그 원본 + 지시문.
// 도구가 LLM을 호출하지 않고(비용 0), 사용자가 자기 Claude·Gemini 챗에 붙여넣기 위한 용도.
function buildBriefing(report, errlog, env) {
  const ctx = reportToContext(report, env);
  const qw = quantWarnings(report.models, env?.gpu);
  const rx = buildPrescription(report, env?.gpu);
  const L = [];
  L.push(`아래는 ComfyUI 워크플로의 구조 분석 + 환경 + (있으면)에러 로그입니다.`);
  L.push(`이 정보로 진단하되, 반드시 아래 "출력 형식"을 지켜 답하세요.`);
  L.push(``);
  L.push(`### 출력 형식 (반드시 이 순서)`);
  L.push(`1. **해결 요약** (3~5줄): 지금 당장 뭘 하면 되는지만. 원인 설명 없이 행동만.`);
  L.push(`2. **해결 단계 표**: | 순번 | 할 일 | 대상(파일/노드) | 어디에/어떻게 | 형식의 표. 따라하기 쉽게.`);
  L.push(`3. **이 PC 환경 설정** (있으면): 이 GPU/torch/CUDA에서 바꿔야 할 설정 한눈에.`);
  L.push(`4. **원인 설명** (맨 뒤, 짧게): 왜 이 문제가 생겼는지. 1문단 이내. 장황 금지.`);
  L.push(``);
  L.push(`규칙: 해결을 먼저, 원인은 맨 뒤 짧게. 확신 없으면 솔직히, 없는 URL·파일은 지어내지 마세요.`);
  L.push(``);
  L.push(`## 워크플로 구조 (대상: ${report.source})`);
  L.push("```");
  L.push(ctx);
  L.push("```");
  L.push(``);
  if (qw.length) {
    L.push(`## 이미 발견된 양자화 호환성 문제 (Teardown 룰)`);
    for (const w of qw) L.push(`- ${w.file}: ${w.quant} 형식 → ${GEN_LABEL[w.gen] || w.gen} GPU에서 ${w.support === false ? "미지원" : "부분지원"} → ${w.alt} 권장`);
    const seen = new Set();
    for (const w of qw) {
      if (!w.gguf) continue;
      const key = w.gguf.note;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const ln of ggufLines(w.gguf)) L.push(ln);
    }
    L.push(``);
  }
  if (rx.length) {
    L.push(`## Teardown이 이미 제시한 처방 (참고. 중복 진단 말고 이 다음을 도와주세요)`);
    rx.forEach((step, i) => L.push(`${i + 1}. ${step.title}`));
    L.push(``);
  }
  // 받을 모델 표 — 파일명·폴더(내 경로)·정상 용량·직링크를 LLM에 같이 넘겨 왕복을 줄인다.
  const dlModels = report.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)));
  if (dlModels.length) {
    L.push(`## 받을 모델 (파일명 · 폴더 · 정상 용량 · 직링크)`);
    L.push(`| 받을 파일 | 어디에 둘지 | 정상 용량 | 직링크 |`);
    L.push(`|---|---|---|---|`);
    for (const m of dlModels) {
      const eff = m.compat;
      const ks = knownModelSize(m.file);
      const sz = eff?.size_gb ? fmtSize(eff.size_gb) : eff?.size_label || (ks ? fmtSize(ks) : "확인 필요");
      const dest = (env?.modelRoot && rewritePath(m.file, env.modelRoot)) || m.folder;
      const url = directDownloadUrl(m.compat, m.file, null, m.noteUrl) || "확인 필요";
      L.push(`| ${m.file} | ${dest} | ${sz} | ${url} |`);
    }
    L.push(`> 받은 뒤 위 "정상 용량"과 비교. 수 KB/MB로 작으면 깨진 것이니 삭제 후 재다운로드. 직링크가 "확인 필요"면 정확한 출처를 같이 찾아 주세요.`);
    L.push(``);
  }
  L.push(`## 에러 로그`);
  L.push("```");
  L.push(errlog.trim() || "(에러 로그 없음. 구조·환경만 보고 점검해 주세요)");
  L.push("```");
  L.push(``);
  L.push(`---`);
  L.push(`Generated by Teardown · 이 브리핑을 그대로 붙여넣고 엔터를 누르세요.`);
  return L.join("\n");
}

// 브라우저 다운로드 (서버·라이브러리 없이 Blob)
function downloadText(filename, text) {
  const mime = filename.endsWith(".md") ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// comfy.org 공식 hero 로고 시퀀스 첫 프레임 — 파일 미선택 시 하단 배경용(opacity 20%)
const HERO_BG = "https://media.comfy.org/website/homepage/hero-logo-seq/Logo00.webp";

const SAMPLE_WORKFLOW = { id: "sample", last_node_id: 60, nodes: [
  { id:1, type:"UniRigLoadRiggedMesh", mode:0, properties:{cnr_id:"comfyui-unirig", ver:"1.3.2"}, widgets_values:["Animated\\Spider_20260202_104255001_51ce9405_000.fbx"] },
  { id:2, type:"MIAAutoRig", mode:0, properties:{cnr_id:"comfyui-unirig", ver:"1.4.5"} },
  { id:3, type:"UniRigOrientationCheck", mode:0, properties:{cnr_id:"comfyui-unirig", ver:"a6645ed875446f"}, widgets_values:[512] },
  { id:4, type:"HYMotionDiTLoader", mode:0, properties:{cnr_id:"ComfyUI-HY-Motion1", ver:"a588e907c221"}, widgets_values:["HY-Motion-1.0-Lite\\hyMotionLite.ckpt"] },
  { id:5, type:"HYMotionTextEncoderLoader", mode:0, properties:{cnr_id:"ComfyUI-HY-Motion1", ver:"a588e907c221"}, widgets_values:["clip-vit-large-patch14.safetensors","Qwen3-8B-Q8_0.gguf"] },
  { id:6, type:"HYMotionRetargetFBX", mode:0, properties:{cnr_id:"ComfyUI-HyMotion", ver:"b19a9ff52e0a"} },
  { id:7, type:"HYMotionSaveNPZ", mode:0, properties:{cnr_id:"ComfyUI-HyMotion", ver:"c1168e234220"} },
  { id:8, type:"Trellis2LoadModel", mode:0, properties:{}, widgets_values:["flash_attn","cuda"] },
  { id:9, type:"Trellis2MeshWithVoxelAdvancedGenerator", mode:0, properties:{} },
  { id:10, type:"Trellis2ExportMesh", mode:0, properties:{}, widgets_values:["Trellis2Mesh_00030_.glb"] },
  { id:11, type:"RMBG", mode:4, properties:{cnr_id:"comfyui-rmbg", ver:"7178f940fb74"} },
  { id:12, type:"Trellis2PreProcessImage", mode:2, properties:{} },
  { id:13, type:"VRAMCleanup", mode:0, properties:{cnr_id:"comfyui_memory_cleanup", ver:"1.1.2"} },
  { id:14, type:"PreviewImage", mode:0, properties:{cnr_id:"comfy-core", ver:"0.9.2"} },
  { id:15, type:"MarkdownNote", mode:0, properties:{} },
  { id:16, type:"ImageBatchMulti", mode:0, properties:{cnr_id:"comfyui-kjnodes", ver:"1.1.7"} },
]};

/* ---------- UI 조각 ---------- */
function SectionTitle({ children, sub, subRight }) {
  if (sub && subRight) {
    return (<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, margin: "0 0 18px", flexWrap: "wrap" }}>
      <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>{children}</h2>
      <p style={{ fontFamily: SANS, fontSize: 14, color: C.dim, margin: 0, lineHeight: 1.6, textAlign: "right", maxWidth: 540 }}>{sub}</p>
    </div>);
  }
  return (<div style={{ margin: "0 0 28px" }}>
    <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>{children}</h2>
    {sub && <p style={{ fontFamily: SANS, fontSize: 14, color: C.dim, margin: "10px 0 0", lineHeight: 1.6 }}>{sub}</p>}
  </div>);
}

// 블록 제목 헤더 — Findings(아코디언)와 Inventory가 '완전히 동일하게' 공유.
// toggle 콜백이 있으면 +/- 버튼(아이콘만, 동그라미 없음)을 단다.
function BlockHead({ num, label, count, role, open, onToggle }) {
  const clickable = typeof onToggle === "function";
  return (
    <div onClick={clickable ? onToggle : undefined}
      style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, cursor: clickable ? "pointer" : "default" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* 순번 배지 — 한 자리 숫자면 완전 원형(minWidth=height로 원 보장), 길어지면 자연스럽게 타원 */}
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 28, minWidth: 28, padding: "0 8px", boxSizing: "border-box", borderRadius: 999, background: C.point, color: INK, fontFamily: MONO, fontSize: 15, fontWeight: 800, lineHeight: 1, flexShrink: 0 }}>{num}</span>
          <span style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, letterSpacing: "-0.01em", color: C.text }}>{label}</span>
          {count != null && <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 20, padding: "2px 11px" }}>{count}</span>}
        </div>
        {role && <p style={{ fontSize: 18, color: C.dim, margin: "13px 0 0", lineHeight: 1.5 }}>{role}</p>}
      </div>
      {clickable && (
        <button className="td-acc" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-label="펼치기/접기"
          style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
          {open ? <Minus size={28} strokeWidth={2.25} /> : <Plus size={28} strokeWidth={2.25} />}
        </button>
      )}
    </div>
  );
}

function MetricBox({ value, label, unit }) {
  // comfy.org 공식 카드: 스트로크 없음 / 배경보다 살짝 밝은 플럼 / 위가 미세하게 더 밝은 그라데이션 (이미지에서 추출)
  return (<div style={{ background: "#28222E", border: "none", borderRadius: 16, padding: "16px 18px" }}>
    <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.3 }}>{label}</div>
    <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 3 }}>
      <span style={{ fontFamily: MONO, fontSize: 27, fontWeight: 700, color: C.point, lineHeight: 1 }}>{value}</span>
      {unit && <span style={{ fontSize: 13, color: C.dim }}>{unit}</span>}
    </div>
  </div>);
}
function Empty({ text }) { return <div style={{ fontSize: 13, color: C.faint, padding: "4px 0" }}>{text}</div>; }

/* ---------- 메인 ---------- */
export default function Teardown() {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [open, setOpen] = useState({ fb: false, fa: false, f1: false, f2: false, rn1: true, rn2: true }); // 문제 블록 기본 닫힘 — Solution이 주인공, Findings는 필요시 펼침. rn1/rn2(Red Node STEP)는 기본 펼침
  const [rxChecked, setRxChecked] = useState(() => new Set()); // 처방전 체크 토글 (로컬 state만, 저장 불필요)
  const [detailOpen, setDetailOpen] = useState(false);         // "자세한 진단 보기" 토글 (기본 닫힘)
  const isAdmin = new URLSearchParams(location.search).get("admin") === "1"; // 관리자 모드(적립 데이터 노출)
  const [errlog, setErrlog] = useState("");       // 에러 로그 텍스트 (A안: 상시 노출)
  const [errShots, setErrShots] = useState([]);   // 선택 추가: 에러 캡처 이미지 [{name,url}]
  const [missingText, setMissingText] = useState(""); // 빨간 노드 교정: 사용자가 붙여넣은 누락 모델 파일명
  const [dirText, setDirText] = useState("");         // 빨간 노드 교정: PC 폴더 파일 목록(dir /b 결과)
  const [scanRoot, setScanRoot] = useState("");      // dir 명령 생성기: 모델 루트 경로
  const [rawJson, setRawJson] = useState("");     // A안: 진단하기 버튼이 재실행할 원본 JSON
  const [rawSrc, setRawSrc] = useState("");
  const [aiResult, setAiResult] = useState(null);  // AI 정밀 진단 결과
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const [briefingBusy, setBriefingBusy] = useState(false); // 브리핑 복사 처리 중 표시(딤+스피너)
  const [briefingInfo, setBriefingInfo] = useState(null);  // 무엇을 담았는지 요약 {lines, shots, chars}
  const [envOpen, setEnvOpen] = useState(false);
  const [envLog, setEnvLog] = useState("");
  const [env, setEnv] = useState({ gpu: "", torch: "", cuda: "", modelRoot: "" });
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mgrMap, setMgrMap] = useState(null); // manager_node_map.json (비동기 로드)
  useEffect(() => { fetch("/manager_node_map.json").then((r) => r.ok ? r.json() : null).then(setMgrMap).catch(() => {}); }, []);
  const onEnvLog = (text) => {
    setEnvLog(text);
    const parsed = parseComfyLog(text);
    setEnv((prev) => ({ gpu: parsed.gpu || prev.gpu, torch: parsed.torch || prev.torch, cuda: parsed.cuda || prev.cuda }));
  };
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const fileRef = useRef(null);
  const shotRef = useRef(null);
  const onShots = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setErrShots((prev) => [...prev, ...files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))]);
  };
  const removeShot = (idx) => setErrShots((prev) => { const n = [...prev]; const [g] = n.splice(idx, 1); if (g) URL.revokeObjectURL(g.url); return n; });
  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); };
  const toggleRx = (k) => setRxChecked((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const saveReport = () => {
    if (!report) return;
    const md = buildMarkdown({ ...report, errlog }, summary, rx, env);
    const safe = (report.source || "workflow").replace(/\.[^.]+$/, "").replace(/[^\w가-힣.-]+/g, "_").slice(0, 40);
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    downloadText(`teardown-${safe}-${day}.md`, md);
  };

  const run = useCallback((text, src, logText = "") => {
    setErr(null);
    setRawJson(text); setRawSrc(src);
    setAiResult(null); setAiErr(null); setAiLoading(false);
    setLiveCompat({}); setModelResearch({}); // 새 분석 시 이전 상태 초기화
    try {
      const norm = normalize(JSON.parse(text));
      if (!norm) throw new Error("ComfyUI 워크플로 형식이 아닙니다. nodes 배열 또는 class_type 키가 보이지 않습니다.");
      const rep = analyze(norm, mgrMap);
      setReport({ ...rep, source: src });
    } catch (e) {
      setReport(null);
      setErr(/JSON|Unexpected|token/.test(e.message)
        ? "JSON을 읽지 못했습니다. ComfyUI 워크플로 export가 맞는지 확인하세요." : e.message);
    }
  }, [mgrMap]);
  const onFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => run(String(r.result), file.name);
    r.onerror = () => setErr("파일을 읽지 못했습니다. 다시 시도하세요.");
    r.readAsText(file);
  };
  // 진단하기 — 저장된 원본 JSON을 다시 분석(구조만 재실행). 에러는 AI 진단/브리핑이 따로 처리.
  const diagnose = () => { if (rawJson) run(rawJson, rawSrc); };

  // AI 정밀 진단 — 룰로 부족한 건 LLM이 이 워크플로 맥락으로 풀어준다.
  // 안전장치: 하루 호출 횟수를 제한해 비용 폭주를 막는다(localStorage 기반, 날짜별 리셋).
  const AI_DAILY_LIMIT = 20; // 하루 최대 호출 수
  const doAiDiagnosis = async () => {
    if (!report || !errlog.trim()) return;
    // 일일 호출 제한 체크
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const raw = localStorage.getItem("td-ai-usage");
      const usage = raw ? JSON.parse(raw) : {};
      const used = usage.date === today ? (usage.count || 0) : 0;
      if (used >= AI_DAILY_LIMIT) {
        setAiErr(`오늘의 AI 진단 한도(${AI_DAILY_LIMIT}회)를 모두 사용했습니다. 브리핑 복사로 자신의 챗에서 이어가세요.`);
        return;
      }
      localStorage.setItem("td-ai-usage", JSON.stringify({ date: today, count: used + 1 }));
    } catch { /* localStorage 차단 환경이면 제한 없이 진행 */ }

    setAiLoading(true); setAiErr(null); setAiResult(null);
    try {
      const r = await runAiDiagnosis(errlog, report, env);
      if (r && r._noKey) setAiErr("nokey");
      else setAiResult(r);
    } catch (e) {
      setAiErr(e.message || "알 수 없는 오류");
    } finally {
      setAiLoading(false);
    }
  };

  // LLM용 브리핑 복사 — API 호출 없이(비용 0), 구조 요약+에러를 클립보드에 담아 자기 챗에 붙여넣게 한다.
  // 짧은 처리 표시(딤+스피너) 후 복사하고, 무엇을 담았는지 요약을 보여준다("얘가 일을 했구나").
  const copyBriefing = () => {
    if (!report) return;
    setBriefingBusy(true);
    setBriefingInfo(null);
    setTimeout(() => {
      const text = buildBriefing(report, errlog, env);
      const lines = errlog.trim() ? errlog.trim().split("\n").length : 0;
      copy(text, "briefing");
      setBriefingInfo({ lines, shots: errShots.length, chars: text.length });
      setBriefingBusy(false);
    }, 650);
  };

  // 3층: 실시간 Manager fetch 결과 (비동기 교차검증)
  const [liveCompat, setLiveCompat] = useState({});  // { [filename]: { url, source:"manager_live", ... } }
  useEffect(() => {
    if (!report?.models?.length) return;
    const unmatched = report.models.filter((m) => !m.compat);
    if (unmatched.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = {};
      for (const m of unmatched) {
        const info = await liveModelInfo(m.file);
        if (info) results[m.file] = info;
      }
      if (!cancelled && Object.keys(results).length > 0) setLiveCompat(results);
    })();
    return () => { cancelled = true; };
  }, [report]);
  const [modelResearch, setModelResearch] = useState({});
  // 다운로드 표 "이미 있음" 체크 — 도구가 PC를 못 보므로 사용자가 직접 표시(받아야 할 후보에서 제외).
  const [haveModels, setHaveModels] = useState(() => new Set());
  const toggleHave = (file) => setHaveModels((prev) => { const n = new Set(prev); n.has(file) ? n.delete(file) : n.add(file); return n; });
  // 메모 텍스트 안 URL을 클릭 링크로 (기존 링크 토큰 색 C.point, 새 창)
  const linkifyNote = (text) => text.split(/(https?:\/\/[^\s]+)/g).map((p, k) =>
    /^https?:\/\//.test(p) ? <a key={k} href={p} target="_blank" rel="noopener noreferrer" style={{ color: C.point, overflowWrap: "anywhere" }}>{p}</a> : p);
  const researchUnknownModel = async (filename) => {
    setModelResearch((s) => ({ ...s, [filename]: { loading: true } }));
    try {
      const r = await researchModel(filename);
      setModelResearch((s) => ({ ...s, [filename]: { loading: false, result: r } }));
    } catch (e) {
      setModelResearch((s) => ({ ...s, [filename]: { loading: false, error: e.message || "조사 실패" } }));
    }
  };
  // P7 적립: web_search로 확인된 결과를 localStorage 후보로(미확정). 확정 DB(json)는 안 건드림.
  const [learned, setLearned] = useState(() => loadLearned());
  const addLearned = (item) => setLearned((prev) => {
    const id = `${item.type}:${item.key}`;
    const next = [...prev.filter((x) => x.id !== id), { ...item, id, at: new Date().toISOString().slice(0, 10) }];
    saveLearned(next); return next;
  });
  const removeLearned = (id) => setLearned((prev) => { const next = prev.filter((x) => x.id !== id); saveLearned(next); return next; });
  const clearLearned = () => { setLearned([]); saveLearned([]); };
  const learnedModel = (file) => {
    const hit = learned.find((x) => x.type === "model_link" && x.key === stemOf(file));
    return hit ? { url: hit.value.url, folder: hit.value.folder, exact: true, source: "learned" } : null;
  };
  const learnModelLink = (file, result) => addLearned({ type: "model_link", key: stemOf(file), value: { url: result.url, folder: result.folder || "" }, conf: result.confidence || "mid" });

  const rx = report ? buildPrescription(report, env.gpu) : [];

  // GPU 변경 시 recipes 재계산 (buildRecipes의 gpu 파라미터 반영)
  const recipes = React.useMemo(() => {
    if (!rawJson) return [];
    try { return buildRecipes(JSON.parse(rawJson), { gpu: gpuGeneration(env.gpu) || "ampere" }); } catch { return []; }
  }, [rawJson, env.gpu]);

  // missingText → 직접 지정한 누락 파일명 Set
  const missingSet = React.useMemo(() => {
    if (!missingText.trim()) return new Set();
    const MODEL_RE = /[\w.\-]+\.(safetensors|gguf|ckpt|pt|bin)/gi;
    const set = new Set();
    for (const tok of missingText.match(MODEL_RE) || []) set.add(tok.toLowerCase());
    return set;
  }, [missingText]);

  // dirText → PC에 있는 파일명 Set (null = 입력 안 함)
  const haveFromDir = React.useMemo(() => {
    if (!dirText.trim()) return null;
    const MODEL_RE = /[\w.\-]+\.(safetensors|gguf|ckpt|pt|bin)/gi;
    const set = new Set();
    for (const tok of dirText.match(MODEL_RE) || []) set.add(tok.toLowerCase());
    return set;
  }, [dirText]);

  // "입력이 하나라도 있나" — 렌더에서 뱃지 표시 여부 판단
  const hasRedInput = missingSet.size > 0 || haveFromDir !== null;
  const hasNodeIssues = report && ((report.broken?.length || 0) + (report.unmapped?.length || 0) > 0);

  // recipes + missing 표시 enrichment (원본 buildRecipes 안 건드림)
  const recipesEnriched = React.useMemo(() => {
    if (!hasRedInput) return recipes;
    return recipes.map((r) => ({ ...r, slots: r.slots.map((s) => {
      const v = s.value?.toLowerCase();
      let missing = false;
      if (haveFromDir && v) missing = !haveFromDir.has(v); // 폴더목록에 없으면 누락
      if (v && missingSet.has(v)) missing = true;          // 직접입력은 합집합(무조건 누락)
      return { ...s, missing };
    }) }));
  }, [recipes, missingSet, haveFromDir, hasRedInput]);

  // recipes → 이 워크플로가 참조하는 폴더 unique 집합 (dir 명령 생성용)
  const usedFolders = React.useMemo(() => {
    const set = new Set();
    for (const r of recipes) for (const s of r.slots) if (s.folder && s.folder !== "확인 필요") set.add(s.folder);
    return [...set].sort();
  }, [recipes]);

  // 진단 요약 계산
  let summary = null;
  if (report) {
    const weightCount = report.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e))).length;
    const issues = [];
    if (report.broken?.length) issues.push({ head: `깨진 노드 ${report.broken.length}개`, severity: "high",
      body: "type이 없는 노드입니다. 해당 커스텀 노드가 설치되지 않으면 워크플로 실행이 불가합니다." });
    // 이상 노드(anomalous)는 Findings "정체 미상 노드"(상세·행동)로 일원화 — 요약 중복 제거
    // 진단 한 줄 수치
    const diagNodeM = report.unmapped?.length || 0;
    const diagBrokenK = report.broken?.length || 0;
    const diagModelN = recipes.flatMap((r) => r.slots).length;
    let diagLine = "";
    if (diagNodeM > 0 && diagModelN > 0) diagLine = `현재 상태로는 실행되지 않습니다. 커스텀 노드 ${diagNodeM}개 미설치 · 모델 ${diagModelN}개 점검 필요`;
    else if (diagModelN > 0) diagLine = `현재 상태로는 실행되지 않습니다. 모델 ${diagModelN}개 점검 필요`;
    else if (diagNodeM > 0) diagLine = `현재 상태로는 실행되지 않습니다. 커스텀 노드 ${diagNodeM}개 미설치`;
    else diagLine = "차단 요소가 없습니다. 바로 실행해 보세요";
    if (diagBrokenK > 0) diagLine += ` · 이름 확인 불가 노드 ${diagBrokenK}개 (ComfyUI에서 확인 필요)`;
    summary = {
      diagLine, diagBlocked: diagNodeM > 0 || diagModelN > 0 || diagBrokenK > 0,
      issues, weightCount,
    };
  }

  // 처방전 할 일. 기존 데이터(unmapped·recipesEnriched)에서 항목만 추출. 새 분석 로직 없음(표시층).
  const rxTodos = React.useMemo(() => {
    if (!report) return [];
    const todos = [];
    // (a) 커스텀 노드 설치. 같은 repo 미씽 노드는 groupNodesByRepo로 1항목 그룹핑(clone 1회). repo 없으면 solo 개별.
    const { groups, solo } = groupNodesByRepo(report.unmapped || []);
    for (const g of groups) todos.push({ kind: "nodegroup", key: `repo-${g.repo || g.clone_url}`, g });
    for (const u of solo) todos.push({ kind: "node", key: `node-${u.type}-${u.id}`, u });
    // (b) 모델 준비. 노드 카드 단위가 아니라 슬롯 단위로 평탄화
    for (const rc of recipesEnriched) for (const s of rc.slots) {
      todos.push({ kind: "model", key: `model-${rc.id}-${s.slot}`, s });
    }
    // (c) 입력 파일(LoadAudio류). portability 중 미디어 파일명(경로 아님) 승격. 절대경로·flash_attn은 확장자/경로 조건으로 자동 제외.
    for (const h of (report.portability || [])) {
      if (/\.(png|jpe?g|webp|bmp|gif|tiff?|mp4|mov|webm|mkv|avi|wav|mp3|flac|ogg)$/i.test(h.value) && !/[\\/]/.test(h.value)) {
        todos.push({ kind: "input", key: `input-${h.node}-${h.value}`, h });
      }
    }
    return todos;
  }, [report, recipesEnriched]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: SANS, position: "relative", overflowX: "hidden",
      backgroundImage: `radial-gradient(circle at 25% -8%, rgba(244,255,117,0.05), transparent 32%)` }}>
      {/* 파일 미선택 시에만. 공식 hero 이미지를 화면 하단에 깔아 빈 공간을 채움.
          opacity 깜빡임(td-hero-breathe) + 위아래 부유(td-hero-float)로 살아있는 느낌. JSON 올리면 사라짐. */}
      {!report && (
        <div aria-hidden className="td-hero" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "58vh", pointerEvents: "none", zIndex: 0,
          backgroundImage: `url(${HERO_BG})`, backgroundRepeat: "no-repeat", backgroundPosition: "center bottom",
          backgroundSize: "contain", maskImage: "linear-gradient(to bottom, transparent, #000 38%)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 38%)" }} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap');        .td-drop{transition:border-color .18s,background .18s}
        .td-btn{transition:transform .12s,opacity .18s}
        .td-btn:hover{transform:translateY(-1px)} .td-btn:active{transform:translateY(0)}
        .td-copy{transition:opacity .15s;opacity:.85}.td-copy:hover{opacity:1}
        .td-havelink{background:transparent;border:none;color:${C.faint};transition:color .15s;cursor:pointer}.td-havelink:hover{color:${C.text}}
        .td-acc{transition:opacity .15s;opacity:.9}.td-acc:hover{opacity:1}
        .td-spin{animation:tdSpin .9s linear infinite}@keyframes tdSpin{to{transform:rotate(360deg)}}
        .td-hf{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid ${C.point};color:${C.point};background:transparent;border-radius:999px;padding:6px 16px;min-width:76px;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf:hover{background:${C.point};color:${INK}}
        .td-hf-sm{display:inline-flex;align-items:center;justify-content:center;width:280px;max-width:100%;border:1px solid ${C.point};color:${C.point};background:transparent;border-radius:999px;padding:8px 0;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf-sm:hover{background:${C.point};color:${INK}}
        /* 결과저장 등 아웃라인 pill. hover시 노랑으로 채움 (다른 버튼과 동일) */
        .td-outline{border:1px solid ${C.point};color:${C.point};background:transparent;transition:background .15s,color .15s,transform .12s}
        .td-outline:hover{background:${C.point};color:${INK};transform:translateY(-1px)}.td-outline:active{transform:translateY(0)}
        .td-outline-w{border:1px solid ${C.text};color:${C.text};background:transparent;transition:background .15s,color .15s,transform .12s}
        .td-outline-w:hover{background:${C.text};color:${C.bg};transform:translateY(-1px)}.td-outline-w:active{transform:translateY(0)}
        /* 진단하기 풀폭 CTA. 아웃라인, hover시 채움. disabled면 회색·채움 없음 */
        .td-cta{border:1px solid ${C.point};color:${C.point};background:transparent;transition:background .15s,color .15s,transform .12s}
        .td-cta:hover{background:${C.point};color:${INK};transform:translateY(-1px)}.td-cta:active{transform:translateY(0)}
        .td-cta:disabled{border-color:${C.line};color:${C.faint};background:#30293b;cursor:not-allowed;transform:none}
        .td-cta{border-radius:999px}
        .td-fade{animation:tdFade .4s ease both}
        @keyframes tdFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        /* hero 배경: 숨쉬듯 opacity 변화(5%↔20%) + 위아래 부유(낙차 크게·살짝 빠르게) */
        .td-hero{opacity:.1;animation:tdHeroBreathe 7s ease-in-out infinite, tdHeroFloat 7.5s ease-in-out infinite}
        @keyframes tdHeroBreathe{0%,100%{opacity:.05}50%{opacity:.20}}
        @keyframes tdHeroFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-22px)}}
        ::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:${C.line};border-radius:8px}
        @media (prefers-reduced-motion:reduce){.td-fade{animation:none}.td-btn:hover{transform:none}}
      `}</style>
      <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "32px 20px", boxSizing: "border-box", position: "relative", zIndex: 1, flexShrink: 0 }}>
        {/* 헤더. 로고 */}
        <img src={LOGO} alt="Comfy Teardown" style={{ height: 50, width: "auto", display: "block", marginBottom: 16 }} />
        <p style={{ color: C.dim, fontSize: 16, margin: "0 0 28px", lineHeight: 1.6 }}>실행에 문제 있는 JSON 파일을 첨부하면, 모든 노드를 분석해서 문제점을 진단하고 해결법을 제시합니다.</p>

        {/* B안 1차 입력. JSON 드롭존(주인공, 노란 점선 단독). 드래그&드롭으로 넣는 공간임을 명확히. */}
        <div className="td-drop"
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
          style={{ border: `2px dashed ${C.point}`, background: drag ? C.surfaceHi : C.surface,
            borderRadius: 16, padding: "26px 22px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", position: "relative", zIndex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.surfaceHi, display: "grid", placeItems: "center", border: `1px solid ${C.line}`, flexShrink: 0 }}>
            <Upload size={19} color={C.point} strokeWidth={1.9} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            {report ? (<>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflowWrap: "anywhere" }}>{report.source}</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>분석 완료 · {report.format} 포맷 · 다른 파일을 올리면 다시 분석합니다</div>
            </>) : (<>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>workflow.json을 끌어다 놓기</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>ComfyUI에서 내보낸 UI/API 포맷 모두 지원</div>
            </>)}
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
          {/* 두 버튼은 별도 래퍼로 묶어 gap 13(기존 26의 절반)만 적용. 부모 gap 18과 분리 */}
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <button className="td-btn td-outline" onClick={() => fileRef.current?.click()}
              style={{ borderRadius: 999, padding: "10px 20px", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{report ? "다른 파일" : "파일 선택"}</button>
            <button className="td-btn td-outline-w" onClick={() => run(JSON.stringify(SAMPLE_WORKFLOW), "샘플 · Rig+Anim 파이프라인")}
              style={{ borderRadius: 999, padding: "10px 18px", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>샘플 보기</button>
          </div>
        </div>

        {/* 환경 정보. 접이식. JSON 드롭존 아래, 결과 위. 선택사항. */}
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setEnvOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "6px 0", color: C.dim, fontFamily: SANS, fontSize: 14, fontWeight: 600 }}>
            {envOpen ? <Minus size={15} color={C.dim} /> : <Plus size={15} color={C.dim} />}
            <span>내 환경 정보 (선택)</span>
            {(env.gpu || env.torch || env.cuda || env.modelRoot) && !envOpen && (
              <span style={{ fontSize: 13, color: C.point, fontWeight: 400, marginLeft: 4 }}>
                {[env.gpu, env.torch && `torch ${env.torch}`, env.cuda && `CUDA ${env.cuda}`, env.modelRoot && `경로: ${env.modelRoot}`].filter(Boolean).join(" · ")}
              </span>
            )}
          </button>
          {envOpen && (
            <div className="td-fade" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "20px 22px", marginTop: 6 }}>
              {/* ① ComfyUI 로그 붙여넣기 */}
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>ComfyUI 로그 붙여넣기</div>
              <textarea value={envLog} onChange={(e) => onEnvLog(e.target.value)} spellCheck={false}
                placeholder="ComfyUI 시작 시 콘솔에 뜨는 로그를 붙여넣으세요. GPU·torch·CUDA를 자동으로 읽습니다."
                style={{ width: "100%", minHeight: 110, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", color: C.text, fontFamily: MONO, fontSize: 13, lineHeight: 1.6, resize: "vertical", boxSizing: "border-box" }} />
              {envLog && (env.gpu || env.torch || env.cuda) && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#8BC34A", lineHeight: 1.5 }}>
                  감지됨: {[env.gpu, env.torch && `torch ${env.torch}`, env.cuda && `CUDA ${env.cuda}`].filter(Boolean).join(" · ")}
                </div>
              )}
              {envLog && !env.gpu && !env.torch && !env.cuda && (
                <div style={{ marginTop: 8, fontSize: 13, color: C.faint, lineHeight: 1.5 }}>로그에서 환경 정보를 찾지 못했습니다. 아래에서 직접 선택하세요.</div>
              )}
              <div style={{ fontSize: 13, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>콘솔에서 복사가 안 되면 아래에서 직접 선택하세요</div>

              {/* ② 직접 선택 */}
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.divider}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>또는 직접 선택</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 160px", minWidth: 140 }}>
                    <label style={{ fontSize: 13, color: C.dim, marginBottom: 4, display: "block" }}>GPU</label>
                    <select value={GPU_OPTIONS.includes(env.gpu) ? env.gpu : (env.gpu ? "__custom" : "")}
                      onChange={(e) => { if (e.target.value === "__custom") setEnv((p) => ({ ...p, gpu: "" })); else setEnv((p) => ({ ...p, gpu: e.target.value })); }}
                      style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: SANS, fontSize: 13, boxSizing: "border-box" }}>
                      <option value="">선택 안 함</option>
                      {GPU_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                      <option value="__custom">직접 입력</option>
                    </select>
                    {(env.gpu && !GPU_OPTIONS.includes(env.gpu)) && (
                      <input type="text" value={env.gpu} onChange={(e) => setEnv((p) => ({ ...p, gpu: e.target.value }))} placeholder="예: RTX A6000"
                        style={{ width: "100%", marginTop: 6, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: SANS, fontSize: 13, boxSizing: "border-box" }} />
                    )}
                  </div>
                  <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                    <label style={{ fontSize: 13, color: C.dim, marginBottom: 4, display: "block" }}>torch 버전</label>
                    <input type="text" value={env.torch} onChange={(e) => setEnv((p) => ({ ...p, torch: e.target.value }))} placeholder="예: 2.8.0"
                      style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: MONO, fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                    <label style={{ fontSize: 13, color: C.dim, marginBottom: 4, display: "block" }}>CUDA 버전</label>
                    <input type="text" value={env.cuda} onChange={(e) => setEnv((p) => ({ ...p, cuda: e.target.value }))} placeholder="예: 12.8"
                      style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: MONO, fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                </div>
              </div>

              {/* ②-b 내 모델 루트 경로 */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.divider}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>내 모델 루트 경로 (선택)</div>
                <div style={{ fontSize: 13, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>워크플로에 하드코딩된 절대경로를 내 PC 경로로 치환해 보여줍니다.</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="text" value={env.modelRoot} onChange={(e) => setEnv((p) => ({ ...p, modelRoot: e.target.value, modelRootPartial: false }))}
                    placeholder="내 ComfyUI 루트 경로"
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: MONO, fontSize: 13, boxSizing: "border-box" }} />
                  <button onClick={async () => {
                    try {
                      if (window.showDirectoryPicker) {
                        const handle = await window.showDirectoryPicker();
                        setEnv((p) => ({ ...p, modelRoot: handle.name, modelRootPartial: true }));
                      } else {
                        const input = document.createElement("input");
                        input.type = "file"; input.webkitdirectory = true;
                        input.onchange = () => {
                          const f = input.files?.[0];
                          if (f?.webkitRelativePath) {
                            const root = f.webkitRelativePath.split("/")[0];
                            if (root) setEnv((p) => ({ ...p, modelRoot: root, modelRootPartial: true }));
                          }
                        };
                        input.click();
                      }
                    } catch { /* user cancelled */ }
                  }} title="폴더 선택" style={{ background: C.surfaceHi, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 9px", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <FolderOpen size={16} color={C.point} />
                  </button>
                </div>
                {env.modelRootPartial && <div style={{ fontSize: 13, color: C.faint, marginTop: 5, lineHeight: 1.4 }}>브라우저 보안상 전체 경로는 직접 입력해 주세요.</div>}
              </div>

              {/* ③ 명령어 안내 */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.divider}` }}>
                <button onClick={() => setCmdOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: C.faint, fontFamily: SANS, fontSize: 13 }}>
                  <CircleAlert size={13} /> 명령어로 확인하는 법</button>
                {cmdOpen && (
                  <div className="td-fade" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {[
                      { label: "torch + CUDA", cmd: 'python -c "import torch; print(torch.__version__, torch.version.cuda)"' },
                      { label: "GPU 정보", cmd: "nvidia-smi" },
                    ].map((item) => (
                      <div key={item.cmd} style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, borderRadius: 8, padding: "7px 11px" }}>
                        <code style={{ fontFamily: MONO, fontSize: 13, color: C.text, flex: 1, overflowWrap: "anywhere" }}>{item.cmd}</code>
                        <button onClick={() => copy(item.cmd, "cmd-" + item.label)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: C.point, flexShrink: 0 }}>
                          {copiedKey === "cmd-" + item.label ? <Check size={14} /> : <Copy size={14} />}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {err && (<div className="td-fade" style={{ marginTop: 16, background: "rgba(239,83,80,0.08)", border: `1px solid ${C.red}55`, borderRadius: 12, padding: "13px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <CircleAlert size={17} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 14, lineHeight: 1.55 }}>{err}</span></div>)}

        {report && (<div className="td-fade">
          {/* ══ 처방전 (첫 화면). 기존 데이터(unmapped·recipesEnriched)에서 '할 일'만 뽑은 체크리스트 ══ */}
          <div style={{ marginTop: 40 }}>
            {rxTodos.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, border: `1px solid ${C.red}`, background: "rgba(239,83,80,0.08)", borderRadius: 14, padding: "14px 20px", marginBottom: 20 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.red, lineHeight: 1.5 }}>{summary?.diagLine}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
              {rxTodos.length > 0 ? (
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>Solution</h2>
                </div>
              ) : (
                <div style={{ fontSize: 18, fontWeight: 700, color: C.green, lineHeight: 1.5 }}>차단 요소 없음. 바로 실행해 보세요.</div>
              )}
              <button className="td-btn td-outline-w" onClick={saveReport} title="처방전을 Markdown(.md) 파일로 저장"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "8px 16px", fontFamily: SANS, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                <Download size={15} /> 처방전 저장 (.md)</button>
            </div>

            {rxTodos.length > 0 && (<div style={{ background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 14, overflow: "hidden" }}>
              {rxTodos.map((t, i) => {
                const done = rxChecked.has(t.key);
                let left = null, right = null;
                if (t.kind === "nodegroup") {
                  const g = t.g;
                  const repoFull = (g.repo || g.clone_url || "").replace("https://github.com/", "").replace(/\.git$/, "");
                  const repoName = repoFull.split("/").pop() || repoFull;
                  const cloneUrl = g.clone_url || (g.repo ? (g.repo.startsWith("https://") ? g.repo.replace(/\/?$/, ".git") : `https://github.com/${g.repo}.git`) : null);
                  const ghUrl = g.clone_url ? g.clone_url.replace(/\.git$/, "") : (g.repo ? (g.repo.startsWith("https://") ? g.repo : `https://github.com/${g.repo}`) : null);
                  const repoEl = <span style={{ fontFamily: MONO, color: C.point }}>{repoFull}</span>;
                  left = (<>
                    <div style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                      <span style={{ fontFamily: MONO }}>{repoName}</span> 설치</div>
                    <div style={{ fontSize: 14, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>해결되는 노드 {g.types.length}개: {g.types.join(" · ")}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: C.bg, borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" }}>
                        <code style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 14, color: C.text, overflowWrap: "anywhere", lineHeight: 1.4 }}>git clone {cloneUrl}</code>
                        <button onClick={() => copy(`git clone ${cloneUrl}`, `rx-${t.key}`)} title="명령 복사" style={{ background: "transparent", border: "none", color: C.text, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                          {copiedKey === `rx-${t.key}` ? <Check size={15} /> : <Copy size={15} />}</button>
                      </div>
                      {ghUrl && <a className="td-hf td-outline-w" href={ghUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>GitHub ↗</a>}
                    </div>
                    <div style={{ fontSize: 14, color: C.text, marginTop: 8, lineHeight: 1.6 }}>
                      {g.repoSrc === "prefix" ? <>{g.types.length >= 2 ? "이 노드들을" : "이 노드를"} 제공하는 확장으로 {repoEl} 가 추정됩니다.</> : <>{g.types.length >= 2 ? "이 노드들을" : "이 노드를"} 제공하는 확장 {repoEl} 가 설치되어 있지 않습니다.</>}
                    </div>
                    <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                      {g.repoSrc === "manager" ? "ComfyUI Manager에서 설치할 수 있습니다." : g.repoSrc === "prefix" ? "설치 전 저장소를 확인해 주세요." : "출처 확인된 저장소입니다."}
                    </div>
                  </>);
                  right = null;
                } else if (t.kind === "node") {
                  const u = t.u;
                  left = (<>
                    <div style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.3 }}>
                      <span style={{ fontFamily: MONO }}>{u.type}</span> 노드 설치</div>
                    <div style={{ fontSize: 14, color: C.amber, marginTop: 8, lineHeight: 1.6 }}>출처 확인 필요. Manager에서 노드 이름 검색 또는 web_search</div>
                  </>);
                  right = null;
                } else if (t.kind === "input") {
                  const h = t.h;
                  left = (<>
                    <div style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                      <span style={{ fontFamily: MONO }}>{h.value}</span> 입력 파일 준비</div>
                    <div style={{ fontSize: 14, color: C.faint, marginTop: 6, lineHeight: 1.55 }}>ComfyUI의 input 폴더에 넣거나 LoadAudio 노드에서 다시 선택. 이미 준비돼 있으면 건너뛰기</div>
                  </>);
                  right = null;
                } else {
                  const s = t.s;
                  const alts = s.quantBad && s.ggufAlt?.alternatives?.length ? s.ggufAlt.alternatives : null;
                  if (alts) {
                    const a0 = alts[0];
                    left = (<>
                      <div style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                        <span style={{ fontFamily: MONO }}>{a0.name}</span> 다운로드</div>
                      <div style={{ fontSize: 14, color: C.dim, marginTop: 6 }}><span style={{ fontFamily: MONO }}>{a0.folder}</span> 폴더에 넣으세요</div>
                      <div style={{ fontSize: 14, color: C.faint, marginTop: 6, lineHeight: 1.55 }}>
                        원본 <span style={{ fontFamily: MONO }}>{s.value}</span>은 이 GPU에서 안 돌아 GGUF로 교체
                        {alts[1] && <><br />또는 <span style={{ fontFamily: MONO }}>{alts[1].name}</span>{alts[1].note ? ` (${alts[1].note})` : ""}</>}
                      </div>
                    </>);
                    right = a0.url ? <a className="td-hf" href={a0.url} target="_blank" rel="noopener noreferrer">다운로드</a> : null;
                  } else {
                    const mr = modelResearch[s.value];
                    const foundUrl = learnedModel(s.value)?.url || (s.url && s.url !== "확인 필요" ? s.url : null); // 검색 결과(mr.result.url)는 '찾기' 라벨 유지 위해 제외
                    left = (<>
                      <div style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, color: done ? C.faint : C.text, textDecoration: done ? "line-through" : "none", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                        <span style={{ fontFamily: MONO }}>{s.value}</span> {foundUrl ? "다운로드" : "준비"}
                        {s.quantBad && <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.red, marginLeft: 8 }}>⚠ 이 GPU 비호환</span>}</div>
                      <div style={{ fontSize: 14, color: C.dim, marginTop: 6 }}><span style={{ fontFamily: MONO }}>{s.folder}</span> 폴더에 넣으세요. 이미 있으면 건너뛰기</div>
                      {!foundUrl && <div style={{ fontSize: 13, color: C.faint, marginTop: 6 }}>직접 다운로드 링크가 확인되지 않아 검색으로 연결됩니다.</div>}
                      {s.quantBad && <div style={{ fontSize: 14, color: C.amber, marginTop: 6 }}>이 GPU에서 안 될 수 있음. 대체 GGUF 확인 필요</div>}
                    </>);
                    right = foundUrl ? <a className="td-hf" href={foundUrl} target="_blank" rel="noopener noreferrer">다운로드</a>
                      : mr?.loading ? <button className="td-hf" disabled style={{ opacity: 0.55 }}>찾는 중…</button>
                      : (!AI_KEY || mr?.error || (mr?.result && !mr.result.found)) ? <a className="td-hf td-outline-w" href={`https://www.google.com/search?q=${encodeURIComponent(s.value + " download")}`} target="_blank" rel="noopener noreferrer">웹에서 검색 ↗</a>
                      : <button className="td-hf" onClick={() => researchUnknownModel(s.value)}>찾기</button>;
                  }
                }
                return (
                <React.Fragment key={t.key}>
                {i > 0 && <div style={{ borderTop: `1px solid ${C.divider}`, marginLeft: 20, marginRight: 20 }} />}
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "22px 20px", opacity: done ? 0.5 : 1 }}>
                  <div onClick={() => toggleRx(t.key)} title="완료 표시" style={{ width: 30, height: 30, borderRadius: 15, background: done ? C.line : C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0, cursor: "pointer", marginTop: 1 }}>
                    {done ? <Check size={15} color={C.dim} /> : i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>{left}</div>
                  {right && <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignSelf: "center" }}>{right}</div>}
                </div></React.Fragment>);
              })}
            </div>)}

            <div style={{ marginTop: 18, marginBottom: 110 }}>
              <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6 }}>※ 모든 항목을 마쳤다면 ComfyUI를 완전히 재시작한 뒤 워크플로를 다시 열어 주세요. 빨간 노드가 남아 있지 않으면 정상적으로 설치된 것입니다.</div>
            </div>
          </div>
        </div>)}
        {!report && !err && (<div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "0 20px 40px", boxSizing: "border-box", textAlign: "center", color: C.faint, fontSize: 13 }}>
          <Boxes size={26} strokeWidth={1.25} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 10 }}>파일을 올리거나 "샘플로 보기"로 시작하세요.</div></div>)}
      </div>

      {report && (
        <div style={{ flex: 1, position: "relative", width: "100%", background: detailOpen ? C.bgDeep : "transparent" }}>
          {/* ── 경계 divider: 존 컨테이너의 top edge에 absolute 걸침(translateY -50%). 텍스트가 라인에 수직 중앙, 배경 투명(상반부 밝은/하반부 어두운). 부모(존) 폭 기준 full-bleed(100vw 아님 → 가로 스크롤 없음). ── */}
          <div onClick={() => setDetailOpen((v) => !v)} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: "translateY(-50%)", display: "flex", alignItems: "center", cursor: "pointer", zIndex: 2 }}>
            <div style={{ flex: 1, borderTop: `3px dashed ${C.divider}` }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.divider, fontFamily: SANS, fontSize: 21, fontWeight: 600, flexShrink: 0, padding: "0 12px" }}>
              <span>자세한 진단 보기</span>
              {detailOpen ? <Minus size={21} color={C.dim} /> : <Plus size={21} color={C.dim} />}
            </div>
            <div style={{ flex: 1, borderTop: `3px dashed ${C.divider}` }} />
          </div>
          <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "36px 20px 0", boxSizing: "border-box" }}>

          {detailOpen && (<div className="td-fade">
          {/* Summary. 아래 Solution과의 구분선 제거(borderBottom 없음) */}
          {summary && (
            <div style={{ marginTop: 29, paddingBottom: 48 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, margin: "0 0 28px", flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>Summary</h2>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(124px,1fr))", gap: 10, margin: "0 0 24px" }}>
                <MetricBox value={report.totalNodes} label="전체 노드" unit="개" />
                <MetricBox value={report.customPackCount} label="커스텀 pack" unit="개" />
              </div>
              {report.authorNotes?.length > 0 && (
                <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${C.divider}` }}>
                  <div onClick={() => toggle("an")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <CircleAlert size={16} color={C.amber} style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.amber, flex: 1 }}>제작자 주의사항 (워크플로 메모)</span>
                    <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle("an"); }} aria-label="펼치기/접기"
                      style={{ background: "transparent", border: "none", color: C.amber, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                      {open.an ? <Minus size={18} strokeWidth={2.25} /> : <Plus size={18} strokeWidth={2.25} />}
                    </button>
                  </div>
                  {open.an && (
                    <div style={{ marginTop: 10, paddingBottom: 16, paddingLeft: 24, fontSize: 13, color: C.dim, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {linkifyNote(report.authorNotes.map((t) => t.replace(/\n{2,}/g, "\n")).join("\n"))}
                    </div>
                  )}
                </div>
              )}
              {summary.issues.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.divider}` }}>
                  {summary.issues.map((it, i) => {
                    // "버전 충돌 3건" → 라벨 / 수치 분리해 표처럼 정렬 + 수치는 노란색
                    const mt = it.head.match(/^(.*?)\s*(\d+\s*[가-힣]+)$/);
                    const headLabel = mt ? mt[1] : it.head;
                    const headNum = mt ? mt[2] : "";
                    return (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, padding: "14px 0", borderBottom: `1px solid ${C.divider}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0, minWidth: 168 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 96 }}>
                          <span style={{ width: 3.5, height: 3.5, borderRadius: 999, background: it.severity === "high" ? C.red : C.point, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, fontWeight: 650, color: it.severity === "high" ? C.red : C.text }}>{headLabel}</span>
                        </span>
                        {headNum && <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: it.severity === "high" ? C.red : C.point, textAlign: "right", minWidth: 44 }}>{headNum}</span>}
                      </div>
                      <span style={{ fontSize: 14, color: C.dim, textAlign: "right", lineHeight: 1.5 }}>{it.body}</span>
                    </div>);
                  })}
                </div>
              )}
            </div>
          )}

          {/* 빨간 노드 교정. redNodeRecipe 엔진 출력 */}
          {(recipesEnriched.length > 0 || hasNodeIssues) && (() => {
            const missingCount = hasRedInput ? recipesEnriched.reduce((n, r) => n + r.slots.filter((s) => s.missing).length, 0) : 0;
            return (
            <div style={{ marginTop: 29, paddingBottom: 48 }}>
              <SectionTitle>Error Node Fix</SectionTitle>
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 34px", overflow: "hidden" }}>
                <div style={{ background: C.surfaceHi, margin: "-18px -34px 18px", padding: "16px 34px" }}>
                  <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, lineHeight: 1.6 }}>워크플로에 기록된 값을 확인하고, 사용자 환경에 맞게 조치해 주세요.</div>
                </div>

              {/* STEP 1. 커스텀 노드 설치 (Solution 단계 스타일 아코디언, 기본 펼침) */}
              {hasNodeIssues && (() => { const sopen = !!open.rn1; return (
                <div style={{ paddingTop: 20, paddingBottom: sopen ? 55 : 20 }}>
                  <div onClick={() => toggle("rn1")} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 15, background: C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>1</div>
                    <div style={{ fontSize: 23, fontWeight: 650, color: C.text, lineHeight: 1.2, flex: 1 }}>커스텀 노드 설치</div>
                    <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle("rn1"); }} aria-label="펼치기/접기"
                      style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                      {sopen ? <Minus size={26} strokeWidth={2.25} /> : <Plus size={26} strokeWidth={2.25} />}
                    </button>
                  </div>
                  {sopen && <div style={{ paddingLeft: 44, marginTop: 8 }}>
                <div style={{ marginBottom: 20 }}>
                  {[...report.unmapped.map((u) => ({ t: "u", u })), ...report.broken.map((b) => ({ t: "b", b }))].map((it, i) => {
                    const u = it.u, b = it.b;
                    const ghUrl = it.t === "u" ? (u.clone_url ? u.clone_url.replace(/\.git$/, "") : (u.repo ? (u.repo.startsWith("https://") ? u.repo : `https://github.com/${u.repo}`) : null)) : null;
                    return (
                    <React.Fragment key={i}>
                      {i > 0 && <div style={{ borderTop: `1px solid ${C.divider}` }} />}
                      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 0" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {it.t === "u" ? (<>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: C.text }}>{u.type}</span>
                              <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>워크플로 {u.id}번 노드</span>
                            </div>
                            {(u.repo || u.clone_url) ? (() => {
                              const repoEl = <span style={{ fontFamily: MONO, color: C.point }}>{(u.repo || u.clone_url || "").replace("https://github.com/", "").replace(/\.git$/, "")}</span>;
                              return (<>
                              <div style={{ marginTop: 8, fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                                {u.repoSrc === "prefix" ? <>이 노드를 제공하는 확장으로 {repoEl} 가 추정됩니다.</> : <>이 노드를 제공하는 확장 {repoEl} 가 설치되어 있지 않습니다.</>}
                              </div>
                              <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                                {u.repoSrc === "manager" ? "ComfyUI Manager에서 설치할 수 있습니다." : u.repoSrc === "prefix" ? "설치 전 저장소를 확인해 주세요." : "출처 확인된 저장소입니다."}
                              </div>
                              </>);
                            })() : (
                              <div style={{ marginTop: 8, fontSize: 14, color: C.faint, lineHeight: 1.6 }}>출처 확인 필요. web_search 또는 Manager에서 노드 이름 검색</div>
                            )}
                            {isAdmin && u.install_note && <div style={{ marginTop: 4, fontSize: 14, color: C.faint, lineHeight: 1.6 }}>{u.install_note}</div>}
                          </>) : (<>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.red }}>노드 #{b.id}</span>
                              <span style={{ fontFamily: SANS, fontSize: 13, color: C.red }}>type을 못 읽음</span>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>커스텀 노드 미설치 추정. ComfyUI에서 해당 빨간 노드 이름 확인 필요</div>
                          </>)}
                        </div>
                        {ghUrl && <a className="td-hf td-outline-w" href={ghUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>GitHub ↗</a>}
                      </div>
                    </React.Fragment>);
                  })}
                </div>
                  </div>}
                </div>); })()}

              {/* STEP 2. 모델 맞추기 (Solution 단계 스타일 아코디언, 기본 펼침) */}
              {recipesEnriched.length > 0 && (() => { const sopen = !!open.rn2; const num = hasNodeIssues ? 2 : 1; return (
                <div style={{ paddingTop: 20, paddingBottom: sopen ? 55 : 20, borderTop: hasNodeIssues ? `1px solid ${C.divider}` : "none" }}>
                  <div onClick={() => toggle("rn2")} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 15, background: C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{num}</div>
                    <div style={{ fontSize: 23, fontWeight: 650, color: C.text, lineHeight: 1.2, flex: 1 }}>모델 맞추기</div>
                    <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle("rn2"); }} aria-label="펼치기/접기"
                      style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                      {sopen ? <Minus size={26} strokeWidth={2.25} /> : <Plus size={26} strokeWidth={2.25} />}
                    </button>
                  </div>
                  {sopen && <div style={{ paddingLeft: 44, marginTop: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {recipesEnriched.map((r, ri) => (
                  <div key={`${r.type}-${r.id}`} style={{ paddingTop: ri > 0 ? 32 : 0, borderTop: ri > 0 ? `1px solid ${C.divider}` : "none" }}>
                    {/* 카드 헤더 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                      <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: C.text }}>{r.type}</span>
                      <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>#{r.id}</span>
                      {r.tab && <span style={{ fontFamily: SANS, fontSize: 13, color: C.violet }}>[탭: {r.tab}]</span>}
                      {r.sub && <span style={{ fontFamily: SANS, fontSize: 13, color: C.violet }}>[서브그래프]</span>}
                      {isAdmin && r.__offset_warning && <span style={{ fontFamily: SANS, fontSize: 13, color: C.amber }}>⚠ offset 보정됨</span>}
                    </div>
                    {/* 슬롯 표 */}
                    <div style={{ borderTop: `1px solid ${C.line}` }}>
                      <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr) 110px", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                        {["#", "슬롯", "현재 값", "폴더", "다운로드"].map((h) => <span key={h} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.faint }}>{h}</span>)}
                      </div>
                      {r.slots.map((s, si) => (
                        <div key={si}>
                          <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr) 110px", gap: 10, padding: "12px 0", alignItems: "center", borderTop: si > 0 ? `1px solid ${C.divider}` : "none", opacity: hasRedInput && s.missing === false ? 0.45 : 1 }}>
                            <span style={{ fontFamily: MONO, fontSize: 14, color: C.faint }}>{si + 1}</span>
                            <span style={{ fontFamily: MONO, fontSize: 14, color: C.dim, overflowWrap: "anywhere" }}>{s.slot}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: MONO, fontSize: 14, color: s.quantBad ? C.red : C.text, overflowWrap: "anywhere", lineHeight: 1.4 }}>{s.value}</div>
                              {s.quantBad && <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.red, marginTop: 4 }}>⚠ 이 GPU에서 실행되지 않습니다. GGUF 또는 bf16으로 교체하세요.</div>}
                              {s.quantBad && s.ggufAlt?.alternatives && s.ggufAlt.alternatives.map((a, ai) => (
                                <div key={ai} style={{ fontFamily: SANS, fontSize: 13, color: C.point, marginTop: 3, lineHeight: 1.5, paddingLeft: 10 }}>
                                  대체 파일: <span style={{ fontFamily: MONO }}>{a.name}</span> · {a.folder}
                                  {a.url && <> · <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: C.point, fontWeight: 700, textDecoration: "none" }}>다운로드</a></>}
                                  {a.note && <span style={{ color: C.faint, fontSize: 13 }}> ({a.note})</span>}
                                </div>
                              ))}
                              {s.quantBad && s.ggufAlt?.pending && (
                                <div style={{ fontFamily: SANS, fontSize: 13, color: C.faint, marginTop: 3, paddingLeft: 10 }}>대체 GGUF: 확인 필요</div>
                              )}
                              {hasRedInput && s.missing === true && <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.red, marginTop: 4 }}>🔴 실제 누락</div>}
                              {hasRedInput && s.missing === false && <div style={{ fontFamily: SANS, fontSize: 13, color: C.faint, marginTop: 4 }}>있음(추정)</div>}
                              {s.authorRecommend && (
                                <div style={{ marginTop: 4, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
                                  제작자 권장: <span style={{ fontFamily: MONO, color: C.point }}>{s.authorRecommend.name}</span> · <span style={{ color: C.point }}>{s.authorRecommend.directory}</span>
                                  {s.authorRecommend.url && s.authorRecommend.url !== "확인 필요" && (
                                    <> · <a href={s.authorRecommend.url} target="_blank" rel="noopener noreferrer" style={{ color: C.point, fontSize: 13 }}>다운로드</a></>
                                  )}
                                </div>
                              )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: MONO, fontSize: 14, color: s.folder === "확인 필요" ? C.red : C.point, overflowWrap: "anywhere", lineHeight: 1.4 }}>{s.folder}</div>
                              {s.src && s.src !== "rule" && s.src !== "none" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>{s.src}</span>}
                              {s.src === "none" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.red }}>폴더 확인 필요</span>}
                            </div>
                            <div>
                              {s.url && s.url !== "확인 필요" ? (
                                <a className="td-hf" href={s.url} target="_blank" rel="noopener noreferrer">다운로드</a>
                              ) : (
                                <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>확인 필요</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* 고급: 이미 받은 것 빼고 보기. 비표시(재설계 후 복원 예정) */}
              {false && <div style={{ marginTop: 24 }}>
                <div onClick={() => toggle("adv")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "10px 0" }}>
                  <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.dim }}>{open.adv ? "▾" : "▸"} 이미 받은 것 빼고 보기</span>
                  <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>(고급 · 선택)</span>
                </div>
                {open.adv && (<>
                  {/* 폴더 스캔 명령 생성기 */}
                  {usedFolders.length > 0 && (
                    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px", marginTop: 8, marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: C.dim, marginBottom: 4 }}>폴더 스캔 명령 만들기</div>
                      <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.5, marginBottom: 10 }}>모델 루트 경로를 넣으면, 이 워크플로가 쓰는 폴더만 스캔하는 명령을 만들어 줍니다. 결과를 아래 칸에 붙여넣으세요.</div>
                      <input value={scanRoot} onChange={(e) => setScanRoot(e.target.value)} spellCheck={false}
                        placeholder={"Windows 예: N:\\ComfyUI_models   ·   Mac 예: ~/ComfyUI/models"}
                        style={{ width: "100%", boxSizing: "border-box", background: C.bg, color: C.text,
                          border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", fontFamily: MONO, fontSize: 13, outline: "none", marginBottom: 10 }} />
                      {(() => {
                        const root = scanRoot.trim();
                        const subs = usedFolders.map(f => f.replace(/^models\//, ""));
                        const winRoot = root ? root.replace(/\/+$/, "").replace(/\\+$/, "") : "<모델루트>";
                        const macRoot = root ? root.replace(/\/+$/, "").replace(/\\+$/, "") : "<모델루트>";
                        const winCmd = "dir /b " + subs.map(s => `"${winRoot}\\${s.replace(/\//g, "\\")}"`).join(" ");
                        const macCmd = "ls " + subs.map(s => `"${macRoot}/${s}"`).join(" ");
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {[{ label: "Windows", cmd: winCmd, key: "scanwin" }, { label: "Mac / Linux", cmd: macCmd, key: "scanmac" }].map(({ label, cmd, key }) => (
                              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, color: C.faint, flexShrink: 0, minWidth: 70 }}>{label}:</span>
                                <code style={{ fontFamily: MONO, fontSize: 13, color: root ? C.text : C.faint, flex: 1, overflowWrap: "anywhere", lineHeight: 1.5 }}>{cmd}</code>
                                <button className="td-copy" onClick={() => copy(cmd, key)} title="복사"
                                  style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                                  {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px" }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: C.dim, marginBottom: 6 }}>이미 가진 파일 제외</div>
                      <textarea value={missingText} onChange={(e) => setMissingText(e.target.value)} spellCheck={false}
                        placeholder={"받을 필요 없는(이미 가진) 파일명을\n한 줄에 하나씩. 모르면 비워두세요."}
                        style={{ width: "100%", minHeight: 56, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text,
                          border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontFamily: MONO, fontSize: 13, lineHeight: 1.6, outline: "none" }} />
                    </div>
                    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 18px" }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: C.dim, marginBottom: 6 }}>내 폴더에 있는 것</div>
                      <textarea value={dirText} onChange={(e) => setDirText(e.target.value)} spellCheck={false}
                        placeholder={"위 명령 결과를 붙여넣기.\n비워도 됩니다."}
                        style={{ width: "100%", minHeight: 56, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text,
                          border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontFamily: MONO, fontSize: 13, lineHeight: 1.6, outline: "none" }} />
                    </div>
                  </div>
                  {hasRedInput && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: missingCount > 0 ? C.red : C.green, marginTop: 12, lineHeight: 1.5 }}>
                      {missingCount > 0
                        ? `🔴 표시된 ${missingCount}개가 실제로 없는 것입니다`
                        : haveFromDir ? "폴더 목록의 파일이 모든 슬롯과 매칭됩니다. 다 있는 상태" : "붙여넣은 파일명과 매칭되는 슬롯이 없습니다. 파일명을 확인하세요"}
                    </div>
                  )}
                </>)}
              </div>}
                  </div>}
                </div>); })()}
              </div>
            </div>);
          })()}

          {/* Solution. 위 Summary와의 구분선 제거(Summary 박스의 borderBottom을 없앰) */}
          {rx.length > 0 && (
            <div style={{ marginTop: 29, paddingBottom: 48 }}>
              <SectionTitle>Install Script</SectionTitle>
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 34px", overflow: "hidden" }}>
                {rx.map((step, i) => {
                  const sk = `s${i}`;
                  const sopen = !!open[sk]; // s0는 기본 펼침(useState 초기값)
                  return (
                  <div key={step.key} style={{ paddingTop: 20, paddingBottom: sopen ? 55 : 20, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                    {/* 번호(동그라미) + 제목 + 펼침 토글. 수직 중앙정렬 */}
                    <div onClick={() => toggle(sk)} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 15, background: step.severity === "high" ? C.red : C.point, color: step.severity === "high" ? "#fff" : INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ fontSize: 23, fontWeight: 650, color: step.severity === "high" ? C.red : C.text, lineHeight: 1.2, flex: 1 }}>{step.title}</div>
                      <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle(sk); }} aria-label="펼치기/접기"
                        style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                        {sopen ? <Minus size={26} strokeWidth={2.25} /> : <Plus size={26} strokeWidth={2.25} />}
                      </button>
                    </div>
                    {sopen && <div style={{ paddingLeft: 44, marginTop: 8 }}>
                      {step.key !== "install" && <div style={{ fontSize: 18, color: C.dim, lineHeight: 1.5 }}>{step.desc}</div>}
                      {step.key === "install" && step.command ? (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 18, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>이 노드들을 ComfyUI custom_nodes 폴더에 설치하세요. 해당 폴더에서 git clone (또는 Manager의 Git URL 설치).</div>

                          {/* custom_nodes 경로 안내. OS/설치유형별 */}
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>custom_nodes 폴더 찾기</div>
                          <div style={{ fontSize: 13, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>내 설치 유형에 맞는 경로를 탐색기/터미널 주소창에 붙여넣으세요.</div>
                          <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 12px", fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
                            {[
                              { os: "Windows", label: "Desktop 앱", path: "%LOCALAPPDATA%\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\custom_nodes" },
                              { os: "Windows", label: "Portable/일반", path: "ComfyUI 설치폴더\\ComfyUI\\custom_nodes" },
                              { os: "macOS/Linux", label: "일반 설치", path: "~/ComfyUI/custom_nodes" },
                            ].map((p, pi) => (
                              <div key={`${p.os}-${p.label}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, paddingTop: pi > 0 ? 8 : 6, marginTop: pi > 0 ? 8 : 6, borderTop: pi > 0 ? `1px solid ${C.divider}` : "none" }}>
                                <span style={{ fontSize: 13, color: C.faint, flexShrink: 0, minWidth: 110 }}>{p.os} · {p.label}:</span>
                                <code style={{ fontFamily: MONO, fontSize: 13, color: C.text, overflowWrap: "anywhere", flex: 1, minWidth: 0 }}>{p.path}</code>
                                <button className="td-copy" onClick={() => copy(p.path, `cn-${p.os}-${p.label}`)} title="복사" style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                                  {copiedKey === `cn-${p.os}-${p.label}` ? <Check size={13} /> : <Copy size={13} />}
                                </button>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: 8, fontSize: 14, color: C.dim, lineHeight: 1.5 }}>※ macOS/Linux Desktop 앱은 설치 경로가 다를 수 있습니다. 앱 설정에서 ComfyUI 경로를 확인하세요.</div>

                          {/* 방법 A. 직접 */}
                          <div style={{ background: C.surfaceHi, borderRadius: 12, padding: "14px 18px", marginTop: 30, marginBottom: 12 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.point, marginBottom: 8 }}>방법 A. 직접</div>
                            <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>custom_nodes 폴더에서 우클릭해 Git Bash Here(또는 터미널)를 열고, 아래 명령을 붙여넣으세요:</div>
                            <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", position: "relative" }}>
                              <button className="td-copy" onClick={() => copy(step.command, step.key)} title="전체 복사" style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", color: C.point, padding: 4, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                                {copiedKey === step.key ? <Check size={16} /> : <Copy size={16} />}</button>
                              <pre style={{ margin: 0, fontFamily: MONO, fontSize: 13, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7, paddingRight: 32 }}>{step.command}</pre>
                            </div>
                            {step.warn && <div style={{ marginTop: 7, fontSize: 13, color: C.amber, lineHeight: 1.45 }}>⚠ {step.warn}</div>}
                          </div>

                          {/* 방법 B. 자동 스크립트 */}
                          <div style={{ background: C.surfaceHi, borderRadius: 12, padding: "14px 18px" }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.point, marginBottom: 8 }}>방법 B. 자동 스크립트</div>
                            <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, marginBottom: 18 }}>아래 스크립트를 custom_nodes 폴더에 넣고 실행하면 노드팩이 일괄 설치됩니다.</div>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                              <button className="td-outline" onClick={() => downloadText("install.bat", buildInstallScript(report, "bat"))}
                                style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontFamily: SANS, fontWeight: 600, cursor: "pointer" }}>
                                <Download size={14} /> install.bat (Windows)</button>
                              <button className="td-outline" onClick={() => downloadText("install.sh", buildInstallScript(report, "sh"))}
                                style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontFamily: SANS, fontWeight: 600, cursor: "pointer" }}>
                                <Download size={14} /> install.sh (Mac/Linux)</button>
                            </div>
                            <div style={{ marginTop: 8, fontSize: 13, color: C.faint, lineHeight: 1.5, textAlign: "center" }}>※ 초보자는 이 방법 권장. 반드시 custom_nodes 폴더 안에서 실행하세요.</div>
                            <div style={{ marginTop: 20, fontSize: 13, color: C.dim, lineHeight: 1.65, borderTop: `1px solid ${C.divider}`, paddingTop: 10 }}>
                              <div style={{ fontWeight: 650, color: C.text, marginBottom: 4 }}>설치 확인하는 법</div>
                              <div>· 실행하면 터미널에 "Cloning into …" 또는 "Successfully installed" 메시지가 뜹니다. 에러 시 빨간 글씨가 나옵니다.</div>
                              <div>· 가장 확실한 확인: ComfyUI를 완전히 재시작한 뒤 워크플로를 다시 로드해서 빨간 노드가 사라졌는지 보세요. 빨간 노드가 없어졌으면 설치 성공.</div>
                              <div style={{ color: C.faint }}>· 설치했는데도 빨간 노드가 남아 있으면, custom_nodes 폴더 안에 해당 노드 폴더가 실제로 생겼는지 확인하세요.</div>
                            </div>
                          </div>

                          {step.installNotes && (
                            <div style={{ marginTop: 12, background: "rgba(239,83,80,0.06)", border: `1px solid ${C.red}33`, borderRadius: 10, padding: "12px 16px" }}>
                              <div style={{ fontSize: 13, fontWeight: 650, color: C.red, marginBottom: 6 }}>설치 후 주의</div>
                              {step.installNotes.map((n, ni) => (
                                <div key={ni} style={{ fontSize: 13, color: C.redMuted, lineHeight: 1.6, marginTop: ni > 0 ? 6 : 0 }}>
                                  <span style={{ fontFamily: MONO, fontWeight: 600, color: C.text }}>{n.file}</span>. {n.desc}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (<>
                      {step.command && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", position: "relative" }}>
                            <button className="td-copy" onClick={() => copy(step.command, step.key)} title="전체 복사" style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", color: C.point, padding: 4, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                              {copiedKey === step.key ? <Check size={16} /> : <Copy size={16} />}</button>
                            <pre style={{ margin: 0, fontFamily: MONO, fontSize: 13, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7, paddingRight: 32 }}>{step.command}</pre>
                          </div>
                          {step.warn && <div style={{ marginTop: 7, fontSize: 13, color: C.amber, lineHeight: 1.45 }}>⚠ {step.warn}</div>}
                        </div>
                      )}
                      </>)}
                      {step.models && (
                        <div style={{ marginTop: 11 }}>
                          {(() => {
                            const need = step.models.filter((m) => !haveModels.has(m.file)).length;
                            const haveN = step.models.length - need;
                            return need === 0
                              ? <div style={{ fontSize: 13, fontWeight: 700, color: C.green, background: "rgba(193,191,186,0.08)", border: `1px solid ${C.green}55`, borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>✓ 필요한 모델이 다 있습니다 (받아야 할 후보 없음). PC 폴더에서 한 번 더 확인하세요.</div>
                              : <div style={{ fontSize: 13, color: C.dim, marginBottom: 10 }}>받아야 할 후보 <b style={{ color: C.point }}>{need}개</b>{haveN ? ` · 이미 있음 ${haveN}개` : ""}</div>;
                          })()}
                          <div style={{ fontSize: 13, color: C.faint, marginBottom: 10, lineHeight: 1.5 }}>이미 받아 둔 파일은 '이미 있으면 체크 ✓'를 눌러 표시해 두세요. 도구는 PC 안을 확인하지 않습니다.</div>
                          {(() => {
                            // 양자화 비호환 모델 lookup (파일명 → warning+gguf)
                            const qwMap = {};
                            for (const w of quantWarnings(report.models, env.gpu)) qwMap[w.file.toLowerCase()] = w;
                            return (
                          <div style={{ borderTop: `1px solid ${C.divider}` }}>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1.3fr) minmax(0,0.9fr) 110px", gap: 14, padding: "11px 0", borderBottom: `1px solid ${C.divider}` }}>
                              {["받을 파일", "어디에 둘지", "정상 용량", "다운로드"].map((h) => <span key={h} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.faint, letterSpacing: "0.03em", textAlign: h === "다운로드" ? "center" : "left" }}>{h}</span>)}
                            </div>
                            {step.models.map((m, k) => {
                              const live = liveCompat[m.file];
                              const eff = m.compat || live || learnedModel(m.file);
                              const src = eff?.source;
                              const mr = modelResearch[m.file];
                              const dlUrl = directDownloadUrl(eff, m.file, mr, m.noteUrl);
                              const ks = knownModelSize(m.file);
                              const sz = eff?.size_gb ? fmtSize(eff.size_gb) : eff?.size_label || (ks ? fmtSize(ks) : null);
                              const dest = (env.modelRoot && rewritePath(m.file, env.modelRoot)) || m.folder;
                              const al = modelAliasInfo(m.file);
                              const have = haveModels.has(m.file);
                              const qwHit = qwMap[m.file.toLowerCase()];
                              return (<React.Fragment key={k}>
                              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1.3fr) minmax(0,0.9fr) 110px", gap: 14, padding: "13px 0", alignItems: "center", borderTop: k > 0 ? `1px solid ${C.divider}` : "none", opacity: have ? 0.45 : qwHit ? 0.5 : 1 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontFamily: MONO, fontSize: 14, color: qwHit ? C.faint : C.text, overflowWrap: "anywhere", lineHeight: 1.4 }}>{m.file}</div>
                                  {qwHit && <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.red }}>⚠ 이 GPU에선 안 돌 수 있음</span>}
                                  {src && !qwHit && <span style={{ fontFamily: SANS, fontSize: 13, color: src === "curated" ? C.point : src === "learned" ? C.amber : C.green, opacity: src === "curated" ? 1 : 0.7 }}>{src === "curated" ? "큐레이션" : src === "manager_live" ? "Manager(실시간)" : src === "learned" ? "내 적립(미확정)" : "Manager"}</span>}
                                  {m.rename && <div style={{ fontSize: 13, color: C.amber, marginTop: 4, lineHeight: 1.4 }}>⤷ {m.rename}</div>}
                                  {al && <div style={{ fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.4 }}>다른 이름: <span style={{ fontFamily: MONO, color: C.point }}>{al.others.join(", ")}</span></div>}
                                </div>
                                <div style={{ minWidth: 0, fontFamily: MONO, fontSize: 13, color: qwHit ? C.faint : C.point, overflowWrap: "anywhere", lineHeight: 1.45 }}>{dest}</div>
                                <div style={{ minWidth: 0 }}>
                                  {sz ? (
                                    <>
                                      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: qwHit ? C.faint : C.text }}>{sz}</div>
                                      {!qwHit && <div style={{ fontSize: 13, color: C.faint, marginTop: 3, lineHeight: 1.4 }}>받은 뒤 이 용량과 비교. 수 KB/MB로 작으면 깨진 것이니 삭제 후 재다운</div>}
                                    </>
                                  ) : <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>확인 필요</span>}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                                  {have ? (
                                    <button className="td-copy" onClick={() => toggleHave(m.file)} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.green, background: "transparent", border: "none", padding: "4px 6px", cursor: "pointer", whiteSpace: "nowrap" }}>있음 ✓ (취소)</button>
                                  ) : qwHit?.gguf ? (
                                    <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>원본 (이 GPU 비권장)</span>
                                  ) : (
                                    <>
                                      {dlUrl ? (
                                        <>
                                          <a className="td-hf" href={dlUrl} target="_blank" rel="noopener noreferrer">다운로드</a>
                                          {!eff && mr?.result?.found && <button onClick={() => learnModelLink(m.file, mr.result)} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.amber, background: "transparent", border: `1px solid ${C.amber}`, borderRadius: 999, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap" }}>이거 맞았어</button>}
                                          {eff?.source === "learned" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.amber }}>✓ 적립됨</span>}
                                        </>
                                      ) : mr?.loading ? (
                                        <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim }}>검색 중…</span>
                                      ) : (!AI_KEY || mr?.error || (mr?.result && !mr.result.found)) ? (
                                        <a className="td-hf td-outline-w" href={`https://www.google.com/search?q=${encodeURIComponent(m.file + " download")}`} target="_blank" rel="noopener noreferrer">웹에서 검색 ↗</a>
                                      ) : (
                                        <button className="td-hf" onClick={() => researchUnknownModel(m.file)}>찾기</button>
                                      )}
                                      <button className="td-havelink" onClick={() => toggleHave(m.file)} style={{ fontFamily: SANS, fontSize: 13, padding: "4px 6px", whiteSpace: "nowrap" }}>이미 있으면 체크 ✓</button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {/* GGUF 대체 행. 비호환 모델 바로 아래 */}
                              {qwHit?.gguf && (qwHit.gguf.components || []).map((comp) => comp.files.map((gf, gi) => (
                                <div key={`gguf-${k}-${comp.role}-${gi}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1.3fr) minmax(0,0.9fr) 110px", gap: 14, padding: "10px 0", alignItems: "center", background: "rgba(244,255,117,0.04)", borderTop: `1px solid ${C.divider}` }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontFamily: MONO, fontSize: 14, color: C.point, overflowWrap: "anywhere", lineHeight: 1.4 }}>{gf.name}</div>
                                    <span style={{ fontFamily: SANS, fontSize: 13, color: C.point }}>대신 받기 · {comp.role}</span>
                                    {gf.note && <div style={{ fontSize: 13, color: C.dim, marginTop: 2 }}>{gf.note}</div>}
                                  </div>
                                  <div style={{ minWidth: 0, fontFamily: MONO, fontSize: 13, color: C.point, overflowWrap: "anywhere", lineHeight: 1.45 }}>{comp.folder}</div>
                                  <div style={{ minWidth: 0 }}>
                                    {gf.size ? <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.text }}>{gf.size}</div> : <span style={{ fontSize: 13, color: C.faint }}>·</span>}
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "flex-end" }}><a className="td-hf" href={gf.url} target="_blank" rel="noopener noreferrer">다운로드</a></div>
                                </div>
                              )))}
                              </React.Fragment>);
                            })}
                          </div>);
                          })()}
                          <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, marginTop: 12 }}>※ 도구는 PC를 보지 못합니다. 이미 받아둔 모델은 “있음”으로 표시해 건너뛰세요. 표시 안 한 것이 <b style={{ color: C.text }}>받아야 할 후보</b>입니다.</div>
                          {step.integrity && (
                            <div style={{ marginTop: 12, background: "rgba(239,83,80,0.07)", border: `1px solid ${C.red}44`, borderRadius: 10, padding: "11px 16px", fontSize: 13, color: C.redMuted, lineHeight: 1.6 }}>
                              <div style={{ fontWeight: 650, color: C.red, marginBottom: 4 }}>무결성 확인</div>
                              <div style={{ fontSize: 13, lineHeight: 1.6 }}>· 받은 파일 용량을 위 표의 “정상 용량”과 비교. 수 KB/MB로 비정상적으로 작으면 삭제 후 재다운로드</div>
                              <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>· 대용량 다운로드 중 ComfyUI·PC 재부팅 금지. 중단되면 빈 파일이 됨</div>
                              <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>· .safetensors가 비정상적으로 작으면 <span style={{ fontFamily: MONO }}>JSONDecodeError</span> 발생</div>
                            </div>
                          )}
                        </div>
                      )}
                      {step.items && (
                        <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 8 }}>
                          {step.items.map((it, k) => (
                            <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.surfaceHi, borderRadius: 10, padding: "12px 14px" }}>
                              <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 3 }} />
                              {it.file ? (
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 20, fontWeight: 600, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.file}</div>
                                  <div style={{ fontSize: 20, fontWeight: 400, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere", marginTop: 4 }}>{it.desc}</div>
                                  {it.gguf && (
                                    <div style={{ marginTop: 10, background: C.bg, border: `1px solid ${C.point}55`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
                                      <div style={{ fontWeight: 700, color: C.point, marginBottom: 6, fontSize: 14 }}>GGUF 대체 세트 (이 GPU에서 동작)</div>
                                      <div>{it.gguf.note}</div>
                                      {(it.gguf.components || []).map((c, ci) => (
                                        <div key={ci} style={{ marginTop: 9 }}>
                                          <div style={{ fontWeight: 650, color: C.text, fontSize: 13 }}>{c.role} · <span style={{ fontFamily: MONO, color: C.point }}>{c.folder}</span></div>
                                          {c.files.map((f, fi) => (
                                            <div key={fi} style={{ marginTop: 3, paddingLeft: 12, overflowWrap: "anywhere" }}>· <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: C.point }}>{f.name}</a>{f.size ? <span style={{ color: C.faint }}> ({f.size})</span> : ""}{f.note ? <span style={{ color: C.faint }}>. {f.note}</span> : ""}</div>
                                          ))}
                                        </div>
                                      ))}
                                      {it.gguf.node && <div style={{ marginTop: 9 }}>필요 노드: <a href={it.gguf.node.repo} target="_blank" rel="noopener noreferrer" style={{ color: C.point, overflowWrap: "anywhere" }}>{it.gguf.node.name}</a></div>}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ fontSize: 20, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.action}</span>
                              )}</div>))}
                        </div>
                      )}
                    </div>}
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* Findings. 박스 없는 아코디언. 헤더는 BlockHead로 통일. */}
          <div style={{ marginTop: 29, paddingBottom: 48 }}>
            <SectionTitle>Findings</SectionTitle>

            {/* ── 문제 블록: 번호 1,2,3 동적. 펼친 상태로 또렷하게. ── */}
            {(() => { let fnum = 0; return (<>

            {/* 깨진 노드. type이 null인 노드. 있을 때만 표시. 빨간 경고. */}
            {report.broken?.length > 0 && (
            <div style={{ borderTop: "none", paddingTop: 0 }}>
              <BlockHead num="!" label="깨진 노드" count={report.broken.length} open={open.fb} onToggle={() => toggle("fb")}
                role="type이 없는(null) 노드입니다. 해당 커스텀 노드가 설치되지 않으면 워크플로 실행이 불가합니다." />
              <div style={{ marginTop: open.fb ? 27 : 0, paddingBottom: open.fb ? 31 : 31 }}>{open.fb && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {report.broken.map((b, i) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                      <CircleAlert size={16} color={C.red} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: C.red, lineHeight: 1.5 }}>이 노드는 설치되지 않으면 워크플로 실행 불가 (노드 #{b.id}, type=null)</span>
                    </div>))}
                </div>
              )}</div>
            </div>)}

            {report.anomalous?.length > 0 && (() => { fnum++; return (
            <div style={{ borderTop: report.broken?.length ? `1px solid ${C.divider}` : "none", paddingTop: report.broken?.length ? 27 : 0 }}>
              <BlockHead num={String(fnum)} label="정체 미상 노드" count={report.anomalous.length} open={open.fa} onToggle={() => toggle("fa")}
                role={`이 워크플로에는 이름을 확인할 수 없는 노드가 ${report.anomalous.length}개 있습니다. 도구가 출처를 찾을 수 없어 ComfyUI 화면에서 해당 노드(빨간 테두리)를 직접 확인해야 합니다.`} />
              <div style={{ marginTop: open.fa ? 27 : 0, paddingBottom: open.fa ? 31 : 31 }}>{open.fa && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {report.anomalous.map((a, i) => (
                    <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                      <CircleAlert size={16} color={C.amber} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 14, color: C.text, lineHeight: 1.5, overflowWrap: "anywhere" }}>노드 #{a.id}. ComfyUI 화면에서 빨간 테두리로 표시된 노드를 확인하세요.</span>
                    </div>))}
                </div>
              )}</div>
            </div>); })()}

            {/* 패키지 · 버전. 간격 규칙 동일(상단 60 / 하단 60) */}
            {(() => { fnum++; return (
            <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 27 }}>
              <BlockHead num={String(fnum)} label="패키지 · 버전" count={report.packs.length} open={open.f2} onToggle={() => toggle("f2")}
                role="이 워크플로가 쓰는 노드팩과 기록된 버전입니다. 처방 1단계(설치)에 들어갈 저장소의 근거입니다." />
              <div style={{ marginTop: open.f2 ? 27 : 0, paddingBottom: open.f2 ? 31 : 31 }}>{open.f2 && (<>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {report.packs.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 18, paddingTop: i > 0 ? 18 : 0, marginTop: i > 0 ? 18 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                      {/* 좌: 항상 2행 — 1행 팩명(+버전 충돌), 2행 브랜치+repo(ellipsis). 폭 부족해도 겹침 0 */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: "1 1 auto" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <ChevronRight size={16} color={C.amber} style={{ flexShrink: 0 }} />
                            <span style={{ fontFamily: MONO, fontSize: 18, color: p.isCore ? C.dim : C.text, overflowWrap: "anywhere" }}>{p.id}{p.isCore && <span style={{ color: C.faint, fontSize: 13 }}> · 내장</span>}</span>
                          </div>
                          {p.conflict && <span style={{ fontSize: 13, fontWeight: 700, color: C.red, flexShrink: 0, whiteSpace: "nowrap" }}>버전 충돌</span>}
                        </div>
                        {p.repo && <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, paddingLeft: 24 }}>
                          <GitBranch size={13} color={C.green} style={{ flexShrink: 0, opacity: 0.6 }} /><span title={p.repo} style={{ fontFamily: MONO, fontSize: 13, color: C.green, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.repo}</span></div>}
                      </div>
                      {/* 중앙~우측: 버전 칩 그룹. 남는 폭 안에서만 wrap(maxWidth), N종 컬럼 침범 불가 */}
                      {p.vers.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 300, flexShrink: 1, minWidth: 0 }}>
                          {p.vers.map((v, j) => {
                            const isHash = /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v);
                            return (
                            <span key={j} title={isHash ? `git 커밋 ${v}` : `릴리스 버전 ${v}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 13, color: p.conflict ? C.red : C.dim,
                              background: p.conflict ? "rgba(239,83,80,0.1)" : C.surfaceHi, border: `1px solid ${p.conflict ? C.red + "44" : C.line}`, borderRadius: 5, padding: "2px 8px" }}>
                              {isHash && <span style={{ fontSize: 13, color: C.faint }}>commit</span>}
                              {v}
                            </span>);
                          })}
                        </div>
                      )}
                      {/* 우: N종 — 고정 폭 컬럼(flex none, 우측 정렬). 칩 그룹이 침범 불가 */}
                      <span style={{ flex: "none", width: 40, textAlign: "right", fontSize: 13, color: C.faint }}>{p.nodeTypes.length}종</span>
                    </div>))}
                </div>
                {/* 점버전 설명 + 한 저장소 안내. 한 묶음 `-` 개조식. gap 0 + 줄간격만으로 붙임(알트엔터처럼). 위 여백 2배(36) + 좌측 들여쓰기(indent)로 탭 들어간 느낌. */}
                {(report.packs.some((p) => p.conflict) || report.packs.some((p) => p.vers.some((v) => /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v))) || report.sameRepo.length > 0) && (
                  <div style={{ marginTop: 36, paddingTop: 36, paddingLeft: 24, borderTop: `1px solid ${C.divider}` }}>
                    {report.packs.filter((p) => p.conflict).map((p) => {
                      const hasCommit = p.vers.some((v) => /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v));
                      return (
                      <div key={`cf-${p.id}`} style={{ display: "flex", gap: 7, fontSize: 13, lineHeight: 1.6, color: C.dim, marginBottom: 6 }}>
                        <span style={{ color: C.red, flexShrink: 0 }}>-</span>
                        <span><b style={{ color: C.text }}>{p.id}</b> 버전 충돌. {hasCommit ? "재현이 목적이면 기록된 커밋으로 git checkout, 아니면 최신 한 버전으로 통일 설치하세요." : "최신 한 버전으로 통일해 재설치하세요."}</span>
                      </div>);
                    })}
                    {report.packs.some((p) => p.vers.some((v) => /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v))) && (
                      <div style={{ display: "flex", gap: 7, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
                        <span style={{ color: C.green, flexShrink: 0 }}>-</span>
                        <span>점 버전(<span style={{ fontFamily: MONO, color: C.text }}>1.4.5</span>)은 정식 릴리스 태그, <span style={{ fontFamily: MONO, color: C.faint }}>commit</span> 표시(<span style={{ fontFamily: MONO, color: C.text }}>a6645ed…</span>)는 특정 git 커밋에서 설치한 것입니다. 한 pack에 둘이 섞이면 재현 시 그 커밋을 checkout 해야 할 수 있어 <span style={{ color: C.red }}>버전 충돌</span>로 표시됩니다.</span>
                      </div>
                    )}
                    {report.sameRepo.map((s) => (
                      <div key={s.repo} style={{ display: "flex", gap: 7, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
                        <span style={{ color: C.green, flexShrink: 0 }}>-</span>
                        <span><b style={{ color: C.green }}>{s.ids.join(" + ")}</b> 는 모두 <span style={{ fontFamily: MONO, color: C.green }}>{s.repo}</span> 하나에서 나옵니다. 한 번만 설치하면 됩니다.</span>
                      </div>))}
                  </div>)}
              </>)}</div>
            </div>); })()}

            {(() => { fnum++; return (
            <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 27 }}>
              <BlockHead num={String(fnum)} label="전체 현황" count={`모델 ${report.models.length} · 비활성 ${report.muted.length}`} open={open.inv} onToggle={() => toggle("inv")}
                role="이 워크플로가 참조하는 모델·자산 전체와 비활성(bypass/mute) 노드입니다." />
              <div style={{ marginTop: open.inv ? 27 : 0 }}>{open.inv && (<div className="td-fade">
              <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.dim }}>모델 · 자산 인벤토리 <span style={{ color: C.faint, fontWeight: 400 }}>· {report.models.length}개</span></div>
              <div style={{ fontSize: 13, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>참조 모델·자산 전체(VRAM·출처 포함). 실제 받기는 위 Solution '받아야 할 모델' 표에서.</div>
              <div style={{ marginTop: 16 }}>{(
                report.models.length === 0 ? <Empty text="참조된 모델 파일을 찾지 못했습니다." /> : (() => {
                  const confirmed = [];
                  const unconfirmed = [];
                  for (const m of report.models) {
                    const eff = m.compat || liveCompat[m.file] || learnedModel(m.file);
                    if (eff) confirmed.push(m);
                    else unconfirmed.push(m);
                  }
                  const renderCard = (m, i) => {
                    const live = liveCompat[m.file];
                    const eff = m.compat || live || learnedModel(m.file);
                    const src = eff?.source;
                    const mr = modelResearch[m.file];
                    const dlUrl = directDownloadUrl(eff, m.file, mr, m.noteUrl);
                    const isWeight = WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e));
                    return (
                    <div key={i} style={{ minHeight: 150, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                      <span style={{ fontFamily: MONO, fontSize: 18, color: C.text, overflowWrap: "anywhere", lineHeight: 1.35 }}>{m.file}</span>
                      <span style={{ fontFamily: SANS, fontSize: 14, color: m.folder === "확인 필요" ? C.faint : C.point, opacity: 1, marginTop: 8, lineHeight: 1.4 }}>{m.folder}</span>
                      {env.modelRoot && rewritePath(m.file, env.modelRoot) && <span style={{ fontFamily: MONO, fontSize: 13, color: C.point, opacity: 0.7, marginTop: 4 }}>내 경로: {rewritePath(m.file, env.modelRoot)}</span>}
                      {(() => { const ks = knownModelSize(m.file); const sz = eff?.size_gb ? fmtSize(eff.size_gb) : eff?.size_label || (ks ? fmtSize(ks) : null); return (eff?.vram_gb || sz) ? <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.3 }}>{eff?.vram_gb ? `VRAM ${eff.vram_gb} GB` : ""}{eff?.vram_gb && sz ? " · " : ""}{sz ? `정상 ${sz}` : ""}</span> : null; })()}
                      {!eff?.size_gb && !eff?.size_label && !knownModelSize(m.file) && WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)) && <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint, marginTop: 4 }}>용량 확인 필요</span>}
                      {m.rename && <span style={{ fontSize: 13, color: C.amber, marginTop: 7, lineHeight: 1.4 }}>⤷ {m.rename}</span>}
                      {(() => { const al = modelAliasInfo(m.file); return al ? <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.4 }}>다른 이름으로 이미 있을 수 있음: <span style={{ fontFamily: MONO, color: C.point }}>{al.others.join(", ")}</span></span> : null; })()}
                      {m.origin && <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, opacity: 0.7, marginTop: 4 }}>{m.origin}</span>}
                      {src && <span style={{ fontFamily: SANS, fontSize: 13, color: src === "curated" ? C.point : src === "learned" ? C.amber : C.green, opacity: src === "curated" ? 1 : 0.7, marginTop: 5 }}>{src === "curated" ? "큐레이션" : src === "manager_live" ? "Manager(실시간)" : src === "learned" ? "내 적립(미확정)" : "Manager"}</span>}
                      {dlUrl ? (
                        <>
                          <a className="td-hf-sm" href={dlUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 14 }}>다운로드</a>
                          {!eff && mr?.result?.found && <button onClick={() => learnModelLink(m.file, mr.result)} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.amber, background: "transparent", border: `1px solid ${C.amber}`, borderRadius: 999, padding: "5px 0", width: 280, maxWidth: "100%", cursor: "pointer", marginTop: 8 }}>이거 맞았어 (적립)</button>}
                          {eff?.source === "learned" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.amber, marginTop: 6 }}>✓ 적립됨 (미확정)</span>}
                        </>
                      ) : !isWeight ? null : mr?.loading ? (
                        <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 14 }}>검색 중…</span>
                      ) : (!AI_KEY || mr?.error || (mr?.result && !mr.result.found)) ? (
                        <a className="td-hf-sm td-outline-w" href={`https://www.google.com/search?q=${encodeURIComponent(m.file + " download")}`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 14 }}>웹에서 검색 ↗</a>
                      ) : (
                        <button className="td-hf-sm" onClick={() => researchUnknownModel(m.file)} style={{ marginTop: 14 }}>다운로드 링크 찾기</button>
                      )}
                      {mr?.error && <span style={{ fontFamily: SANS, fontSize: 13, color: C.amber, marginTop: 10 }}>조사 실패</span>}
                    </div>);
                  };
                  return (<>
                    {confirmed.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                        {confirmed.map((m, i) => renderCard(m, i))}
                      </div>
                    )}
                    {unconfirmed.length > 0 && (
                      <div style={{ marginTop: confirmed.length ? 16 : 0 }}>
                        <button onClick={() => toggle("unc")} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "8px 0", color: C.faint, fontFamily: SANS, fontSize: 13, fontWeight: 600 }}>
                          {open.unc ? <Minus size={14} /> : <Plus size={14} />}
                          <span>확인 필요 {unconfirmed.length}개</span>
                        </button>
                        {open.unc && (
                          <div className="td-fade" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 8 }}>
                            {unconfirmed.map((m, i) => renderCard(m, confirmed.length + i))}
                          </div>
                        )}
                      </div>
                    )}
                  </>);
                })()
              )}</div>

              <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.dim, marginTop: 36, paddingTop: 28, borderTop: `1px solid ${C.divider}` }}>비활성 노드 <span style={{ color: C.faint, fontWeight: 400 }}>· {report.muted.length}개</span></div>
              <div style={{ fontSize: 13, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>꺼졌거나(muted) 우회된(bypass) 노드입니다. 의도한 게 아니라면 점검 대상.</div>
              <div style={{ marginTop: 16 }}>{(
                report.muted.length === 0 ? <Empty text="muted/bypass된 노드가 없습니다." /> : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {report.muted.map((m, i) => {
                      const brk = report.bypassBreaks.find((b) => String(b.id) === String(m.id));
                      const ign = isIgnorableNode(m.type);
                      return (
                      <div key={m.id} style={{ paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <ChevronRight size={16} color={ign ? C.faint : C.amber} style={{ flexShrink: 0 }} /><span style={{ fontFamily: MONO, fontSize: 18, color: ign ? C.faint : C.text, overflowWrap: "anywhere" }}>{m.type}</span>{ign && <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint, flexShrink: 0 }}>· 안 써도 됨</span>}</div>
                          <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint, flexShrink: 0 }}>{m.mode === 4 ? "bypass" : "muted"}</span>
                        </div>
                        {brk && <div style={{ marginTop: 6, paddingLeft: 24, fontSize: 13, color: C.amber, lineHeight: 1.45 }}>⚠ 이 노드가 {m.mode === 4 ? "bypass" : "muted"}라 뒤 노드{brk.targets.length ? ` (${brk.targets.join(", ")})` : ""} 입력이 끊길 수 있습니다.</div>}
                      </div>);
                    })}
                  </div>)
              )}</div>
              {report.ignorable.length > 0 && (
                <div style={{ marginTop: 20, fontSize: 13, color: C.faint, lineHeight: 1.5 }}>
                  import 경고 무시 가능: <span style={{ fontFamily: MONO, color: C.dim }}>{report.ignorable.join(", ")}</span>. 이 노드를 안 쓰면 시작 로그의 빨간 import 에러는 무시해도 됩니다.
                </div>
              )}
              </div>)}
              </div>
            </div>); })()}

            </>); })()}
          </div>

          {/* ───────── Diagnose (에러 로그 → AI 진단 / 브리핑) ─────────
              스토리라인 끝단: 구조 결과(Summary~Inventory)를 다 본 뒤,
              "그래도 막히면 에러 로그도 넣어보세요" → AI 정밀 진단 / LLM 브리핑.
              위에 2px #c1bfba 구분선으로 '다른 영역'임을 명확히 한다. */}
          <div style={{ marginTop: 64, paddingTop: 32, paddingBottom: 48, borderTop: `1px solid ${C.green}` }}>
            <SectionTitle>Diagnose</SectionTitle>

            {/* 에러 로그 입력 박스. Summary 안의 작은 라운딩 박스(MetricBox)와 동일한 색(#28222E), 스트로크 없음 */}
            <div style={{ background: "#28222E", border: "none", borderRadius: 16, padding: "22px 26px", position: "relative", zIndex: 1 }}
              onDragOver={(e) => e.stopPropagation()} onDrop={(e) => e.stopPropagation()}>
              {/* 브리핑 복사 처리 중. 가벼운 딤 + 스피너로 "수집·정리했다"는 액션을 보여준다 */}
              {briefingBusy && (
                <div className="td-fade" style={{ position: "absolute", inset: 0, background: "rgba(32,25,38,0.62)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 11, zIndex: 5 }}>
                  <Loader2 size={18} color={C.point} className="td-spin" />
                  <span style={{ fontSize: 13, color: C.text }}>로그·이미지 수집해 정리하는 중…</span>
                </div>
              )}
              <div onClick={() => toggle("errAcc")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: open.errAcc ? 12 : 0, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18, minWidth: 0 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: C.surfaceHi, display: "grid", placeItems: "center", border: `1px solid ${C.line}`, flexShrink: 0 }}>
                    <Terminal size={19} color={C.point} strokeWidth={1.9} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>실행했는데 에러가 나면: 에러 로그 진단</div>
                    <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>터미널·콘솔의 빨간 에러를 붙여넣으면, 위 구조와 결합해 더 정확히 짚어줍니다.</div>
                  </div>
                </div>
                <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle("errAcc"); }} aria-label="펼치기/접기"
                  style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                  {open.errAcc ? <Minus size={22} strokeWidth={2.25} /> : <Plus size={22} strokeWidth={2.25} />}
                </button>
              </div>
              {open.errAcc && (<>
              <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.6, marginBottom: 12 }}>pytorch·cuda·python 버전 호환성은 각 pack의 requirements.txt 영역이라 JSON만으로는 확인할 수 없습니다. 에러 로그를 넣으면 AI 진단으로 보완합니다.</div>
              <textarea value={errlog} onChange={(e) => setErrlog(e.target.value)} spellCheck={false}
                placeholder={"마지막 Traceback 블록 전체를 붙여넣으세요.\n예) Traceback (most recent call last):\n  File \".../nodes.py\", line 123, in ...\nModuleNotFoundError: No module named 'flash_attn'"}
                style={{ width: "100%", minHeight: 120, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text,
                  border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontFamily: MONO, fontSize: 13, lineHeight: 1.65, outline: "none" }} />

              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input ref={shotRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onShots(e.target.files)} />
                <button className="td-btn" onClick={() => shotRef.current?.click()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 15px", fontFamily: SANS, fontSize: 13, cursor: "pointer" }}>
                  <ImagePlus size={15} /> 캡처 이미지 첨부</button>
                <span style={{ fontSize: 13, color: C.faint }}>긴 로그는 텍스트 붙여넣기가 더 정확합니다. 캡처는 보조용.</span>
              </div>
              {errShots.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {errShots.map((s, i) => (
                    <div key={i} style={{ position: "relative", width: 92, height: 92, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.line}`, background: C.bg }}>
                      <img src={s.url} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      <button onClick={() => removeShot(i)} aria-label="제거"
                        style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 999, background: "rgba(26,21,5,0.72)", border: "none", color: C.point, cursor: "pointer", display: "grid", placeItems: "center", lineHeight: 0 }}>
                        <X size={12} /></button>
                    </div>))}
                </div>
              )}

              {/* 두 갈래 CTA. AI 버튼은 "키가 있는 환경(=로컬 개발)"에서만 노출.
                  배포본엔 키가 없으므로 자동으로 브리핑 복사만 남는다 → 타인이 써도 내 API 비용 0원. */}
              <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
                {AI_KEY && (
                  <button className="td-cta" onClick={doAiDiagnosis} disabled={!errlog.trim() || aiLoading}
                    style={{ width: 280, maxWidth: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
                      borderRadius: 999, padding: "13px 0", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: errlog.trim() && !aiLoading ? "pointer" : "not-allowed", letterSpacing: "-0.01em" }}>
                    {aiLoading ? <><Loader2 size={16} className="td-spin" /> AI 정밀 진단 중…</> : <>AI 정밀 진단 실행</>}</button>
                )}
                <button className="td-btn td-outline" onClick={copyBriefing} disabled={!errlog.trim() && !env.gpu && !env.torch && !env.cuda}
                  style={{ width: 280, maxWidth: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                    borderRadius: 999, padding: "13px 0", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: (errlog.trim() || env.gpu || env.torch || env.cuda) ? "pointer" : "not-allowed", letterSpacing: "-0.01em", opacity: (errlog.trim() || env.gpu || env.torch || env.cuda) ? 1 : 0.4 }}>
                  {copiedKey === "briefing" ? <><Check size={16} /> 복사됨. 내 챗에 붙여넣기</> : <><Copy size={16} /> LLM 분석 프롬프트</>}</button>
              </div>
              {AI_KEY ? (
                <div style={{ marginTop: 11, fontSize: 13, color: C.faint, textAlign: "center", lineHeight: 1.6 }}>
                  <b style={{ color: C.dim }}>AI 정밀 진단</b>: 버튼 한 번으로 바로 진단 (API 사용). &nbsp;·&nbsp; <b style={{ color: C.dim }}>브리핑 복사</b>: 복사해서 직접 쓰는 Claude·Gemini 챗에 붙여넣기 (무료).
                </div>
              ) : (
                <div style={{ marginTop: 11, fontSize: 13, color: C.faint, textAlign: "center", lineHeight: 1.6 }}>
                  <b style={{ color: C.dim }}>브리핑 복사</b>를 누르면 위 구조 분석 + 에러가 한 번에 정리됩니다. 그대로 복사해 자신의 Claude·Gemini 챗에 붙여넣으면 끝. 별도 설정 없이 바로 진단을 받을 수 있습니다.
                </div>
              )}

              {/* 복사 완료 피드백. 무엇을 담았는지 요약. 이미지는 텍스트 클립보드에 못 담기므로 정직하게 안내한다. */}
              {briefingInfo && (
                <div className="td-fade" style={{ marginTop: 12, padding: "11px 14px", background: C.surfaceHi, borderRadius: 10, display: "flex", alignItems: "center", gap: 9, justifyContent: "center", flexWrap: "wrap", textAlign: "center" }}>
                  <Check size={15} color={C.point} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                    구조 분석{briefingInfo.lines > 0 ? ` + 에러 ${briefingInfo.lines}줄` : ""} 정리 완료 · 총 {briefingInfo.chars.toLocaleString()}자 복사됨
                    {briefingInfo.shots > 0 ? <span style={{ color: C.dim }}> · 이미지 {briefingInfo.shots}장은 텍스트에 안 담기니 챗에 따로 첨부하세요</span> : null}
                  </span>
                </div>
              )}
              </>)}
            </div>

            {/* 파일 이름 불일치. "Value not in list" errlog 직접 파싱 (PC에 있는 후보로 교체) */}
            {(() => { const hits = parseValueNotInList(errlog); return hits.length > 0 ? (
              <div className="td-fade" style={{ marginTop: 24 }}>
                <div style={{ background: C.surface, border: `1px solid ${C.point}`, borderRadius: 14, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <CircleAlert size={18} color={C.point} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.point }}>파일 이름 불일치 {hits.length}건. PC에 있는 후보로 교체</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {hits.map((h, i) => (
                      <div key={i} style={{ background: C.surfaceHi, borderRadius: 10, padding: "14px 18px" }}>
                        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>● <span style={{ fontFamily: MONO, color: C.amber }}>{h.widget}</span>: 요구 <span style={{ fontFamily: MONO }}>'{h.required}'</span> 은(는) PC에 없음</div>
                        {h.best ? (
                          <div style={{ fontSize: 14, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>유력 후보(이름이 가장 비슷): <span style={{ fontFamily: MONO, color: C.point, fontWeight: 700 }}>{h.best}</span>. 위젯에서 이걸로 바꿔보세요.</div>
                        ) : (
                          <div style={{ fontSize: 14, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>아래 후보 중 이름이 가장 비슷한 걸 골라 바꾸세요.</div>
                        )}
                        <div style={{ fontSize: 13, color: C.faint, marginTop: 6, lineHeight: 1.6 }}>PC에 있는 후보: {h.candidates.map((c, ci) => <span key={ci} style={{ fontFamily: MONO, color: c === h.best ? C.point : C.faint }}>{ci > 0 ? ", " : ""}{c}</span>)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null; })()}

            {/* 감지된 알려진 문제. errlog 패턴 매칭 (매칭 없으면 미표시) */}
            {(() => { const hits = matchTroubleshootingPatterns(errlog); return hits.length > 0 ? (
              <div className="td-fade" style={{ marginTop: 24 }}>
                <div style={{ background: C.surface, border: `1px solid ${C.red}55`, borderRadius: 14, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <CircleAlert size={18} color={C.red} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.red }}>감지된 알려진 문제 {hits.length}건</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {hits.map((p) => (
                      <div key={p.id} style={{ background: C.surfaceHi, borderRadius: 10, padding: "14px 18px" }}>
                        {p.category && <span style={{ display: "inline-block", fontFamily: SANS, fontSize: 13, fontWeight: 700, color: p.category === "런타임" ? INK : C.faint, background: p.category === "런타임" ? C.amber : "transparent", border: p.category === "런타임" ? "none" : `1px solid ${C.line}`, borderRadius: 5, padding: "2px 7px", marginBottom: 8, letterSpacing: "0.02em" }}>{p.category === "런타임" ? "런타임 · 실행 중" : `${p.category} 단계`}</span>}
                        <div style={{ fontSize: 14, fontWeight: 650, color: C.text, lineHeight: 1.5 }}>{p.symptom}</div>
                        <div style={{ fontSize: 13, color: C.dim, marginTop: 8, lineHeight: 1.6 }}><b style={{ color: C.text }}>원인:</b> {p.cause}</div>
                        <div style={{ fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.6 }}><b style={{ color: C.text }}>해결:</b> {p.fix}</div>
                        <div style={{ fontSize: 13, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>자가확인: {p.check}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null; })()}

            {/* AI 진단 결과. 로딩·에러·결과 모두 이 자리 */}
            {(aiLoading || aiErr || aiResult) && (
              <div className="td-fade" style={{ marginTop: 32 }}>
                {aiLoading && (
                  <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "26px 30px", display: "flex", alignItems: "center", gap: 14 }}>
                    <Loader2 size={20} color={C.point} className="td-spin" />
                    <span style={{ fontSize: 14, color: C.dim }}>이 워크플로의 구조와 에러를 결합해 Claude가 분석 중…</span>
                  </div>
                )}
                {aiErr === "nokey" && (
                  <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 20px", fontSize: 13, color: C.dim, lineHeight: 1.65 }}>
                    AI 정밀 진단은 API 키가 연결된 환경(로컬 개발)에서만 작동합니다. 키 없이 바로 쓰려면 위의 <b style={{ color: C.text }}>LLM 분석 프롬프트</b> 버튼을 눌러 복사한 뒤, 직접 쓰는 Claude·Gemini 챗에 붙여넣으세요.
                  </div>
                )}
                {aiErr && aiErr !== "nokey" && (
                  <div style={{ background: "rgba(239,83,80,0.08)", border: `1px solid ${C.red}55`, borderRadius: 12, padding: "13px 16px", fontSize: 13, color: C.text }}>AI 호출 실패: {aiErr}. 잠시 후 다시 시도하거나, 위의 브리핑 복사로 우회하세요.</div>
                )}
                {aiResult && (
                  <div className="td-fade" style={{ background: C.surface, border: `1.5px solid ${C.point}`, borderRadius: 18, padding: "28px 30px", boxShadow: `0 0 0 4px rgba(244,255,117,0.06)` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: aiResult.severity === "high" ? C.red : INK, background: aiResult.severity === "high" ? "rgba(239,83,80,0.12)" : (aiResult.severity === "mid" ? C.amber : C.faint), borderRadius: 6, padding: "6px 9px", letterSpacing: "0.02em" }}>{aiResult.severity === "high" ? "CRITICAL" : aiResult.severity === "mid" ? "WARNING" : "INFO"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: INK, background: C.point, borderRadius: 6, padding: "6px 9px", letterSpacing: "0.02em" }}>AI 진단</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: C.text, flex: 1, letterSpacing: "-0.01em" }}>{aiResult.title}</span>
                    </div>
                    {aiResult.relatedNode && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surfaceHi, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", marginBottom: 16 }}>
                        <span style={{ fontSize: 13, color: C.faint }}>관련 노드</span>
                        <span style={{ fontFamily: MONO, fontSize: 13, color: C.point }}>{aiResult.relatedNode}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.65, marginBottom: 6 }}>{aiResult.rootCause}</div>
                    {Array.isArray(aiResult.fixes) && aiResult.fixes.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        {aiResult.fixes.map((fx, k) => {
                          const ak = `ai${k}`;
                          const aopen = open[ak] !== undefined ? open[ak] : k === 0;
                          const isObj = fx && typeof fx === "object";
                          const head = isObj ? (fx.step || fx.title || "") : String(fx);
                          const body = isObj ? (fx.detail || fx.desc || "") : "";
                          return (
                          <div key={k} style={{ borderTop: k > 0 ? `1px solid ${C.divider}` : "none" }}>
                            <div onClick={() => toggle(ak)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 0", cursor: body ? "pointer" : "default" }}>
                              <div style={{ width: 30, height: 30, borderRadius: 15, background: C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{k + 1}</div>
                              <span style={{ fontSize: 16, color: C.text, lineHeight: 1.5, flex: 1, fontWeight: aopen && body ? 650 : 400 }}>{head}</span>
                              {body && (
                                <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle(ak); }} aria-label="펼치기/접기"
                                  style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                                  {aopen ? <Minus size={22} strokeWidth={2.25} /> : <Plus size={22} strokeWidth={2.25} />}
                                </button>
                              )}
                            </div>
                            {body && aopen && (
                              <div style={{ paddingLeft: 44, paddingBottom: 18, fontSize: 14, color: C.dim, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{body}</div>
                            )}
                          </div>);
                        })}
                      </div>
                    )}
                    {aiResult.command && (
                      <div style={{ marginTop: 18, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", position: "relative" }}>
                        <button className="td-copy" onClick={() => copy(aiResult.command, "ai-cmd")} title="복사" style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", color: C.point, padding: 4, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                          {copiedKey === "ai-cmd" ? <Check size={16} /> : <Copy size={16} />}</button>
                        <pre style={{ margin: 0, fontFamily: MONO, fontSize: 13, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6, paddingRight: 32 }}>{aiResult.command}</pre>
                      </div>
                    )}
                    <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.divider}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: aiResult.confidence === "high" ? C.green : aiResult.confidence === "mid" ? C.amber : C.red }}>● {aiResult.confidence === "high" ? "확신 높음" : aiResult.confidence === "mid" ? "확신 보통" : "확신 낮음. 검증 권장"}</span>
                      {aiResult.caveat && <span style={{ fontSize: 13, color: C.faint, lineHeight: 1.5 }}>{aiResult.caveat}</span>}
                    </div>
                    <div style={{ marginTop: 14, fontSize: 13, color: C.faint, lineHeight: 1.5 }}>
                      ※ AI가 생성한 진단입니다. 더 깊은 분석이 필요하면 위의 <b style={{ color: C.dim }}>브리핑 복사</b>로 자신의 LLM 챗에서 이어가세요. 명령·다운로드는 실행 전 한 번 확인하세요.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {learned.length > 0 && isAdmin && (
            <div style={{ marginTop: 40, padding: "18px 24px", background: C.surface, border: `1px solid ${C.amber}55`, borderRadius: 16 }}>
              <div onClick={() => toggle("learnedAcc")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>검증 대기 데이터 {learned.length}건 <span style={{ fontSize: 13, fontWeight: 400, color: C.faint }}>· 관리자 전용</span></div>
                <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle("learnedAcc"); }} aria-label="펼치기/접기"
                  style={{ background: "transparent", border: "none", color: C.amber, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                  {open.learnedAcc ? <Minus size={20} strokeWidth={2.25} /> : <Plus size={20} strokeWidth={2.25} />}
                </button>
              </div>
              {open.learnedAcc && (<>
                <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="td-outline" onClick={() => { const s = buildLearnedSnippet(learned); copy(s, "learned"); console.log("[Teardown 적립 스니펫]\n" + s); }} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>{copiedKey === "learned" ? "복사됨 ✓" : "복사 + 콘솔"}</button>
                  <button onClick={() => downloadText("teardown-learned.json", buildLearnedSnippet(learned))} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.point, background: "transparent", border: `1px solid ${C.point}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>내보내기(.json)</button>
                  <button onClick={clearLearned} style={{ fontFamily: SANS, fontSize: 13, color: C.faint, background: "transparent", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>비우기</button>
                </div>
                <div style={{ marginTop: 10, fontSize: 13, color: C.dim, lineHeight: 1.55 }}>LLM 진단 과정에서 확인된 모델 출처입니다. 내용을 검토한 뒤 compatibility.json에 병합하고 커밋하세요. 이 데이터는 이 브라우저에만 저장되며 자동 반영되지 않습니다.</div>
                <pre style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontFamily: MONO, fontSize: 13, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6, maxHeight: 280, overflowY: "auto" }}>{buildLearnedSnippet(learned)}</pre>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {learned.map((x) => (
                    <div key={x.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                      <span style={{ fontFamily: MONO, color: C.dim, overflowWrap: "anywhere" }}>[{x.type}] {x.key}</span>
                      <button onClick={() => removeLearned(x.id)} style={{ background: "transparent", border: "none", color: C.faint, cursor: "pointer", fontSize: 13, flexShrink: 0 }}>삭제</button>
                    </div>
                  ))}
                </div>
              </>)}
            </div>
          )}

          </div>)}
          <div style={{ marginTop: 64, paddingBottom: 32, textAlign: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint, letterSpacing: "0.02em" }}>
              <span style={{ fontSize: "1.2em" }}>©</span> 2026 Comfy-Teardown · Built by Joon Hyung Kim
            </span>
          </div>
            </div>
          </div>
        )}
    </div>
  );
}
