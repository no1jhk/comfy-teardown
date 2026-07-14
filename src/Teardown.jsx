import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload, Boxes, ChevronRight, ChevronUp, GitBranch,
  CircleAlert, Copy, Check, Plus, Minus, Download,
  Terminal, ImagePlus, X, Loader2, FolderOpen, SlidersHorizontal,
} from "lucide-react";
import { LOGO } from "./assets/logo.js";
import compat from "./data/compatibility.json";
import { buildRecipes, groupNodesByRepo } from "./data/redNodeRecipe.js";
import { parseComfyLog, packInstalled, parseValueNotInList, parseMissingNodeType, compareVersion, latestLogSession, extractErrorLines, hasDiskError } from "./logParse.js";
import { normalize, analyze, hfLink } from "./lib/analyzeWorkflow.js";
import { recommend, gpuProfile } from "./lib/modelRecommender.js";
import { matchLabelToNode } from "./lib/parseWorkflowNotes.js";
import { buildModelPlan, downloadTargetFolder } from "./lib/modelPlan.js";
import { parseFolderScan, reconcileInventory, buildScanSnippet, scanInputDiagnosis, isTypeFolder, assembleModelPath, swapDriveLetter } from "./lib/inventoryMatch.js";
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
  bg: "#201926", bgDeep: "#1A1420", surface: "#2A2333", surfaceHi: "#342C3F", line: "#3A3248", evidenceBg: "#372E43", metricBg: "#28222E",
  quiet: "#241D2E",
  divider: "rgba(255,255,255,0.09)",
  text: "#C2BFB9", dim: "#A39BAE", faint: "#76707F", faintDim: "#423E47",
  point: "#F4FF75",
  green: "#C1BFBA", amber: "#C1BFBA", red: "#EF5350", redMuted: "#B59A9B", violet: "#A678E0", memo: "#816E48", memoBright: "#A88F5E",
  // 스크립트 받기 버튼 전 화면 단일 토큰(sand 잠정 확정 · 재조정 여지). 색 변경 시 이 한 곳 수정으로 전 화면(Solution·노드/모델 상세) 동시 반영.
  btnSand: "#D9D8B8",
};
const INK = "#1A1505"; // 노랑 배경 위 텍스트
const SOLUTION_STROKE = `3px solid ${C.btnSand}`; // 솔루션 라운드박스 테두리 3px. 색은 스크립트 버튼과 동일 sand 토큰(C.btnSand) 참조 → 토큰 변경 시 동시 반영. 제거·조정은 이 한 곳.
const DETAIL_ZONE_BOTTOM_OFFSET = 200; // 자세한 진단 경계(점선) 하단 오프셋(px). 짧은 결과에서 라이트존 min-height = calc(100vh - 이 값). 실측 조정용 단일 상수.
const ANCHOR_LINK = { color: C.btnSand, textDecoration: "underline", cursor: "pointer" }; // 앵커 링크 단일 토큰 — 색은 sand 버튼(C.btnSand·노드 한 번에 설치)과 동일 연노랑, 언더라인 유지. 에러 로그 진단·Bypassed 섹션 등 전 화면 동일. 색 변경은 이 한 곳.
const MONO = "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,Menlo,monospace";
const DISPLAY = "'PP Formula','Space Grotesk','Neue Haas Grotesk Display Pro','Pretendard Variable',Inter,sans-serif"; // 제목용 — comfy.org 공식은 PP Formula(유료). 없으면 Space Grotesk로 폴백. 한글 제목은 Pretendard.
const SANS = "'Pretendard Variable',Pretendard,Inter,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const WEIGHT_EXTS = [".ckpt",".safetensors",".pt",".pth",".bin",".gguf",".onnx"];

// 확정 다운로드 직링크만 반환. 검색 URL 떠넘기기 금지 → 못 구하면 null("확인 필요").
// 우선순위: compat/Manager(eff) → web_search 확정 결과 → HF_EXACT 화이트리스트.
function directDownloadUrl(eff, file, research, noteUrl) {
  if (noteUrl) return noteUrl;
  if (eff?.url) return eff.url;
  if (research?.result?.found && research.result.url) return research.result.url;
  const hf = hfLink(file);
  return hf?.exact ? hf.url : null;
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
// 바이트 → 사람 단위(십진). 깨진 파일의 소용량(KB·B)도 표시(fmtSize는 GB<1을 MB로만 내려 0MB로 뭉갬).
function fmtBytes(b) {
  if (typeof b !== "number" || !(b > 0)) return "확인 불가";
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)}GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)}MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)}KB`;
  return `${b}B`;
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
// 0-3: 대체 양자화 안내 문구 조립 + dedupe. alt("GGUF 또는 bf16")에 fp8 시 "bf16" 추가 → "또는 bf16 또는 bf16" 중복 방지.
function altListText(w) {
  const tokens = String(w?.alt || "GGUF").split(/\s*또는\s*/).filter(Boolean);
  if (/fp8/i.test(w?.quant || "")) tokens.push("bf16");
  const seen = new Set(), uniq = [];
  for (const t of tokens) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); uniq.push(t); } }
  return uniq.join(" 또는 ");
}

// node_repo_map.json → class_type exact match index
// troubleshooting_patterns.json → error log keyword matching (OR per pattern)
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
// ── AI 정밀 진단(v1.1) ──────────────────────────────────────────
// VITE_ 접두사 env는 빌드 시 클라이언트 번들에 평문 인라인된다 → 배포본에 키를 넣으면 노출됨.
// 배포 가드: PROD 빌드에선 키를 비워 AI 기능을 끈다(로컬 dev 전용). PROD가 true로 치환되며 키 문자열은 dead-code 제거.
// 배포본 AI는 백엔드 프록시 필요(로드맵 v1.1). 키가 없으면 버튼이 안내문만 띄우고 호출하지 않는다.
const AI_KEY = import.meta.env?.PROD ? "" : (import.meta.env?.VITE_ANTHROPIC_API_KEY || "");
const AI_MODEL = "claude-sonnet-4-5-20250929";

// report(룰 분석 결과)를 LLM에 줄 컨텍스트 문자열로 압축.
function reportToContext(report, env) {
  const packs = report.packs.map((p) => `${p.id}${p.repo ? ` (${p.repo})` : ""} [${p.vers.join(", ") || "ver?"}]${p.conflict ? " ⚠버전충돌" : ""}`);
  const models = report.models.map((m) => `${m.node}: ${m.file} → ${m.folder}`);
  const muted = report.muted.map((m) => `${m.type}(${m.mode === 4 ? "bypass" : "muted"})`);
  const port = report.portability.map((h) => `${h.node}: ${h.value} — ${h.risk}`);
  const lines = [
    `전체 노드: ${report.totalNodes} / 커스텀 pack: ${report.customPackTotal}`,
    `패키지·버전:\n${packs.map((x) => "  - " + x).join("\n") || "  없음"}`,
    `참조 모델·자산:\n${models.map((x) => "  - " + x).join("\n") || "  없음"}`,
    `이식 위험 값:\n${port.map((x) => "  - " + x).join("\n") || "  없음"}`,
    `비활성 노드: ${muted.join(", ") || "없음"}`,
  ];
  if (env && (env.gpu || env.torch || env.cuda || env.vram)) {
    // 결함e: VRAM 병기. 로그 추출 우선, 없으면 gpu_rules 폴백 + "(추정)".
    const prof = gpuProfile(env.gpu, env.vram);
    const vramStr = env.vram ? `${env.vram}GB` : (prof?.vram ? `${prof.vram}GB (추정)` : "?");
    lines.push(`사용자 환경: GPU=${env.gpu || "?"} / VRAM=${vramStr} / torch=${env.torch || "?"} / CUDA=${env.cuda || "?"}`);
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
아래는 사용자가 실행하려는 워크플로우의 구조 분석 결과와, 실행 중 발생한 에러 로그입니다.
이 에러를 **이 워크플로우의 구체적인 노드·모델과 결합해서** 진단하세요. 일반론이 아니라 "당신의 OO 노드가/이 모델이" 식으로 짚어야 합니다.
확신이 없으면 솔직하게 caveat에 적고 confidence를 낮추세요. 없는 URL·파일을 지어내지 마세요.

[워크플로우 구조]
${ctx}

[에러 로그]
${errlog}

각 해결 단계는 충분히 구체적으로 쓰세요. step에는 한 줄 요약(무엇을 할지)을, detail에는 그 단계를 실제로 따라할 수 있는 자세한 설명(어디서·어떻게·왜, 주의점, 대안)을 2~4문장으로 적으세요. 일반론 금지 — 이 워크플로우의 실제 노드·모델·경로를 짚으세요. 단계는 4~7개 권장.

다음 JSON 형식으로만 답하세요. 마크다운·코드펜스 없이 순수 JSON만:
{
  "title": "한 줄 진단 제목 (이 워크플로우 맥락 반영)",
  "severity": "high|mid|low",
  "rootCause": "근본 원인 2~3문장. 워크플로우의 어느 노드·모델과 연결되는지 명시",
  "relatedNode": "관련 노드 타입 (워크플로우에 실제 있는 것, 없으면 빈 문자열)",
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
      title: `GPU 점검 권장 모델 ${qw.length}건`,
      severity: "mid",
      items: qw.map((w) => ({
        file: w.file,
        desc: `${w.quant} 형식은 이 GPU(${GEN_LABEL[w.gen] || w.gen})에서 기본 지원되지 않습니다. 최신 ComfyUI는 변환 경로로 실행될 수 있으나 느리거나 불안정할 수 있습니다. 안정 실행에는 ${altListText(w)} 대체를 권장합니다.`,
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
    items: env.map((h) => ({ action: `${h.node}: attention을 flash_attn에서 sdpa로 변경` })),
  });
  // 끊어진 경로·입력 파일은 단독 처방으로 두지 않는다(대부분 "내 입력 파일을 다시 넣으면 됨").
  // 정보는 Findings "이식 위험 값"에 그대로 표시 — Solution 중복 step 제거.
  return steps;
}

// 진단 결과(report)를 사람이 읽는 Markdown으로 변환 → 복기·기록용 .md 저장
// (의존성 없이 순수 문자열 조립. 노션/GitHub에 그대로 붙여넣기 가능)
// 처방 정보 → OS별 설치 스크립트 문자열. 확정 URL만 실행문, 미확인은 주석. (PRD_v1.1 §2)
function buildInstallScript(report, os, env) {
  const isWin = os === "bat";
  const L = [];
  const cmt = isWin ? "REM" : "#";
  const cnPath = env?.customNodesPath || "";

  L.push(isWin ? "@echo off" : "#!/bin/bash");
  if (isWin) L.push("chcp 65001 >nul"); // 결함4: UTF-8 코드페이지(한글 주석 깨짐 방지)
  L.push(`${cmt} Teardown install script: ${report.source}`);
  L.push(`${cmt} generated: ${new Date().toISOString().slice(0, 10)}`);
  L.push("");
  // 결함5: cd 대상은 로그 추출 custom_nodes 경로만. 없으면 기본 경로 삽입 금지 → 자리표시자 + 경고.
  if (cnPath) {
    L.push(isWin ? `cd /d "${cnPath}"` : `cd "${cnPath}"`);
  } else {
    L.push(`${cmt} WARNING: 로그에서 custom_nodes 경로를 찾지 못했습니다. 아래 경로를 직접 입력하세요.`);
    L.push(isWin ? `cd /d "여기에 내 ComfyUI의 custom_nodes 경로를 입력"` : `cd "여기에 내 ComfyUI의 custom_nodes 경로를 입력"`);
  }
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
    if (u.clone_url) cloneUrls.set(u.clone_url, u.registry === false ? `Manager에 없는 팩 — 직접 설치 (${u.type})` : u.manager_searchable === false ? `Manager 검색 안 됨 (${u.type})` : null);
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
    // #1: 받기.bat과 동일 규칙 — 모델 폴더 입력 시 절대 {입력}\{종류}(어디서 실행해도 고정), 미입력 시 상대 "models\{종류}"(custom_nodes에서 cd ..로 ComfyUI 루트 기준).
    const hasRoot = !!(env?.modelRoot || env?.basePath);
    L.push(`${cmt} === 모델 ${dl.length}개 (${hasRoot ? "입력한 모델 폴더 절대 경로" : "ComfyUI 루트 기준 상대 경로. custom_nodes에서 실행 시 자동으로 상위(루트)로 이동"}) ===`);
    if (!hasRoot) L.push(isWin ? "cd .." : "cd ..");
    L.push(`${cmt} ⚠ 큰 모델 다운로드 중에는 ComfyUI/PC를 재부팅하지 마세요. 끊기면 빈 파일이 됩니다.`);
    L.push(`${cmt} ⚠ 받은 뒤 용량 확인. 수 KB/MB로 작으면 깨진 것이니 삭제 후 재다운로드.`);
    L.push(`${cmt}   (.safetensors가 비정상적으로 작으면 JSONDecodeError 발생)`);
    L.push("");
    for (const m of dl) {
      const info = m.compat;
      const displayFolder = (info && info.folder) || m.folder || "models";
      const targetWin = downloadTargetFolder(env?.modelRoot || env?.basePath, displayFolder); // 절대 or 상대(백슬래시)
      const target = isWin ? targetWin : targetWin.replace(/\\/g, "/");
      const fname = m.file.replace(/\\/g, "/").split("/").pop();
      const ks = knownModelSize(m.file);
      const sizeNote = info?.size_gb ? `정상 약 ${fmtSize(info.size_gb)}` : info?.size_label ? `정상 약 ${info.size_label}` : ks ? `정상 약 ${fmtSize(ks)}` : "용량 확인 필요";
      if (info && info.exact && info.url) {
        L.push(isWin ? `if not exist "${target}" mkdir "${target}"` : `mkdir -p "${target}"`);
        L.push(isWin ? `curl -L -o "${target}\\${fname}" "${info.url}"` : `curl -L -o "${target}/${fname}" "${info.url}"`);
        L.push(`${cmt}   → ${sizeNote}`);
      } else {
        L.push(`${cmt} [수동] ${fname} → ${target} (URL 미확인) · ${sizeNote}`);
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

  L.push(`${cmt} 완료. ComfyUI 재시작 후 워크플로우 로드.`);
  return L.join(isWin ? "\r\n" : "\n");
}

// 모델 받기 스크립트(Windows .bat). modelPlan의 confirmed·workflow_author + URL 직링크만.
// unknown·검색 폴백은 미포함(날조 금지). HF blob→resolve로 직다운 변환. 폴더 mkdir + 배치.
function buildDownloadScript(plan, env, heldSet) {
  // 파일 직링크만(트리/브라우즈 링크 제외 — 결함7: repo_filename 미확인은 트리 링크라 curl 불가).
  // 3: heldSet(대조로 확인된 보유 파일) 제외 → 미보유만. heldSet 미제공(대조 전)이면 전량.
  const isFileUrl = (u) => /^https?:\/\//.test(u || "") && !/\/tree\//.test(u || "");
  const items = (plan?.items || []).filter((it) => (it.confidence === "confirmed" || it.confidence === "workflow_author") && isFileUrl(it.promoted?.downloadUrl || it.downloadUrl) && !heldSet?.has(it.selectedFile));
  const L = ["@echo off", "chcp 65001 >nul", "REM Teardown 모델 받기 스크립트 (Windows). 확정·제작자 안내 출처 중 미보유만 포함(확인 필요·검색 폴백·보유 파일 제외)."];
  L.push(`REM 생성: ${new Date().toISOString().slice(0, 10)}`);
  if (!(env?.basePath || env?.modelRoot)) L.push("REM 경로가 상대경로입니다. ComfyUI 루트(models 폴더의 상위)에서 실행하세요.");
  L.push("REM 대용량 파일은 브라우저 다운로드가 더 안정적일 수 있습니다.");
  L.push("");
  if (!items.length) { L.push("REM 직링크가 확정된 모델이 없습니다."); return L.join("\r\n"); }
  for (const it of items) {
    const p = it.promoted; // 저VRAM 승격 시 대체 파일을 받는다(받기 행과 일치)
    const file = p?.filename || it.selectedFile;
    // 파인딩 m 재수리: 받기 절대 경로를 env.modelRoot에서 직접 조립(plan.fullPath 의존 제거 → UI 상태 누락 방지). {입력}\{종류}\{파일}, models 삽입 금지.
    const folder = downloadTargetFolder(env?.modelRoot || env?.basePath, p ? p.folder : it.folder);
    const size = p?.size || it.size;
    const url = ((p?.downloadUrl || it.downloadUrl) || "").replace("/blob/", "/resolve/"); // HF 뷰어(blob) → 직다운(resolve)
    L.push(`REM ${file}${size ? ` (${size})` : ""} · ${it.confidence}${p ? " (이 PC VRAM 기준 대체 권장)" : ""}`);
    L.push(`mkdir "${folder}" 2>nul`);
    L.push(`curl -L -o "${folder}\\${file}" "${url}"`);
    L.push("");
  }
  L.push("REM 완료. 받은 파일 용량을 확인해 주세요(수 KB/MB로 작으면 깨진 것).");
  return L.join("\r\n");
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
  L.push(`| 커스텀 pack | ${report.customPackTotal} |`);
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
    for (const w of mdQw) L.push(`- \`${w.file}\`: ${w.quant} 형식은 ${GEN_LABEL[w.gen] || w.gen}에서 기본 미지원(변환 경로로 실행될 수 있으나 불안정). ${altListText(w)} 대체 권장`);
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
  const mdPlan = buildModelPlan(report, env); // 단일 진실 공급원 — 인벤토리 폴더·근거도 plan에서(드리프트 제거)
  const mdAll = [...mdPlan.items, ...mdPlan.unknowns];
  L.push(`### 1. 모델 · 자산 (${mdAll.length})`);
  if (mdAll.length === 0) L.push(`- 없음`);
  else for (const it of mdAll) L.push(`- \`${it.selectedFile}\` → ${it.fullPath || it.folder || "확인 필요"} [${it.confidence}]${it.size ? ` · ${it.size}` : ""}`);
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
  L.push(`아래는 ComfyUI 워크플로우의 구조 분석 + 환경 + (있으면)에러 로그입니다.`);
  L.push(`이 정보로 진단하되, 반드시 아래 "답변 형식"을 지켜 답하세요.`);
  L.push(``);
  L.push(`### 답변 형식 (아래 두 블록 형식만 사용. 산문 단락 금지)`);
  L.push(`① 요약 표: 한 문제당 한 줄. "조치" 열은 핵심어만(상세는 ②로).`);
  L.push(`| # | 문제 | 조치 | 완료 확인 |`);
  L.push(`|---|---|---|---|`);
  L.push(`② 실행 블록: 항목 번호별로 복사해 실행할 명령·경로·변경값만 코드블록으로. 설명문은 코드블록 위 1줄로 제한.`);
  L.push(`확신 없는 항목은 표의 "조치" 열에 "확인 필요" + 유력 후보·근거를 1줄로. 없는 URL·파일은 지어내지 마세요.`);
  L.push(`답변은 ComfyUI만 쓰는 비개발자 기준으로 작성해 주세요. 터미널·PowerShell 명령은 GUI 대안(ComfyUI-Manager 설치, 탐색기 파일 이동, 브라우저 다운로드)이 없을 때만 제시하고, 명령을 줄 때는 어디에 붙여넣는지(실행 위치·프로그램명)까지 안내해 주세요.`);
  L.push(`캡처 이미지를 따로 첨부한 경우, 이미지 속 빨간 노드와 위 구조 데이터를 대조해 판단하세요.`);
  L.push(``);
  L.push(`## 워크플로우 구조 (대상: ${report.source})`);
  L.push("```");
  L.push(ctx);
  L.push("```");
  L.push(``);
  if (qw.length) {
    L.push(`## 이미 발견된 양자화 호환성 문제 (Teardown 룰)`);
    for (const w of qw) L.push(`- ${w.file}: ${w.quant} 형식은 ${GEN_LABEL[w.gen] || w.gen}에서 기본 미지원(변환 경로로 실행될 수 있으나 불안정). ${altListText(w)} 대체 권장`);
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
  // 받을 모델 표 — modelPlan(단일 진실 공급원)에서. 파일·폴더·용량·직링크·근거 등급. "확인 필요"는 unknowns에만.
  const plan = buildModelPlan(report, env);
  if (plan.items.length || plan.unknowns.length) {
    L.push(`## 받을 모델 (파일 · 넣을 폴더 · 용량 · 직링크 · 근거)`);
    L.push(`| 받을 파일 | 넣을 폴더 | 용량 | 직링크 | 근거 |`);
    L.push(`|---|---|---|---|---|`);
    for (const it of plan.items) {
      // 결함e: 화면과 같은 단일 소스(promoted) 반영. 저VRAM 승격 시 대체가 1순위, 원 지정값은 아래 dim.
      const p = it.promoted;
      const file = p?.filename || it.selectedFile;
      const folder = (p ? (p.fullPath || p.folder) : (it.fullPath || it.folder)) || "확인 필요";
      const size = p?.size || it.size || "미실측";
      const url = (p?.downloadUrl || it.downloadUrl) || "확인 필요";
      L.push(`| ${file} | ${folder} | ${size} | ${url} | ${p ? "이 PC 기준 권장" : it.confidence} |`);
      if (p) L.push(`| ↳ ${it.selectedFile} | (상위 VRAM용, 워크플로우 원 지정값) | ${it.size || "미실측"} | | 참고 |`);
    }
    L.push(``);
    if (plan.alternatives.length) { L.push(`### 대체 후보 (OOM 발생 시에만. 1순위 대체용, 추천 아님)`); for (const a of plan.alternatives) L.push(`- ${a.filename}${a.size ? ` · ${a.size}` : ""} · ${a.reason}`); L.push(``); }
    if (plan.exclusions.length) { L.push(`### 받지 말 것 (이 워크플로우에 부적합)`); for (const e of plan.exclusions) L.push(`- ${e.filename} (${e.quant}) · ${e.reason}`); L.push(``); }
    if (plan.unknowns.length) { L.push(`### 확인 필요 (출처 미확인 — 지어내지 말고 함께 찾아 주세요)`); for (const it of plan.unknowns) L.push(`- ${it.selectedFile} → ${it.folder || "폴더 확인 필요"}`); L.push(``); }
    L.push(`> 받은 뒤 "용량"과 비교. 수 KB/MB로 작으면 깨진 것이니 삭제 후 재다운로드.`);
    L.push(``);
  }
  // 이미 확보된 출처(registry:false 팩 + clone) — LLM이 재검색·재발명하지 않도록 데이터로 제공.
  const { groups: brGroups } = groupNodesByRepo(report.unmapped || []);
  const noReg = brGroups.filter((g) => g.registry === false);
  if (noReg.length) {
    L.push(`## Manager에 없는 팩 (출처·clone 이미 확보 — 재검색 불필요)`);
    for (const g of noReg) {
      const clone = g.clone_url || (g.repo ? (g.repo.startsWith("https://") ? g.repo.replace(/\/?$/, ".git") : `https://github.com/${g.repo}.git`) : "확인 필요");
      L.push(`- ${g.types.join(", ")} → \`git clone ${clone}\``);
    }
    L.push(``);
  }
  // 에러 로그 — 결함8: 최신 세션의 오류·경고 줄 + 전후 문맥만(원문 전체 운반 금지).
  const brSession = latestLogSession(errlog || "");
  const brErr = extractErrorLines(brSession);
  L.push(`## 에러 로그 (최신 실행 세션의 오류·경고 부분만)`);
  L.push("```");
  L.push(brErr.text || (errlog.trim() ? "(최신 세션에서 오류·경고 줄을 찾지 못했습니다. 구조·환경만 보고 점검해 주세요.)" : "(에러 로그 없음. 구조·환경만 보고 점검해 주세요)"));
  L.push("```");
  L.push(``);
  // 지시문 블록(P2.5) — LLM에게 실재 확인·clone 생성·모델 명시·할루시네이션 방지 요구.
  const cnPath = env?.customNodesPath || env?.modelRoot || "";
  L.push(`## 이 데이터로 다음을 해 주세요`);
  L.push(`1. 위 "확인 필요" 노드마다 소속 GitHub repo를 웹에서 실재 확인한 뒤 특정해 주세요. "Manager에 없는 팩"으로 이미 확보된 것은 재검색하지 마세요.`);
  L.push(`2. 확인된 각 노드의 git clone 명령을 ${cnPath ? `이 custom_nodes 경로와 함께 만들어 주세요: \`${cnPath}\`` : "ComfyUI 설치 폴더의 custom_nodes 경로와 함께 만들어 주세요(경로는 사용자 환경에 맞게)."}`);
  L.push(`3. "확인 필요" 모델마다 파일명·받을 곳(HuggingFace repo)·넣을 폴더까지 명시해 주세요.`);
  L.push(`4. 웹에서 실재 확인이 안 되면 지어내지 마세요. "확인 필요"로 남기고, 유력 후보와 그 근거(왜 이게 유력한지)를 제시해 주세요. 없는 URL·repo·파일명은 만들지 마세요.`);
  L.push(``);
  if ((plan.unknowns.length) > 0) L.push(`> 미확인·확인 필요 항목이 남아 있습니다. 캔버스에서 빨간 노드가 보이게 확대한 1장 + Note(설명 메모) 부분 1장을 첨부하면 판독에 도움이 됩니다. (전체 축소 캡쳐는 판독이 어렵습니다.)`);
  L.push(``);
  L.push(`---`);
  L.push(`Generated by Teardown · 이 브리핑을 그대로 붙여넣고 엔터를 누르세요.`);
  let text = L.join("\n");
  // 결함8: 총량 상한 ~10,000자. 초과 시 에러 추출분을 대표 3건+건수로 압축.
  if (text.length > 10000 && brErr.text) {
    const errLines = brErr.text.split("\n").filter((l) => l.trim() && l !== "...");
    const compressed = [...errLines.slice(0, 3), `... 외 오류·경고 ${Math.max(0, brErr.errorCount - 3)}건. 전체 로그는 별도 보관하고 필요한 부분만 붙여넣어 주세요.`].join("\n");
    text = text.replace(brErr.text, compressed);
  }
  return text;
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

// 순번 원형 배지 — 단일 컴포넌트. variant로 fill(행동 구역=Solution)/line(근거·참고·접기 구역) 분기. 크기·타이포 동일(30px·15·800).
// n==null → 완료(✓). muted=완료·충족(회색 토큰). onClick 있으면 완료 토글(클릭 가능). 상단 정렬(marginTop 1)로 제목 첫 줄 광학 정렬.
// line 스트록 확정값 = 2px: fill(솔리드)과 병렬 렌더 시 30px 원에서 2px가 fill 대비 가독 유지하며 3px는 과중(테두리가 숫자를 압박). 화면 검수에서 여전히 얇으면 3px로 상향.
function NumBadge({ n, variant = "fill", muted = false, accent: accentColor, onClick, title, mt = 1 }) {
  const line = variant === "line";
  const accent = accentColor || (muted ? C.line : C.point);
  return (
    <div onClick={onClick} title={title}
      style={{ width: 30, height: 30, borderRadius: 15, boxSizing: "border-box", background: line ? "transparent" : accent, border: line ? `2px solid ${accent}` : "none", color: line ? accent : INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0, marginTop: mt, cursor: onClick ? "pointer" : undefined }}>
      {n == null ? <Check size={15} color={line ? accent : C.dim} /> : n}
    </div>
  );
}

function MetricBox({ value, label, unit }) {
  // comfy.org 공식 카드: 스트로크 없음 / 배경보다 살짝 밝은 플럼. 값 길이에 따라 폰트 자동 축소(해상도·샘플러 등 긴 값 카드 넘침 방지, 짧은 수치는 27 유지).
  const vs = String(value);
  const vFont = vs.length > 8 ? 18 : vs.length > 5 ? 21 : 27;
  return (<div style={{ background: C.metricBg, border: "none", borderRadius: 16, padding: "26px 18px" }}>
    <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.3 }}>{label}</div>
    <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 3, flexWrap: "wrap" }}>
      <span style={{ fontFamily: MONO, fontSize: vFont, fontWeight: 700, color: C.point, lineHeight: 1.1, overflowWrap: "anywhere" }}>{value}</span>
      {unit && <span style={{ fontSize: 13, color: C.dim }}>{unit}</span>}
    </div>
  </div>);
}
function Empty({ text }) { return <div style={{ fontSize: 13, color: C.faint, padding: "4px 0" }}>{text}</div>; }

// 라운드박스 안 번호 행 — 기존 스크립트 섹션의 1·2·3 번호 행 문법 그대로(원형 배지 30 + 제목 23 + 우측 +/- 토글, 기본 닫힘). 콘텐츠는 paddingLeft 44.
// 섹션 제목은 토글 없는 고정 SectionTitle(Summary·Findings와 동일). 이 번호 행 토글이 유일한 접이(토글 안 토글 0).
// 규칙: 접힘 상태는 배지+제목+토글만. 설명성 서브카피는 sub 슬롯이 아니라 펼침 내용(children) 첫 줄 dim으로 둔다(접힘 높이 균일).
function NumRow({ num, title, open, onToggle, first, children }) {
  return (
    <div style={{ paddingTop: 20, paddingBottom: 20, borderTop: first ? "none" : `1px solid ${C.divider}` }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
        <div style={{ width: 30, height: 30, borderRadius: 15, background: C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{num}</div>
        <div style={{ fontSize: 23, fontWeight: 650, color: C.text, lineHeight: 1.2, flex: 1, minWidth: 0 }}>{title}</div>
        <button className="td-acc" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-label="펼치기/접기"
          style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
          {open ? <Minus size={26} strokeWidth={2.25} /> : <Plus size={26} strokeWidth={2.25} />}
        </button>
      </div>
      {open && <div style={{ paddingLeft: 44, marginTop: 16 }}>{children}</div>}
    </div>
  );
}

// 상위 섹션 내부의 평탄 구획 — step 경계를 소제목(dim)+구분선으로 유지(접힘 없음). first면 구분선·상단여백 없음.
function DetailSub({ title, first, children }) {
  return (
    <div style={{ marginTop: first ? 0 : 24, paddingTop: first ? 0 : 24, borderTop: first ? "none" : `1px solid ${C.divider}` }}>
      {title && <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.dim, letterSpacing: "0.02em", marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

// 복사 단위 = 값 행. 여러 줄 값(명령·URL·경로)을 줄 단위 값 행으로 분해, 행 우측 끝 복사 아이콘 + 박스 우측 상단 "전체 복사".
// "박스 + 우측 상단 복사" 패턴 전 화면 단일 문법(방법 A clone·AI 결과 명령 등). 아이콘 클릭 = 그 줄만 클립보드(개행·안내 미포함). copy·copiedKey는 상위 상태(피드백 기존 방식).
function CopyRows({ text, keyBase, copy, copiedKey }) {
  const lines = String(text || "").split("\n").filter((l) => l.trim());
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 13px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 0 2px" }}>
        <button className="td-copy" onClick={() => copy(text, `${keyBase}-all`)} title="모든 줄을 한 번에 복사" style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: SANS, fontSize: 13, fontWeight: 600 }}>
          {copiedKey === `${keyBase}-all` ? <Check size={14} /> : <Copy size={14} />} 전체 복사</button>
      </div>
      {lines.map((ln, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.divider}` }}>
          <code style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 13.5, color: C.text, overflowWrap: "anywhere", lineHeight: 1.5 }}>{ln}</code>
          <button className="td-copy" onClick={() => copy(ln, `${keyBase}-${i}`)} title="이 줄만 복사" style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
            {copiedKey === `${keyBase}-${i}` ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>
      ))}
    </div>
  );
}

// P0: 국소 렌더 크래시가 전체 화면을 날리지 않도록 구역별 경계. 특정 구역이 터져도 나머지(구조·브리핑)는 유지.
class SectionBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return this.props.fallback ?? (
      <div style={{ fontSize: 13, color: C.faint, background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 12, padding: "14px 16px", lineHeight: 1.6 }}>
        이 구역을 표시하는 중 문제가 발생했습니다. 다른 구역과 브리핑은 정상입니다. 파일 형식이 특이할 수 있으니, ComfyUI에서 워크플로우를 다시 저장해 시도해 주세요.
      </div>);
    return this.props.children;
  }
}

/* ---------- 메인 ---------- */
export default function Teardown() {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [open, setOpen] = useState({ fb: false, fa: false, f1: false, f2: false, rn1: true, rn2: true }); // 문제 블록 기본 닫힘 — Solution이 주인공, Findings는 필요시 펼침. rn1/rn2(Red Node STEP)는 기본 펼침
  const [detailOpen, setDetailOpen] = useState(false);         // "자세한 진단 보기" 토글 (기본 닫힘)
  const isAdmin = new URLSearchParams(location.search).get("admin") === "1"; // 관리자 모드(적립 데이터 노출)
  const [errlog, setErrlog] = useState("");       // 에러 로그 텍스트 (A안: 상시 노출)
  const [errShots, setErrShots] = useState([]);   // 선택 추가: 에러 캡처 이미지 [{name,url}]
  const [rxDetailOpen, setRxDetailOpen] = useState(false); // 처방전 "판단 근거" details 제어(액션 버튼이 펼쳐 스크롤)
  const [missingText, setMissingText] = useState(""); // 빨간 노드 교정: 사용자가 붙여넣은 누락 모델 파일명
  const [dirText, setDirText] = useState("");         // 빨간 노드 교정: PC 폴더 파일 목록(dir /b 결과)
  const [rawJson, setRawJson] = useState("");     // A안: 진단하기 버튼이 재실행할 원본 JSON
  const [uploadCount, setUploadCount] = useState(0); // UX3: 파일 로드 횟수(재방문 판정)
  const [showTop, setShowTop] = useState(false); // UX6: 스크롤 1뷰포트 초과 시 Top 버튼
  useEffect(() => { const onScroll = () => setShowTop(window.scrollY > window.innerHeight); window.addEventListener("scroll", onScroll, { passive: true }); return () => window.removeEventListener("scroll", onScroll); }, []);
  const [rawSrc, setRawSrc] = useState("");
  const [aiResult, setAiResult] = useState(null);  // AI 정밀 진단 결과
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const [briefingBusy, setBriefingBusy] = useState(false); // 브리핑 복사 처리 중 표시(딤+스피너)
  const [briefingInfo, setBriefingInfo] = useState(null);  // 무엇을 담았는지 요약 {lines, shots, chars}
  const [envOpen, setEnvOpen] = useState(false);
  const [altOpen, setAltOpen] = useState(false); // 작업1: 환경 '다른 방법으로 입력'(직접 선택·폴더 대조) 접이
  const [envLog, setEnvLog] = useState("");
  const [env, setEnv] = useState({ gpu: "", torch: "", cuda: "", vram: null, modelRoot: "", basePath: "", customNodesPath: "", installedPacks: [], importFailed: [], modelRootAssembled: false, platform: "", logPath: "" });
  const [folderPickMac, setFolderPickMac] = useState(false); // v: Mac·Linux 토글에서 폴더 선택 시 발화(전체 경로 직접 입력 유도)
  const [folderScan, setFolderScan] = useState(""); // P2.7: 붙여넣은 폴더 스캔 출력(내 모델 폴더 대조)
  const [scanOs, setScanOs] = useState("win");      // P2.7: 스니펫 OS 토글(win|unix)
  const [scanDrive, setScanDrive] = useState("C");  // 파인딩 s: Windows 드라이브 셀렉트(폴더 버튼 경로 조립용)
  const [folderPickWarn, setFolderPickWarn] = useState(false); // 파인딩 s: 종류 폴더 오선택 경고
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mgrMap, setMgrMap] = useState(null); // manager_node_map.json (비동기 로드)
  useEffect(() => { fetch("/manager_node_map.json").then((r) => r.ok ? r.json() : null).then(setMgrMap).catch(() => {}); }, []);
  const onEnvLog = (text) => {
    setEnvLog(text);
    const parsed = parseComfyLog(text);
    setEnv((prev) => ({ ...prev, gpu: parsed.gpu || prev.gpu, torch: parsed.torch || prev.torch, cuda: parsed.cuda || prev.cuda, vram: parsed.vramGB ?? prev.vram, basePath: parsed.basePath || prev.basePath, customNodesPath: parsed.customNodesPath || prev.customNodesPath, installedPacks: parsed.installedPacks, importFailed: parsed.importFailed, platform: parsed.platform || prev.platform, logPath: parsed.logPath || prev.logPath }));
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
  // 클립보드에 이미지가 있으면 캡처 첨부 흐름으로 편입 (텍스트 붙여넣기는 기본 동작 유지)
  const onPasteShot = (e) => {
    const items = e.clipboardData?.items; if (!items) return;
    const imgs = [];
    for (const it of items) if (it.type?.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
    if (imgs.length) onShots(imgs);
  };
  const copy = (text, key) => { navigator.clipboard?.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); };
  // 파인딩 s: 폴더 버튼 선택값 → 드라이브 조립 후 입력란 채움. 종류 폴더 오선택 시 발화. 직접 타이핑한 절대 경로가 있으면 우선(유지).
  const applyPickedFolder = (name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    // v: Mac·Linux는 브라우저가 폴더명만 반환 → 전체 경로를 알 수 없음. Windows 조립 금지(오염 차단). 입력란 무변 + 발화(직접 입력 유도).
    if (scanOs !== "win") { setFolderPickWarn(false); setFolderPickMac(true); return; }
    setFolderPickMac(false);
    if (isTypeFolder(clean)) { setFolderPickWarn(true); return; }
    setFolderPickWarn(false);
    const isAbs = (v) => /^[A-Za-z]:[\\/]/.test(v) || /^\//.test(v);
    // 직접 타이핑한 절대 경로(조립 산출 아님)는 우선 유지. 그 외엔 현재 드라이브로 조립하고 조립 산출 플래그 세움(Windows만 도달).
    setEnv((p) => (isAbs(p.modelRoot || "") && !p.modelRootAssembled)
      ? { ...p, modelRootPartial: false }
      : { ...p, modelRoot: assembleModelPath(scanDrive, clean, scanOs), modelRootPartial: false, modelRootAssembled: true });
  };
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
    setUploadCount((c) => c + 1); // UX3: 재방문(재업로드) 판정용 (5: 처방 접힘 오버라이드 상태 제거됨)
    setRawJson(text); setRawSrc(src);
    setAiResult(null); setAiErr(null); setAiLoading(false);
    setLiveCompat({}); setModelResearch({}); // 새 분석 시 이전 상태 초기화
    try {
      const norm = normalize(JSON.parse(text));
      if (!norm) throw new Error("이 파일 형식을 해석하지 못했습니다. ComfyUI에서 워크플로우 저장(캔버스) 또는 API 형식 내보내기 파일인지 확인해 주세요.");
      const rep = analyze(norm, mgrMap);
      setReport({ ...rep, source: src });
    } catch (e) {
      setReport(null);
      setErr(/JSON|Unexpected|token/.test(e.message)
        ? "JSON을 읽지 못했습니다. ComfyUI 워크플로우 export가 맞는지 확인하세요." : e.message);
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
    /^https?:\/\//.test(p) ? <a key={k} href={p} target="_blank" rel="noopener noreferrer" style={{ color: C.memo, overflowWrap: "anywhere", textDecoration: "underline" }}>{p}</a> : p);
  // 미확인 모델 파일명 웹 검색 URL (구글, 파일명+download)
  // 4: HF 자체 검색은 카드·app.py만 인덱싱(저장소 파일명 미검색) → 빈 결과. 구글 site: 쿼리로 교체(파일명 따옴표·URL 인코딩). google이 HF 파일 목록 페이지를 인덱싱하므로 파일명이 실제로 걸린다.
  const searchUrl = (name) => "https://www.google.com/search?q=" + encodeURIComponent(`site:huggingface.co "${name.replace(/\.[^.]+$/, "")}"`);
  // UX2: 판정 박스 → Diagnose 바로가기. 에러 로그 아코디언 열고 스크롤+포커스.
  const scrollToDiagnose = (e) => { if (e) e.preventDefault(); setOpen((o) => ({ ...o, errAcc: true })); requestAnimationFrame(() => { document.getElementById("diagnose-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => document.querySelector("#diagnose-section textarea")?.focus(), 400); }); };
  // 디아그노시스 앵커(5): 실행 행 부속 링크 → "자세한 진단" 토글 자동 펼침 + 로그 입력(#diagnose-section)으로 스크롤. 독립 섹션 없음(현행 위치 유지).
  const openDiagnose = (e) => { if (e) e.preventDefault(); setDetailOpen(true); setOpen((o) => ({ ...o, errAcc: true })); setTimeout(() => { document.getElementById("diagnose-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => document.querySelector("#diagnose-section textarea")?.focus(), 400); }, 80); };
  // 소형2/7: "자세한 진단" 펼침 시 토글 줄(#detail-toggle)이 뷰포트 상단으로 스무스 스크롤(토글 보이고 바로 아래 Summary). 닫을 때는 대칭으로 Solution 헤더(#solution-header)로 스크롤.
  const toggleDetail = () => { const next = !detailOpen; setDetailOpen(next); setTimeout(() => document.getElementById(next ? "detail-toggle" : "solution-header")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };
  // 4(4차): 전체 현황 집계 1줄 → Bypassed 섹션 상세로. bp1 펼침 + #bypassed-section 스크롤(같은 detail 블록 내).
  const openBypassed = (e) => { if (e) e.preventDefault(); setOpen((o) => ({ ...o, bp1: true })); setTimeout(() => document.getElementById("bypassed-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };
  // B: Solution 헤더 환경 칩 '지금 채우기' — 입력 존 단계2로 스크롤 + 환경정보 펼침.
  const goFillEnv = (e) => { if (e) e.preventDefault(); setEnvOpen(true); setTimeout(() => document.getElementById("env-step")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };
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
    try { return buildRecipes(JSON.parse(rawJson), { gpu: gpuGeneration(env.gpu) || null }); } catch { return []; }
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
  // 로그 기반 설치 확인 — env 로그 박스 + 에러 로그 박스 양쪽에서 추출·병합.
  // 실PC 패배 원인: 콘솔 로그를 파싱하는 env 박스는 접힌 아코디언에 숨어, 사용자는 눈에 띄는 에러 로그 박스에 붙여넣지만 그건 설치 인식을 안 했음. 어디에 붙여도 인식되게 병합.
  const logEnv = React.useMemo(() => {
    const fromErr = errlog && errlog.trim() ? parseComfyLog(errlog) : { installedPacks: [], importFailed: [] };
    // 수리1: 로그 상태 3분기용 — 로그 유입 여부 + Import 블록 존재(parseComfyLog가 이미 쓰는 감지 규칙을 병합 텍스트에 재적용). 파싱 로직 무변.
    const anyText = `${envLog || ""}\n${errlog || ""}`;
    return {
      installedPacks: [...new Set([...(env.installedPacks || []), ...fromErr.installedPacks])],
      importFailed: [...new Set([...(env.importFailed || []), ...fromErr.importFailed])],
      logProvided: !!((envLog && envLog.trim()) || (errlog && errlog.trim())),
      hasImportBlock: /Import times for custom nodes/i.test(anyText),
    };
  }, [env.installedPacks, env.importFailed, errlog, envLog]);

  // 붙여넣은 로그 감지 요약 + 불완전(잘림) 감지. 사용자가 뭘 읽어냈는지·재복사 필요한지 즉시 판단하게.
  const logInfo = React.useMemo(() => {
    const texts = [envLog, errlog].filter((t) => t && t.trim());
    if (!texts.length) return null;
    const joined = texts.join("\n");
    const hasImport = /Import times for custom nodes/i.test(joined);
    const hasPrestartup = /Prestartup times for custom nodes/i.test(joined);
    return { truncated: hasPrestartup && !hasImport, packN: logEnv.installedPacks.length, failN: logEnv.importFailed.length, gpu: env.gpu, basePath: env.basePath, modelRoot: env.modelRoot, platform: env.platform };
  }, [envLog, errlog, logEnv.installedPacks, logEnv.importFailed, env.gpu, env.basePath, env.modelRoot, env.platform]);

  // 코어 버전 요구 판정(작업 A). 워크플로우가 쓰는 코어 기능이 로그 ComfyUI 버전보다 신버전을 요구하면 최상단 확인 행.
  const coreCheck = React.useMemo(() => {
    const minRules = (report?.coreFeatures || []).filter((r) => r.min_version);
    if (!minRules.length) return null; // extension_required만이면 버전 판정 안 함(설치 행에서 처리)
    let ver = "";
    for (const t of [envLog, errlog].filter((x) => x && x.trim())) { const p = parseComfyLog(t); if (p.comfyVersion) { ver = p.comfyVersion; break; } }
    const required = minRules.reduce((a, r) => (compareVersion(r.min_version, a) > 0 ? r.min_version : a), "0");
    if (!ver) return { state: "unknown", required, rules: minRules };
    if (compareVersion(ver, required) < 0) return { state: "outdated", required, current: ver, rules: minRules };
    return { state: "ok", required, current: ver };
  }, [report, envLog, errlog]);

  // modelPlan — 단일 진실 공급원. Solution·인벤토리·MD·브리핑·대조 전부 이것만 참조(드리프트 제거). summary(결함 d)보다 먼저 계산.
  const plan = React.useMemo(() => (report ? buildModelPlan(report, env) : null), [report, env.gpu, env.vram, env.basePath, env.modelRoot]);
  const planByFile = React.useMemo(() => { const m = new Map(); if (plan) for (const it of [...plan.items, ...plan.unknowns]) m.set(it.selectedFile, it); return m; }, [plan]);
  // P2.7 내 모델 폴더 대조 — 붙여넣은 목록 파싱 → 요구 모델과 대조(완비/미보유/깨짐). 붙여넣지 않으면 scanned=false(판정 안 함).
  const heldInv = React.useMemo(() => parseFolderScan(folderScan), [folderScan]);
  // 파인딩 p: 대조 분모 = 워크플로우 참조 모델 전체(report.models, 카탈로그 미등재 포함). plan은 기대 용량·요구 폴더 lookup용.
  const reconcile = React.useMemo(() => (report ? reconcileInventory(report.models, heldInv, plan) : null), [report, heldInv, plan]);
  // 6-2: 대조 성공(보유 1건+) 시 솔루션 첫 이미 있음(✓) 행으로 부드러운 스크롤 1회(시선 연결). 실패·미수행이면 리셋(재대조 허용).
  const heldScrollRef = useRef(false);
  useEffect(() => {
    const n = reconcile?.heldSet?.size || 0;
    if (reconcile?.scanned && n > 0 && !heldScrollRef.current) { heldScrollRef.current = true; setTimeout(() => document.getElementById("rx-held-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }
    if (!reconcile?.scanned || n === 0) heldScrollRef.current = false;
  }, [reconcile?.heldSet?.size, reconcile?.scanned]);

  // 진단 요약 계산
  let summary = null;
  if (report) {
    const weightCount = report.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e))).length;
    const issues = [];
    if (report.broken?.length) issues.push({ head: `깨진 노드 ${report.broken.length}개`, severity: "high",
      body: "type이 없는 노드입니다. 해당 커스텀 노드가 설치되지 않으면 워크플로우 실행이 불가합니다." });
    // 이상 노드(anomalous)는 Findings "정체 미상 노드"(상세·행동)로 일원화 — 요약 중복 제거
    // 3등급 판정 — 빨강(실행 불가 확정) / 노랑(점검 필요) / 초록(문제 없음)
    const allSlots = recipes.flatMap((r) => r.slots);
    // 실증(RTX3090+ComfyUI 0.25.1): fp8_scaled가 변환(dequantize) 경로로 실행됨 → quantBad는 '실행 불가 확정'이 아니라 'GPU 점검 권장'(노랑).
    const gpuCheck = allSlots.filter((s) => s.quantBad).length;   // fp8 등 GPU 점검 권장(빨강 아님, 노랑 카운트)
    // 콘솔 로그 설치 확인: installed는 제외, importFailed(로드 실패)는 빨강 유지(실제 차단)
    const instPacks = logEnv.installedPacks, failPacks = logEnv.importFailed;
    const hasLog = instPacks.length > 0 || failPacks.length > 0;
    const missingNodes = (report.unmapped || []).filter((u) => !packInstalled(u.repo || u.clone_url, instPacks) && !packInstalled(u.repo || u.clone_url, failPacks));
    const failedNodes = (report.unmapped || []).filter((u) => packInstalled(u.repo || u.clone_url, failPacks));
    const redNodes = missingNodes.length + failedNodes.length + (report.anomalous?.length || 0) + (report.broken?.length || 0); // 미설치·로드실패·정체미상·깨진 노드
    const checkModels = allSlots.filter((s) => !s.quantBad).length; // 점검 대상 모델 슬롯
    const checkInputs = (report.portability || []).filter((h) => /\.(png|jpe?g|webp|bmp|gif|tiff?|mp4|mov|webm|mkv|avi|wav|mp3|flac|ogg)$/i.test(h.value) && !/[\\/]/.test(h.value)).length; // 입력 파일 준비
    const yellowN = checkModels + checkInputs + gpuCheck;
    let grade, diagLine, valueCauses = null, foreignErrors = 0;
    // 로그 기반 실제 실행 실패 — quantBad·설치확인과 무관하게 최상위 빨강 오버라이드(확정 증거).
    // 결함3: 최신 세션("got prompt" 경계)만 + 거부 값이 현재 워크플로우 참조에 있는지 대조 → 타 워크플로우 오류는 red 제외·분리.
    const session = latestLogSession(errlog || "");
    const modelBases = new Set((report.models || []).map((m) => m.file.replace(/\\/g, "/").split("/").pop().toLowerCase()));
    const wfTypes = new Set((report.nodeTypes || []).map((t) => t.toLowerCase()));
    const wfIds = new Set(report.nodeIds || []);
    const inWorkflow = (v) => { const b = String(v || "").replace(/\\/g, "/").split("/").pop().toLowerCase(); if (!b) return false; if (modelBases.has(b)) return true; const stem = b.replace(/\.[^.]+$/, ""); return [...modelBases].some((mb) => mb === b || (stem.length > 3 && mb.includes(stem))); };
    const allVnil = parseValueNotInList(session), allBroken = parseMissingNodeType(session);
    const valueErrors = allVnil.filter((e) => inWorkflow(e.required));
    const brokenLog = allBroken.filter((b) => (b.nodeId && wfIds.has(String(b.nodeId))) || (b.nodeType && wfTypes.has(b.nodeType.toLowerCase())));
    foreignErrors = (allVnil.length - valueErrors.length) + (allBroken.length - brokenLog.length);
    if (valueErrors.length > 0 || brokenLog.length > 0) {
      grade = "red";
      const segs = [];
      if (valueErrors.length) { const fe = valueErrors[0]; segs.push(`ComfyUI가 거부한 값 ${valueErrors.length}건 (예: ${fe.widget} = '${fe.required}')`); }
      if (brokenLog.length) segs.push(`실행 불가 노드 ${brokenLog.length}개`);
      diagLine = `실행 시 오류가 확인되었습니다. ${segs.join(" · ")}`;
      // 작업 D: VNIL 원인 후보 2가지 병기. 작업 A(버전 부족)가 발화했으면 그 행을 우선 안내.
      if (valueErrors.length) valueCauses = coreCheck?.state === "outdated"
        ? ["ComfyUI 본체가 구버전이라 이 항목을 지원하지 않습니다. 위 버전 확인 행을 먼저 처리해 주세요.", "그래도 남으면 해당 파일이 폴더에 없거나 이름이 다른지 확인해 주세요."]
        : ["해당 파일이 폴더에 없거나 이름이 다릅니다.", "또는 ComfyUI 본체가 구버전이라 이 항목을 지원하지 않을 수 있습니다."];
    } else if (redNodes > 0) {
      grade = "red";
      const parts = [];
      if (missingNodes.length) {
        const { groups, solo } = groupNodesByRepo(missingNodes); // 팩 수 = 출처 확정 repo 그룹만(설치 가능 단위). solo(출처 미상)는 확인 행에서 별도 처리 → 이중 계상 방지
        if (groups.length) parts.push(hasLog ? `커스텀 노드 팩 ${groups.length}개 미설치` : `커스텀 노드 팩 ${groups.length}개 설치 확인 필요`);
        if (solo.length) parts.push(`소속 팩 미확인 노드 ${solo.length}개`);
      }
      if (failedNodes.length) parts.push(`로드 실패 노드 ${failedNodes.length}개`);
      if (report.anomalous?.length) parts.push(`정체 미상 노드 ${report.anomalous.length}개`);
      if (report.broken?.length) parts.push(`이름 확인 불가 노드 ${report.broken.length}개`);
      diagLine = `현재 상태로는 실행되지 않습니다. ${parts.join(" · ")}`;
    } else if (yellowN > 0) {
      grade = "yellow";
      const yparts = [`실행 전 점검 항목 ${yellowN}개`];
      if (gpuCheck > 0) yparts.push(`GPU 점검 권장 모델 ${gpuCheck}개`);
      // 소형(배너): 로그 없는 노랑은 "찾지 못했습니다"(오독=문제 없음) 대신 "구조만 판정" 명시.
      diagLine = hasLog
        ? `실행을 막는 문제는 찾지 못했습니다. ${yparts.join(" · ")}`
        : `로그 없이 구조만 판정했습니다. 실행 전 준비 항목 ${yellowN}개가 있습니다.`;
    } else {
      grade = "green";
      diagLine = "이 워크플로우에서 구조상 문제를 찾지 못했습니다. 도구는 PC 안의 설치 상태는 확인하지 않습니다.";
    }
    // 결함 d: 로그 없이(=노드 설치 미확정) 모델 대조가 완비면 "구조상 준비 완료"로 라우팅(빨강 억제).
    // 로그 있으면 실측 우선(억제 안 함). 구조적 결함(깨진·정체미상 노드)·로그 확인 오류는 유지. 대조 미수행이면 현행 유지.
    let envComplete = false;
    if (reconcile?.complete && !hasLog && !valueErrors.length && !brokenLog.length && !(report.broken?.length) && !(report.anomalous?.length)) {
      envComplete = true; grade = "green"; valueCauses = null;
      diagLine = "붙여넣은 목록 기준으로 필요한 모델이 모두 있습니다. 구조상 실행 준비 완료로 판정됩니다.";
    }
    summary = { diagLine, grade, diagBlocked: grade === "red", envComplete, issues, weightCount, valueCauses, foreignErrors, hasLogError: valueErrors.length > 0 || brokenLog.length > 0, valueFindings: valueErrors.slice(0, 5).map((e) => ({ widget: e.widget, required: e.required, best: e.best })) };
  }

  // 처방전 할 일. 기존 데이터(unmapped·recipesEnriched)에서 항목만 추출. 새 분석 로직 없음(표시층).
  const rxTodos = React.useMemo(() => {
    if (!report) return [];
    const todos = [];
    // (a) 커스텀 노드 설치. 같은 repo 미씽 노드는 groupNodesByRepo로 1항목 그룹핑(clone 1회). repo 없으면 solo 개별.
    const { groups, solo } = groupNodesByRepo(report.unmapped || []);
    for (const g of groups) todos.push({ kind: "nodegroup", key: `repo-${g.repo || g.clone_url}`, g });
    const soloByType = {}; // 같은 type 미씽 노드를 1항목으로 합침(해당 노드 N개), repo 그룹핑과 같은 패턴
    for (const u of solo) (soloByType[u.type] ||= []).push(u);
    for (const us of Object.values(soloByType)) todos.push({ kind: "node", key: `node-${us[0].type}`, u: us[0], count: us.length });
    // (b) 모델 준비. 노드 카드 단위가 아니라 슬롯 단위로 평탄화
    for (const rc of recipesEnriched) for (const s of rc.slots) {
      todos.push({ kind: "model", key: `model-${rc.id}-${s.slot}`, s, nodeType: rc.type });
    }
    // (c) 입력 파일(LoadAudio류). portability 중 미디어 파일명(경로 아님) 승격. 절대경로·flash_attn은 확장자/경로 조건으로 자동 제외.
    for (const h of (report.portability || [])) {
      if (/\.(png|jpe?g|webp|bmp|gif|tiff?|mp4|mov|webm|mkv|avi|wav|mp3|flac|ogg)$/i.test(h.value) && !/[\\/]/.test(h.value)) {
        todos.push({ kind: "input", key: `input-${h.node}-${h.value}`, h });
      }
    }
    return todos;
  }, [report, recipesEnriched]);

  // UX3 재방문: 재업로드(2회+) 또는 로그에 실행 오류 → 처방 테이블 접힘 기본(사용자가 이미 본 처방). 첫 방문·무오류는 펼침.
  const revisit = !!report && (uploadCount > 1 || !!summary?.hasLogError);

  // 액션 테이블(당장 할 일) — rxTodos를 동사 선행 행으로. 표시층 전용(판정·데이터 불변).
  const actionRows = React.useMemo(() => {
    const rows = [];
    let rid = 0; // 안정 React key. 표시 연번(n)은 UX2 정렬 후 rxGroups에서 최종 부여(화면 노출 순서 = 연번).
    // 결함k: 디스크 공간 부족 — 최상단(실행 중단 확정). auto_download(결함h)와 크로스링크.
    if (hasDiskError(latestLogSession(errlog || ""))) rows.push({ rid: ++rid, verb: "확인", text: "디스크 공간 부족으로 실행이 중단됐습니다.", sub: "모델 자동 다운로드가 C드라이브 캐시로 향하는 경우가 많으니 C드라이브 여유 공간을 확인해 주세요." + ((report?.autoDownloadNodes?.length) ? " (아래 자동 다운로드 노드 참고)" : ""), kind: "disk" });
    // 작업 A: 코어 버전 요구 — 최상단 1행. outdated=확인 행(확정), unknown(로그 없음)=dim 안내(확정 금지).
    // 6: 버전 2단화. 1단(정적 JSON) = savedVersion "comfy-core X 기준 저장". 2단(로그) = coreCheck 대조(outdated 시 확인 행).
    if (coreCheck?.state === "outdated") rows.push({ rid: ++rid, verb: "확인", text: `이 워크플로우는 ComfyUI ${coreCheck.required} 이상이 필요합니다. 본체를 업데이트한 뒤 다시 열어 주세요.`, sub: `현재 로그의 버전: ${coreCheck.current}`, kind: "coreversion" });
    else if (report?.savedVersion) rows.push({ rid: ++rid, verb: "안내", text: `이 워크플로우는 comfy-core ${report.savedVersion.core} 기준으로 저장되었습니다${report.savedVersion.coreNode ? ` (${report.savedVersion.coreNode} 등)` : ""}.`, sub: coreCheck?.state === "ok" ? `로그의 설치 버전(${coreCheck.current})이 요건을 충족합니다.` : "로그를 붙여넣으면 설치된 버전과 대조해 드립니다.", kind: "gpuhint" });
    else if (coreCheck?.state === "unknown") rows.push({ rid: ++rid, verb: "안내", text: "이 워크플로우는 최신 ComfyUI 기능을 사용합니다. 로그를 붙여넣으면 버전 적합 여부를 판정해 드립니다.", kind: "gpuhint" });
    const nodeGroups = rxTodos.filter((t) => t.kind === "nodegroup");
    const inst = nodeGroups.filter((t) => !packInstalled(t.g.repo || t.g.clone_url, logEnv.installedPacks));
    // 작업2: 로그로 확인돼 설치 행에서 제외된 팩 — 제거 대신 dim 부속 줄로 노출(모델 '이미 있음' 문법 통일).
    const installedNames = nodeGroups.filter((t) => packInstalled(t.g.repo || t.g.clone_url, logEnv.installedPacks)).map((t) => (t.g.repo || t.g.clone_url || "").replace(/\.git$/, "").split("/").pop()).filter(Boolean);
    if (inst.length) {
      const nm = inst.map((t) => (t.g.repo || t.g.clone_url || "").replace(/\.git$/, "").split("/").pop());
      const noReg = inst.filter((t) => t.g.registry === false).length;
      // UX4: 실행 위치를 설치 행에 직접(로그 추출 경로 or 자리표시자). 결함5 규칙 유지.
      const runLoc = env.customNodesPath ? `실행 위치: ${env.customNodesPath}` : "실행 위치: ComfyUI 설치 폴더의 custom_nodes (로그를 붙여넣으면 경로를 채워 드립니다)";
      const noRegMsg = noReg ? ` ${noReg}개는 Manager에 없는 팩이라 install.bat로 직접 설치해 주세요.` : "";
      // clone 인라인 뷰(보조 동선): 각 nodegroup의 git clone 전문. install.bat 다운로드가 주 동선.
      const clones = inst.map((t) => { const g = t.g; const cloneUrl = g.clone_url || (g.repo ? (g.repo.startsWith("https://") ? g.repo.replace(/\/?$/, ".git") : `https://github.com/${g.repo}.git`) : null); return { name: (g.repo || g.clone_url || "").replace(/\.git$/, "").split("/").pop(), cloneUrl }; }).filter((c) => c.cloneUrl);
      const noInst = !logEnv.installedPacks.length;
      rows.push({ rid: ++rid, verb: "설치", text: nm[0] + (nm.length > 1 ? ` 외 ${nm.length - 1}개` : ""), sub: runLoc + noRegMsg, kind: "install", clones, file: "install.bat",
        logHint: noInst && !logEnv.logProvided,                                     // (a) 로그 미유입
        logMissingBlock: noInst && logEnv.logProvided && !logEnv.hasImportBlock,    // (b) 로그 유입 + Import 블록 없음
        installedNames });
    }
    // 확인 — 로그의 missing_node_type. 결함6: node_id→class_type 역조회 후 팩 소속이면 크로스링크(설치 행 최종 연번은 rxGroups에서 해소).
    const wfTypes2 = new Set((report?.nodeTypes || []).map((t) => t.toLowerCase())), wfIds2 = new Set(report?.nodeIds || []);
    const idType = report?.nodeIdType || {};
    const repoByType = {}; for (const u of (report?.unmapped || [])) if (u.repo || u.clone_url) repoByType[u.type] = (u.repo || u.clone_url).replace("https://github.com/", "").replace(/\.git$/, "");
    for (const b of parseMissingNodeType(latestLogSession(errlog || "")).filter((b) => (b.nodeId && wfIds2.has(String(b.nodeId))) || (b.nodeType && wfTypes2.has(b.nodeType.toLowerCase())))) {
      const cls = b.nodeId ? idType[String(b.nodeId)] : b.nodeType;
      const repo = cls ? repoByType[cls] : null;
      if (repo) {
        rows.push({ rid: ++rid, verb: "확인", text: `노드 #${b.nodeId}(${cls})은 ${repo.split("/").pop()} 소속입니다.`, sub: "설치 행의 clone을 실행하면 해결됩니다.", kind: "broken", crosslink: true, crosslinkInstall: true });
      } else {
        const label = b.nodeId ? `노드 ID #${b.nodeId}이(가) 깨져 있습니다` : b.nodeType ? `노드 '${b.nodeType}'을(를) 찾을 수 없습니다` : "깨진 노드가 있습니다";
        rows.push({ rid: ++rid, verb: "확인", text: label, sub: "워크플로우에서 해당 노드를 삭제하거나 다시 추가해 주세요.", kind: "broken" });
      }
    }
    // 확인 — 소속 팩 미확인 노드를 1행으로 병합. Manager는 팩 단위 검색이므로 정직하게: 노드명 검색 + 본체 업데이트 2택.
    const nodeTodos = rxTodos.filter((x) => x.kind === "node");
    if (nodeTodos.length) rows.push({ rid: ++rid, verb: "확인", text: `소속 팩을 확인하지 못한 노드 ${nodeTodos.length}개`, nodes: nodeTodos.map((t) => t.u.type), kind: "node",
      guides: [
        "ComfyUI Manager 검색창에 노드 이름이나 비슷한 팩 이름을 넣어 보세요. 맞는 팩이 나오면 설치하면 됩니다.",
        "ComfyUI 본체가 구버전이면 코어 신규 노드일 수 있습니다. ComfyUI를 업데이트한 뒤 다시 확인해 주세요.",
      ] });
    // 패밀리 감지됐는데 GPU 미입력 → 추천 대신 안내(불변①). 확정 판정 안 함.
    if (plan && plan.family && plan.needs.includes("gpu")) rows.push({ rid: ++rid, verb: "안내", text: `이 워크플로우는 ${plan.label}로 보입니다. GPU를 입력하면 넣을 위치와 환경에 맞는 변형을 추천해 드립니다.`, kind: "gpuhint" });
    // 받기 — modelPlan.items(단일 진실 공급원). 근거 4단계 뱃지. 넣기=fullPath(절대) 또는 folder(상대), 용량·직링크·근거는 planItem에.
    for (const it of plan?.items || []) rows.push({ rid: ++rid, verb: "받기", text: it.workflowValue, folders: it.fullPath ? [it.fullPath] : (it.folder ? [it.folder] : []), badge: it.badge, selects: it.node ? [{ nodeType: it.node, value: it.nodeSelection }] : [], planItem: it, kind: "model" });
    // 3: 일괄 받기 스크립트 카운트·노출·bat 모두 미보유(heldSet 제외) 기준. 직링크 확정 미보유 3개 이상일 때만(1~2개는 각 행 개별 받기로 충분·미노출). 대조 전(heldSet 없음)이면 전량. 파인딩 m: 경로 입력 시 절대, 미입력 시 루트 실행.
    const heldSet = reconcile?.heldSet;
    const dlEligible = (plan?.items || []).filter((it) => (it.confidence === "confirmed" || it.confidence === "workflow_author") && /^https?:\/\//.test((it.promoted?.downloadUrl || it.downloadUrl) || "") && !/\/tree\//.test((it.promoted?.downloadUrl || it.downloadUrl) || "") && !heldSet?.has(it.selectedFile));
    if (dlEligible.length >= 3) rows.push({ rid: ++rid, verb: "받기", text: "모델 일괄 받기 스크립트", sub: `미보유 받기 항목 ${dlEligible.length}개를 한 번에 내려받습니다. ` + ((env.modelRoot || env.basePath) ? "받기 위치가 입력한 모델 폴더 경로로 지정됩니다." : "경로 미입력이면 ComfyUI 루트(models 폴더의 상위)에서 실행해 주세요."), kind: "dlscript", file: "download.bat" });
    // 대체 후보 / 제외(주 모델) — "OOM 시 대체 후보" 톤(추천 아님). 별도 1행.
    if ((plan?.alternatives?.length || 0) + (plan?.exclusions?.length || 0) > 0) rows.push({ rid: ++rid, verb: "참고", text: "메인 모델 대체·제외 안내", kind: "altexcl", alternatives: plan.alternatives, exclusions: plan.exclusions });
    // 확인 필요 — 출처 확인 못한 모델(unknowns)
    for (const it of plan?.unknowns || []) rows.push({ rid: ++rid, verb: "확인", text: it.workflowValue, folders: it.folder ? [it.folder] : [], badge: "확인 필요", selects: it.node ? [{ nodeType: it.node, value: it.nodeSelection }] : [], planItem: it, kind: "model" });
    for (const t of rxTodos.filter((x) => x.kind === "input")) rows.push({ rid: ++rid, verb: "확인", text: `${t.h.value} 입력 파일을 준비해 주세요`, kind: "input" });
    // 결함h: auto_download 노드 → 실행 시 자동 다운로드 안내(C드라이브 캐시 용량). 없으면 미노출.
    if (report?.autoDownloadNodes?.length) rows.push({ rid: ++rid, verb: "참고", text: "이 워크플로우는 실행 시 모델을 자동으로 내려받습니다. 기본 저장 위치가 C드라이브 캐시라 용량을 확인해 주세요.", nodes: report.autoDownloadNodes, kind: "node" });
    // 슬롯 매칭 실패한 제작자 안내 링크 → 일괄 1행(버리지 않음). 강도 지시 병기.
    if (plan?.authorLinks?.length) rows.push({ rid: ++rid, verb: "참고", text: "워크플로우 제작자 안내 링크", kind: "authorlinks", links: plan.authorLinks });
    // o: 실행 행 완결화 — 재시작 안내 각주·에러 로그 링크를 이 행의 부속 줄로 편입(별도 각주·배너 링크 제거).
    rows.push({ rid: ++rid, verb: "실행", text: "큐를 실행해 주세요.", kind: "run", restartNote: "모든 항목을 마쳤다면 ComfyUI를 완전히 재시작한 뒤 워크플로우를 다시 열어 주세요. 빨간 노드가 남아 있지 않으면 정상입니다.", diagLink: true });
    return rows;
  }, [rxTodos, logEnv.installedPacks, logEnv.logProvided, logEnv.hasImportBlock, errlog, plan, coreCheck, report, env.modelRoot, env.basePath, env.customNodesPath, reconcile?.heldSet]);

  // UX2 솔루션 필터링 + 넘버링 최종 부여.
  // 주노출(실행 차단): 로그 거부값·깨진 노드·설치·디스크·버전 + 대조 미보유 받기. 이미 있음(dim ✓, 하단) / 참고·미확정(접기2). 판정 근거 없으면 전량 순서 노출(현행).
  const rxGroups = React.useMemo(() => {
    const rows = actionRows;
    const heldSet = reconcile?.heldSet;
    // 파인딩 p: 보유+제자리(misplaced 제외 = heldSet)면 이미 있음 dim. 받기·확인(미등재) 모델 공통. 위치 다름은 heldSet에서 빠져 주노출에 남음(이동 안내).
    const isHeld = (r) => r.kind === "model" && !!heldSet?.has(r.planItem?.selectedFile);
    const isRefInfo = (r) => r.verb === "참고" || r.verb === "안내" || (r.kind === "model" && r.badge === "확인 필요");
    // 소형1: bypass 그룹 전용 모델 → 접기1("다른 그룹용"). 그룹 매핑 없으면 빈 객체라 미분류(현행). basis 무관(구조 신호).
    const bypassOf = (r) => (r.kind === "model" ? report?.bypassGroupModels?.[r.planItem?.selectedFile] : null);
    const hasBasis = !!summary?.hasLogError || !!reconcile?.scanned; // 로그 실행오류 or 대조 수행
    const primary = [], heldDim = [], refInfo = [], otherGroup = [];
    for (const r of rows) {
      const bg = bypassOf(r);
      if (bg) { otherGroup.push({ ...r, groupTitle: bg }); continue; }
      if (!hasBasis) { primary.push(r); continue; }
      if (isHeld(r)) heldDim.push(r); else if (isRefInfo(r)) refInfo.push(r); else primary.push(r);
    }
    // 표시 순서(주노출 → 다른 그룹용 → 참고·미확정)로 실행 연번. 이미 있음(dim)은 ✓라 번호 미부여 → 가시 번호 끊김·역행 없음.
    let n = 0; const num = (arr) => arr.map((r) => ({ ...r, n: ++n }));
    const P = num(primary);
    const H = heldDim.map((r) => ({ ...r, n: null }));
    const O = num(otherGroup);
    const R = num(refInfo);
    const installN = P.find((r) => r.kind === "install")?.n;
    const fill = (r) => (r.crosslinkInstall ? { ...r, sub: `${installN ? installN + "번 행" : "설치 행"}의 clone을 실행하면 해결됩니다.` } : r);
    return { primary: P.map(fill), heldDim: H, otherGroup: O.map(fill), refInfo: R.map(fill), hasBasis };
  }, [actionRows, reconcile, summary, report]);

  // 액션 행 1개 렌더. first=구분선 제외, dim=이미 있음(✓·딤). 넘버링: 원형 배지(판단근거 30px 노랑 원과 동일 체계).
  // 배지·라벨 정렬(4-1 + #2): 식별자 그룹(원형 배지 + 라벨 열)을 한 몸으로 — 다행 행(부속 줄 있음·받기류)=top(제목 첫 줄에 고정돼야 위→아래 스캔 가능), 단행 행(안내·확인·실행 1줄)=center. 행 줄 수 기준 자동 분기.
  // dev 비교 토글 유지(재비교용): ?align=center|top이면 전 행 강제. 없으면 auto(자동 분기). 프로덕션은 auto 고정(강제 경로 tree-shake).
  // 광학 보정(top, 제목 23px·lineHeight 1.3): x-height 중심 ≈ 15.6px, 배지 중심 = mt+15 → mt 0.6 → 정수 반올림 1(소수 금지). center는 그리드 중앙이라 mt 0.
  const alignMode = React.useMemo(() => {
    if (!import.meta.env.DEV) return "auto";
    try { const p = new URLSearchParams(window.location.search).get("align"); return (p === "center" || p === "top") ? p : "auto"; } catch { return "auto"; }
  }, []);
  // 다행 판정: 부속 줄(sub·넣기·용량·가이드·대체·링크·노드·이동안내)이 하나라도 있으면 다행. 모델 행은 항상 다행.
  const rowMultiLine = (r) => r.kind === "model" || !!(r.sub || r.guides?.length || r.alternatives?.length || r.exclusions?.length || r.links?.length || r.nodes?.length || r.diagLink);
  const renderActionRow = (r, first, dim, variant = "fill") => {
    const align = alignMode === "auto" ? (rowMultiLine(r) ? "top" : "center") : alignMode;
    const mis = r.kind === "model" ? reconcile?.byFile?.get(r.planItem?.selectedFile)?.misplaced : null; // 6-3 위치 불일치
    return (
    <React.Fragment key={r.rid}>
      {/* 구분선: 판단근거 체계와 동일 — 라운드 박스 좌우 여백 인셋(100% 가로지르기 금지), 색·두께 동일 토큰 */}
      {!first && <div style={{ borderTop: `1px solid ${C.divider}`, marginLeft: 18, marginRight: 18 }} />}
      {/* 여백1: 첫 행만 상단 패딩 +10(14→24) — 긴 제목 답답함 해소. 행 간 규칙(구분선·14px) 무변. */}
      <div style={{ display: "grid", gridTemplateColumns: "34px 50px minmax(0,1fr) auto", gap: 12, alignItems: align === "center" ? "center" : "start", padding: first ? "24px 18px 14px" : "14px 18px", opacity: dim ? 0.55 : 1 }}>
      <NumBadge n={r.n} variant={variant} mt={align === "center" ? 0 : 1} />
      {/* #2 라벨 정렬: 라벨(verb)을 배지와 한 몸으로 — 배지 높이(30px)와 같은 lineHeight 밴드 + 동일 mt(광학 보정). 다행 top·단행 center에서 배지·라벨이 제목 첫 줄과 동일 기준선. */}
      <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.text, lineHeight: "30px", marginTop: align === "center" ? 0 : 1 }}>{r.verb}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: SANS, fontSize: 23, fontWeight: 650, letterSpacing: "-0.01em", color: r.kind === "gpuhint" ? C.faint : C.text, overflowWrap: "anywhere", lineHeight: 1.3 }}>{r.kind === "model" && r.planItem?.promoted ? <><span style={{ fontFamily: MONO }}>{r.planItem.promoted.filename}</span><span style={{ fontSize: 13, color: C.point, marginLeft: 8 }}>[확정]</span> <span style={{ fontSize: 13, color: C.point }}>· {r.planItem.promoted.reason}</span></> : <>{r.text}{r.kind === "model" && r.badge && <span style={{ fontSize: 13, color: r.badge === "확정" ? C.point : r.badge === "워크플로우 안내" ? C.memoBright : r.badge === "추정 후보" ? C.dim : C.faint, marginLeft: 8 }}>[{r.badge}]</span>}</>}{dim && <span style={{ fontSize: 13, color: C.green, marginLeft: 8 }}>이미 있음</span>}</div>
        {(r.file || r.sub) && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{r.file && <span style={{ fontFamily: MONO }}>{r.file}</span>}{r.file && r.sub ? " · " : ""}{r.sub}</div>}
        {/* 작업2: 로그로 확인된 설치 팩(설치 행에서 제외) — dim 부속 줄. 모델 '이미 있음' 문법과 동일 톤. */}
        {r.kind === "install" && r.installedNames?.length > 0 && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>이미 설치됨: {r.installedNames.map((n, i) => <span key={i}>{i > 0 ? ", " : ""}<span style={{ fontFamily: MONO }}>{n}</span></span>)}</div>}
        {/* 작업1: 로그 미유입 시 노드 대조 유도(모델 폴더 스캔 유도와 평행 톤). */}
        {r.kind === "install" && r.logHint && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>ComfyUI 시작 로그를 붙여넣으면 이미 설치된 노드팩은 걸러 드립니다.</div>}
        {/* 수리1(b): 로그는 있으나 Import 블록이 없어 대조 불가. 무엇을 더 붙여야 하는지 명시. */}
        {r.kind === "install" && r.logMissingBlock && <div style={{ fontFamily: SANS, fontSize: 14, color: C.point, marginTop: 4, lineHeight: 1.5 }}>붙여넣은 로그에 노드 설치 목록이 없습니다. 시작 로그 앞부분의 "Import times for custom nodes" 블록까지 포함해 주세요.</div>}
        {/* 2c: 확인 필요 항목 공통 부속 — 다음 행동(LLM 진단) 안내. */}
        {r.kind === "model" && r.badge === "확인 필요" && !r.planItem?.placeholder && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>LLM 진단받기로 넘기면 출처를 함께 찾아드립니다.</div>}
        {/* 작업3-1·3-2: 자리표시자 발화(휴리스틱 또는 카탈로그 note). 웹검색 대신 계열 안내·드롭다운 직접 선택 유도. */}
        {r.kind === "model" && r.planItem?.placeholder && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{r.planItem.reason}</div>}
        {mis && <div style={{ fontFamily: SANS, fontSize: 14, color: C.memoBright, marginTop: 4, lineHeight: 1.5 }}>파일은 있으나 위치가 다릅니다. 현재 <span style={{ fontFamily: MONO }}>{mis.current}</span>에 있습니다. <span style={{ fontFamily: MONO }}>{mis.required}</span> 폴더로 이동해 주세요.</div>}
        {mis && <div style={{ fontFamily: SANS, fontSize: 13, color: C.faint, marginTop: 3, lineHeight: 1.5 }}>이름이 같은 다른 모델일 수 있습니다. 이동 전 용량·출처를 확인해 주세요.</div>}
        {/* 표기 변형 후보(하이픈/언더스코어만 다른 보유 파일). 확정 금지·후보 제시, 다운로드 처방과 병기. 에러로그 'PC에 있는 후보'와 톤 통일. */}
        {r.kind === "model" && (() => { const vcs = reconcile?.byFile?.get(r.planItem?.selectedFile)?.variantCandidates; return vcs?.length ? <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>보유 파일 중 표기만 다른 후보가 있습니다: {vcs.map((v, i) => <span key={i}>{i > 0 ? ", " : ""}<span style={{ fontFamily: MONO, color: C.point }}>{v}</span></span>)}. 같은 모델이면 로더 드롭다운에서 이 파일을 선택해 주세요.</div> : null; })()}
        {r.kind === "model" && (r.planItem?.promoted ? [r.planItem.promoted.fullPath || r.planItem.promoted.folder] : r.folders)?.filter(Boolean).length > 0 && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.45 }}>넣기: {(r.planItem?.promoted ? [r.planItem.promoted.fullPath || r.planItem.promoted.folder] : r.folders).map((f, fi) => <span key={fi} style={{ fontFamily: MONO }}>{fi > 0 ? ", " : ""}{f}</span>)}</div>}
        {r.kind === "model" && r.selects.map((sel, si) => <div key={si} style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.45 }}>선택: {sel.nodeType}: <span style={{ fontFamily: MONO }}>{sel.value}</span></div>)}
        {r.kind === "model" && (r.planItem?.promoted?.size || r.planItem?.size || r.planItem?.sourceRepo) && <div style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.45 }}>{(r.planItem.promoted?.size || r.planItem.size) ? `용량 ${r.planItem.promoted?.size || r.planItem.size}` : ""}{(r.planItem.promoted?.size || r.planItem.size) && r.planItem.sourceRepo ? " · " : ""}{r.planItem.sourceRepo ? <>출처 <span style={{ fontFamily: MONO }}>{r.planItem.sourceRepo}</span></> : ""}</div>}
        {r.kind === "model" && r.planItem?.vramWarning && !r.planItem?.promoted && <div style={{ fontFamily: SANS, fontSize: 14, color: C.point, marginTop: 4, lineHeight: 1.45 }}>{r.planItem.vramWarning}{r.planItem.noConfirmedAlt && <a className="td-hf td-outline-w" href={searchUrl((r.planItem.selectedFile || "").replace(/\.[^.]+$/, "") + " gguf")} target="_blank" rel="noopener noreferrer" style={{ padding: "1px 8px", fontSize: 12, marginLeft: 8 }}>저용량 버전 검색 ↗</a>}</div>}
        {r.kind === "model" && r.planItem?.renameHint && !r.planItem?.promoted && <div style={{ fontFamily: SANS, fontSize: 14, color: C.memoBright, marginTop: 4, lineHeight: 1.45 }}>{r.planItem.renameHint}</div>}
        {r.kind === "model" && r.planItem?.promoted && <div style={{ fontFamily: SANS, fontSize: 13, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>{r.planItem.promoted.originLabel || "워크플로우 원 지정값(상위 VRAM용)"}: <span style={{ fontFamily: MONO }}>{r.planItem.promoted.originalFile}</span>{r.planItem.promoted.originalSize ? ` (${r.planItem.promoted.originalSize})` : ""}</div>}
        {r.kind === "model" && r.planItem?.promoted && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{r.planItem.promoted.node}에서 받은 파일로 선택을 바꿔 주세요.</div>}
        {/* 2(판단근거 흡수): 별도 리스트 폐지 → 각 행 1층 접이. 등급·근거·출처만(링크 텍스트, 버튼 중복 0). evidenceBg 계승. */}
        {r.kind === "model" && r.planItem?.reason && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontFamily: SANS, fontSize: 13, color: C.faint, listStyle: "none", display: "inline-block", padding: "2px 0", outline: "none" }}>▸ 근거</summary>
            <div style={{ background: C.evidenceBg, borderRadius: 10, padding: "12px 14px", marginTop: 8, fontFamily: SANS, fontSize: 13.5, color: C.dim, lineHeight: 1.65 }}>
              <div>등급 <span style={{ color: C.text, fontWeight: 600 }}>{r.planItem.badge}</span></div>
              <div style={{ marginTop: 5 }}>{r.planItem.reason}</div>
              {r.planItem.sourceRepo && <div style={{ marginTop: 5, overflowWrap: "anywhere" }}>출처 <span style={{ fontFamily: MONO, color: C.text }}>{r.planItem.sourceRepo}</span></div>}
              {/* 2: 직링크 전문 + 폴백 사유(구 판단근거 항목 복원, 누락 0). */}
              {(() => { const dlu = r.planItem.promoted?.downloadUrl || r.planItem.downloadUrl; return dlu
                ? <div style={{ marginTop: 5, overflowWrap: "anywhere" }}>직링크 <span style={{ fontFamily: MONO, color: C.text }}>{dlu}</span></div>
                : <div style={{ marginTop: 5, color: C.faint }}>직접 다운로드 링크가 확인되지 않아 웹 검색으로 연결됩니다.</div>; })()}
            </div>
          </details>
        )}
        {/* clone 인라인 뷰(보조 동선). 행 1층 접이(내부 추가 접힘 0). install.bat 다운로드가 주 동선. */}
        {r.kind === "install" && r.clones?.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontFamily: SANS, fontSize: 13, color: C.faint, listStyle: "none", display: "inline-block", padding: "2px 0", outline: "none" }}>▸ clone 명령 보기</summary>
            <div style={{ background: C.evidenceBg, borderRadius: 10, padding: "12px 14px", marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {r.clones.map((c, ci) => (
                <div key={ci} style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
                  <code style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 13.5, color: C.text, overflowWrap: "anywhere", lineHeight: 1.4 }}>git clone {c.cloneUrl}</code>
                  <button onClick={() => copy(`git clone ${c.cloneUrl}`, `inst-${r.rid}-${ci}`)} title="명령 복사" style={{ background: "transparent", border: "none", color: C.text, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                    {copiedKey === `inst-${r.rid}-${ci}` ? <Check size={15} /> : <Copy size={15} />}</button>
                </div>
              ))}
            </div>
          </details>
        )}
        {r.kind === "altexcl" && <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {r.alternatives.map((a, ai) => <div key={"a" + ai} style={{ fontFamily: SANS, fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>대체 후보: <span style={{ fontFamily: MONO, color: C.text }}>{a.filename}</span>{a.size ? ` · ${a.size}` : ""} · {a.reason}</div>)}
          {r.exclusions.map((e, ei) => <div key={"e" + ei} style={{ fontFamily: SANS, fontSize: 13.5, color: C.faint, lineHeight: 1.5 }}>받지 말 것: <span style={{ fontFamily: MONO }}>{e.filename}</span> ({e.quant}) · {e.reason}</div>)}
        </div>}
        {r.kind === "authorlinks" && (() => { const seen = new Map(); for (const al of r.links) if (!seen.has(al.url)) seen.set(al.url, al); const uniq = [...seen.values()]; // 파인딩 l: 동일 URL 병합
          // 3: 2개 이상이면 3열 표(안내 텍스트·출처 노드·링크). 일괄 받기 표와 동일 토큰(헤더 faint·행 borderTop). 1개면 현행 한 줄.
          if (uniq.length >= 2) return (
            <div style={{ marginTop: 8, borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) auto", gap: 12, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                {["안내", "출처 노드", "링크"].map((h) => <span key={h} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.faint, textAlign: h === "링크" ? "center" : "left" }}>{h}</span>)}
              </div>
              {uniq.map((al, ai) => (
                <div key={ai} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) auto", gap: 12, padding: "12px 0", alignItems: "center", borderTop: ai > 0 ? `1px solid ${C.divider}` : "none" }}>
                  <span style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, overflowWrap: "anywhere", lineHeight: 1.5 }}>{al.linkLabel || al.label || "제작자 안내"}{al.strength ? <span style={{ color: C.memoBright }}> · 강도 {al.strength}</span> : null}</span>
                  <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, overflowWrap: "anywhere" }}>{al.label && al.label !== al.linkLabel ? al.label : (al.folder ? <span style={{ fontFamily: MONO }}>{al.folder}</span> : "")}</span>
                  <a className="td-hf td-outline-w" href={al.url} target="_blank" rel="noopener noreferrer" style={{ padding: "2px 9px", fontSize: 12, flexShrink: 0 }}>링크 ↗</a>
                </div>))}
            </div>);
          // 3: 1개일 때도 링크 버튼은 행 우측 버튼 영역(타 행 동일 위계). 본문엔 안내 텍스트·출처만.
          return (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 9 }}>{uniq.map((al, ai) => (
            <div key={ai} style={{ fontFamily: SANS, fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <span style={{ color: C.text, fontWeight: 600 }}>제작자 안내</span>
                {al.linkLabel && al.linkLabel !== al.label && <span style={{ color: C.dim }}>{al.linkLabel}</span>}
                {al.strength && <span style={{ color: C.memoBright }}>강도 {al.strength}</span>}
              </div>
              {(al.label || al.folder) && <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{al.label ? `출처: ${al.label}` : ""}{al.label && al.folder ? " · " : ""}{al.folder ? <span style={{ fontFamily: MONO }}>{al.folder}</span> : null}</div>}
            </div>))}</div>); })()}
        {r.kind === "node" && <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{r.nodes.map((nd, ni) => <span key={ni} style={{ fontFamily: MONO }}>{ni > 0 ? " · " : ""}{nd}</span>)}</div>}
        {r.kind === "node" && r.guides && r.guides.map((gd, gi) => <div key={gi} style={{ fontFamily: SANS, fontSize: 14, color: C.dim, marginTop: 6, lineHeight: 1.5, display: "flex", gap: 7 }}><span style={{ color: C.point, flexShrink: 0 }}>{gi + 1}.</span><span>{gd}</span></div>)}
        {/* o + 6-1: 실행 행 부속 줄(재시작 안내·에러 로그 진단 링크) = 본문 대비 명도 50% dim */}
        {r.kind === "run" && r.restartNote && <div style={{ fontFamily: SANS, fontSize: 14, color: C.text, opacity: 0.5, marginTop: 4, lineHeight: 1.5 }}>{r.restartNote}</div>}
        {/* 5: 앞문장 일반(dim), 뒷문장(에러 로그로~)만 언더라인 + 연한 노랑. 앵커 동작 무변. */}
        {r.kind === "run" && r.diagLink && <div style={{ marginTop: 4, fontFamily: SANS, fontSize: 14, lineHeight: 1.5 }}><span style={{ color: C.text, opacity: 0.5 }}>솔루션으로도 해결이 안 되나요? </span><a href="#diagnose-section" onClick={openDiagnose} style={ANCHOR_LINK}>에러 로그로 LLM 진단받기</a></div>}
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {/* 3: 제작자 안내 1개 → 링크 버튼을 우측 버튼 영역(타 행 동일 위계). 2개 이상은 본문 표. */}
        {r.kind === "authorlinks" && (() => { const seen = new Map(); for (const al of r.links) if (!seen.has(al.url)) seen.set(al.url, al); const uniq = [...seen.values()]; return uniq.length === 1 ? <a className="td-hf td-outline-w" href={uniq[0].url} target="_blank" rel="noopener noreferrer">링크 ↗</a> : null; })()}
        {/* bat 버튼 A/B 실물 비교용 임시 배치(확정 시 단일 토큰 통일 예정). 기존 다운로드 버튼(td-hf)과 동일 line 형식, 색만 SAND(A)·LIME(B)로 분리. 화살표 없음. */}
        {/* 라벨은 행동 언어(사용자 확정), 파일명은 부속 dim 줄(r.file). 버튼 형식·A/B 색은 6823048 유지. */}
        {r.kind === "install" && <button className="td-hf-sand" onClick={() => downloadText("install.bat", buildInstallScript(report, "bat", env))}><Download size={15} /> 노드 한 번에 설치</button>}
        {r.kind === "dlscript" && <button className="td-hf-sand" onClick={() => downloadText("download.bat", buildDownloadScript(plan, env, reconcile?.heldSet))}><Download size={15} /> 모델 한 번에 받기</button>}
        {r.kind === "model" && !dim && (() => { const rawUrl = r.planItem?.promoted?.downloadUrl || r.planItem?.downloadUrl; const q = (r.planItem?.selectedFile || r.text || "").replace(/\.[^.]+$/, "").trim();
          if (rawUrl) { const isFile = !/\/tree\//.test(rawUrl); const dlUrl = isFile ? rawUrl.replace("/blob/", "/resolve/") : rawUrl; return isFile
            ? <a className="td-hf" href={dlUrl} target="_blank" rel="noopener noreferrer">다운로드</a>
            : <a className="td-hf td-outline-w" href={rawUrl} target="_blank" rel="noopener noreferrer">링크 ↗</a>; }
          return q && !r.planItem?.placeholder ? <a className="td-hf td-outline-w" href={searchUrl(r.planItem?.selectedFile || r.text)} target="_blank" rel="noopener noreferrer">웹에서 검색 ↗</a> : null; })()}
      </div>
      </div>
    </React.Fragment>
    );
  };

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
        summary::-webkit-details-marker{display:none}summary::marker{content:""}
        .td-copy{transition:opacity .15s;opacity:.85}.td-copy:hover{opacity:1}
        .td-havelink{background:transparent;border:none;color:${C.faint};transition:color .15s;cursor:pointer}.td-havelink:hover{color:${C.text}}
        .td-divtoggle{color:${C.faint};transition:color .15s}.td-divtoggle:hover{color:${C.dim}}
        .td-acc{transition:opacity .15s;opacity:.9}.td-acc:hover{opacity:1}
        .td-spin{animation:tdSpin .9s linear infinite}@keyframes tdSpin{to{transform:rotate(360deg)}}
        .td-hf{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid ${C.point};color:${C.point};background:transparent;border-radius:999px;padding:6px 16px;min-width:76px;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf:hover{background:${C.point};color:${INK}}
        .td-hf-sm{display:inline-flex;align-items:center;justify-content:center;width:280px;max-width:100%;border:1px solid ${C.point};color:${C.point};background:transparent;border-radius:999px;padding:8px 0;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf-sm:hover{background:${C.point};color:${INK}}
        /* 스크립트 받기 버튼 단일 클래스(전 화면 Solution·노드/모델 상세 공통). td-hf 형식 + sand 토큰 + ↓ 아이콘. 색 변경은 C.btnSand 한 곳. gap 7 = 처방전 저장 버튼 일치. */
        .td-hf-sand{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid ${C.btnSand};color:${C.btnSand};background:transparent;border-radius:999px;padding:6px 16px;min-width:76px;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf-sand:hover{background:${C.btnSand};color:${INK}}
        /* (비활성 2열 그리드 클래스는 4차에서 제거 — 목록 단일화로 사용처 0) */
        /* 소형4(3차): Solution 접기 펼침 시 토글 줄(summary)도 evidenceBg → 펼침 영역과 한 덩어리(상단과 구분). 접힘 시 무배경. */
        details.td-fold[open]>summary{background:${C.evidenceBg}}
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
      {/* 소형1: 닫힘 상태에서 라이트존(입력+간이 진단)이 짧으면 경계선이 화면 중턱에 뜨는 문제 → min-height 스페이서로 경계를 뷰포트 하단 100px에 고정(position:fixed 금지, 스크롤 자연). 열림·긴 결과는 자연 흐름(무회귀). */}
      <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "32px 20px", boxSizing: "border-box", position: "relative", zIndex: 1, flexShrink: 0, minHeight: report && !detailOpen ? `calc(100vh - ${DETAIL_ZONE_BOTTOM_OFFSET}px)` : undefined }}>
        {/* 헤더. 로고 */}
        <img src={LOGO} alt="Comfy Teardown" style={{ height: 50, width: "auto", display: "block", marginBottom: 16 }} />
        <p style={{ color: C.dim, fontSize: 16, margin: "0 0 28px", lineHeight: 1.6 }}>실행에 문제 있는 JSON 파일을 첨부하면, 모든 노드를 분석해서 문제점을 진단하고 해결법을 제시합니다.</p>

        {/* A: 2단계 입력 존. 드롭존(단계1)+환경정보(단계2)를 하나의 라운드박스로 묶고 연번 원형 배지(NumBadge)로 단계 표시. */}
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, background: C.surface, overflow: "hidden", position: "relative", zIndex: 1 }}>
          {/* 단계 1: 워크플로우 JSON. 미투입=배지 1 / 분석완료=배지 ✓ + 파일명·분석완료 요약. */}
          <div style={{ padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
              <NumBadge n={report ? null : 1} mt={0} />
              <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: C.text }}>워크플로우 JSON</span>
              {report && <span style={{ fontFamily: SANS, fontSize: 13.5, color: C.dim, minWidth: 0 }}>분석 완료</span>}
            </div>
            {/* 드롭존: 미투입=현행 크기(도구 첫 문장) / 분석완료=1행 축소판(클릭·드롭으로 다른 파일 재분석, '다른 파일' 버튼 통합). */}
            <div className="td-drop"
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
              onClick={report ? () => fileRef.current?.click() : undefined}
              style={{ border: `2px dashed ${C.point}`, background: drag ? C.surfaceHi : C.bg,
                borderRadius: 12, padding: report ? "13px 16px" : "26px 22px", display: "flex", alignItems: "center", gap: report ? 12 : 18, flexWrap: "wrap", cursor: report ? "pointer" : "default" }}>
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
              <div style={{ width: report ? 34 : 44, height: report ? 34 : 44, borderRadius: report ? 9 : 12, background: C.surfaceHi, display: "grid", placeItems: "center", border: `1px solid ${C.line}`, flexShrink: 0 }}>
                <Upload size={report ? 16 : 19} color={C.point} strokeWidth={1.9} /></div>
              {report ? (
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 15 }}>
                  <span style={{ color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{report.source}</span>
                  <span style={{ color: C.dim, whiteSpace: "nowrap", flexShrink: 0 }}>· 다른 파일을 올리면 다시 분석합니다</span>
                </div>
              ) : (<>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>workflow.json을 끌어다 놓기</div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>ComfyUI에서 내보낸 UI/API 포맷 모두 지원</div>
                </div>
                {/* 두 버튼은 별도 래퍼로 묶어 gap 13(기존 26의 절반)만 적용. 부모 gap 18과 분리 */}
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <button className="td-btn td-outline" onClick={() => fileRef.current?.click()}
                    style={{ borderRadius: 999, padding: "10px 20px", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>파일 선택</button>
                  <button className="td-btn td-outline-w" onClick={() => run(JSON.stringify(SAMPLE_WORKFLOW), "샘플 · Rig+Anim 파이프라인")}
                    style={{ borderRadius: 999, padding: "10px 18px", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>샘플 보기</button>
                </div>
              </>)}
            </div>
          </div>
          {/* 단계 2: 내 환경 정보. 배지 좌·토글 우(NumRow 문법). 미입력=배지 2 amber톤+완화 경고 / 입력=배지 ✓+환경 요약 강조(어제 승격 표기). */}
          <div id="env-step" style={{ borderTop: `1px solid ${C.divider}`, padding: "20px 22px", scrollMarginTop: 16 }}>
            <div onClick={() => setEnvOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
              {(() => { const hasEnv = !!(env.gpu || env.torch || env.cuda || env.modelRoot); return <NumBadge n={hasEnv ? null : 2} accent={hasEnv ? undefined : C.amber} mt={0} />; })()}
              <div style={{ flex: 1, minWidth: 0 }}>
                {envOpen ? (
                  <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: C.text }}>내 환경 정보</span>
                ) : (env.gpu || env.torch || env.cuda || env.modelRoot) ? (
                  <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.5, overflowWrap: "anywhere" }}>내 환경 정보<span style={{ color: C.point, marginLeft: 8 }}>{[env.gpu, env.torch && `torch ${env.torch}`, env.cuda && `CUDA ${env.cuda}`, env.modelRoot].filter(Boolean).join(" · ")}</span></span>
                ) : (
                  <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: C.amber, lineHeight: 1.5 }}>내 환경 정보 미입력 <span style={{ color: C.dim, fontWeight: 400 }}>· 보유 파일 대조를 건너뜁니다. 입력하면 이미 가진 파일을 걸러 드립니다.</span></span>
                )}
              </div>
              <button className="td-acc" onClick={(e) => { e.stopPropagation(); setEnvOpen((v) => !v); }} aria-label="펼치기/접기"
                style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                {envOpen ? <Minus size={26} strokeWidth={2.25} /> : <Plus size={26} strokeWidth={2.25} />}
              </button>
            </div>
            {envOpen && (
              <div className="td-fade" style={{ marginTop: 16 }}>
              {/* ① ComfyUI 로그 붙여넣기 (기본 경로, 단독 노출). 좌측 터미널 라인 아이콘. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Terminal size={17} color={C.dim} style={{ flexShrink: 0 }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>ComfyUI 로그 붙여넣기</div>
              </div>
              <div style={{ fontSize: 15, color: C.dim, marginBottom: 10, lineHeight: 1.55 }}>ComfyUI를 실행한 터미널(서버 콘솔)의 내용을 처음부터 끝까지 전체 복사해 붙여넣어 주세요. GPU, torch, CUDA, 설치된 노드팩을 파악합니다.</div>
              <textarea value={envLog} onChange={(e) => onEnvLog(e.target.value)} spellCheck={false}
                placeholder="ComfyUI 시작 콘솔 로그 전체를 붙여넣으세요. GPU·경로·설치된 노드를 자동으로 읽습니다."
                style={{ width: "100%", minHeight: 110, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", color: C.text, fontFamily: MONO, fontSize: 13, lineHeight: 1.6, resize: "vertical", boxSizing: "border-box" }} />
              {logInfo && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#8BC34A", lineHeight: 1.5 }}>
                  로그에서 확인됨: GPU {logInfo.platform === "mac" ? "Mac (CUDA 없음)" : (logInfo.gpu || "확인 안 됨")} · 경로 {logInfo.modelRoot ? `${logInfo.modelRoot} (직접 입력)` : (logInfo.basePath || "확인 안 됨")} · 설치 팩 {logInfo.packN}개{logInfo.failN > 0 ? ` · 로드 실패 ${logInfo.failN}개` : ""}
                </div>
              )}
              {/* u(1): Mac(Darwin) 판정 발화 — GPU·CUDA 판정 미적용 고지. */}
              {logInfo?.platform === "mac" && (
                <div style={{ marginTop: 8, fontSize: 13, color: C.dim, lineHeight: 1.55, background: C.evidenceBg, borderRadius: 8, padding: "9px 12px" }}>
                  Mac (Apple Silicon · CUDA 없음) 환경으로 확인했습니다. GPU·CUDA 기반 판정(양자화 호환·대체 후보)은 적용하지 않습니다.
                </div>
              )}
              {/* u(3): GPU 추출 실패 발화(로그는 있으나 GPU 미검출·Mac 아님). 오탐 대신 재복사 유도. */}
              {logInfo && logInfo.platform !== "mac" && !logInfo.gpu && (
                <div style={{ marginTop: 8, fontSize: 13, color: C.point, lineHeight: 1.55, background: "rgba(244,255,117,0.08)", border: `1px solid ${C.point}55`, borderRadius: 8, padding: "9px 12px" }}>
                  로그에서 GPU 정보를 찾지 못했습니다. ComfyUI를 실행한 터미널(서버 콘솔)의 시작 부분부터 복사해 주세요. 브라우저 F12 콘솔이 아닙니다.
                </div>
              )}
              {logInfo?.truncated && (
                <div style={{ marginTop: 8, fontSize: 13, color: C.point, lineHeight: 1.55, background: "rgba(244,255,117,0.08)", border: `1px solid ${C.point}55`, borderRadius: 8, padding: "9px 12px" }}>
                  로그가 시작 단계에서 잘린 것 같습니다. ComfyUI가 완전히 켜진 뒤 전체를 다시 복사하면 설치된 노드까지 판정해 드립니다.
                </div>
              )}
              {/* 작업1-3: 로그 파일 대안 — 로그에서 실경로 확보(env.logPath) 시에만. 추상 안내 금지. 텍스트 파일 드래그 수용은 드롭존 JSON 전용이라 이번 범위 밖(경로+복사행만). */}
              {env.logPath && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, marginBottom: 5 }}>로그 파일로 대신하기</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, borderRadius: 8, padding: "8px 11px" }}>
                    <code style={{ fontFamily: MONO, fontSize: 13, color: C.text, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{env.logPath}</code>
                    <button onClick={() => copy(env.logPath, "logpath")} title="경로 복사" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: C.point, flexShrink: 0 }}>{copiedKey === "logpath" ? <Check size={14} /> : <Copy size={14} />}</button>
                  </div>
                </div>
              )}

              {/* 작업1-2: 직접 선택·폴더 대조는 '다른 방법으로 입력' 접이로. 기본 경로(로그)와 시각 분리(marginTop 20 + 구분선). 기존 접기 문법. */}
              <div style={{ marginTop: 20, borderTop: `1px solid ${C.divider}`, paddingTop: 14 }}>
                <button onClick={() => setAltOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, width: "100%", textAlign: "left" }}>
                  {altOpen ? <Minus size={15} color={C.dim} style={{ flexShrink: 0 }} /> : <Plus size={15} color={C.dim} style={{ flexShrink: 0 }} />}
                  <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: C.text }}>다른 방법으로 입력</span>
                  <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>직접 선택 · 폴더 대조</span>
                </button>
                {altOpen && (<div className="td-fade" style={{ marginTop: 14 }}>

              {/* ② 직접 선택 (슬라이더 아이콘 섹션) */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <SlidersHorizontal size={15} color={C.dim} style={{ flexShrink: 0 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>직접 선택</div>
                </div>
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

              {/* 소형1(4차): 명령어로 확인하는 법 — '또는 직접 선택' 바로 아래(나온 값을 위 칸에 입력). Mac 판정 시 미노출(CUDA 무관). 대조 구역 하단에서 이설. */}
              {env.platform !== "mac" && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => setCmdOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: C.faint, fontFamily: SANS, fontSize: 13 }}>
                    <CircleAlert size={13} /> 명령어로 확인하는 법</button>
                  {cmdOpen && (
                    <div className="td-fade" style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.55, marginBottom: 8 }}>ComfyUI가 쓰는 파이썬 환경에서 실행하면 torch·CUDA 버전이 나옵니다. ComfyUI 폴더에서 <span style={{ fontFamily: MONO, color: C.text }}>source venv/bin/activate</span> (Windows: <span style={{ fontFamily: MONO, color: C.text }}>{"venv\\Scripts\\activate"}</span>) 실행 후 아래 명령을 입력하고, 나온 값을 위 칸에 입력해 주세요.</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                    </div>
                  )}
                </div>
              )}

              {/* 작업1-2: 폴더 대조 구획 헤더(좌측 폴더 아이콘). OS 토글·모델 폴더 경로·대조가 이 헤더 아래로. */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.divider}`, marginBottom: 4 }}>
                <FolderOpen size={15} color={C.dim} style={{ flexShrink: 0 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>폴더 대조</div>
              </div>
              {/* 1: OS 토글 승격 — '내 PC 환경' 독립 줄. 경로 placeholder·드라이브 조립·대조 스니펫이 이 값(scanOs)을 상속(위치만 이동, 로직 무변). ②-c에서 이설. */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>내 PC 환경</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[{ k: "win", l: "Windows" }, { k: "unix", l: "Mac · Linux" }].map((o) => (
                    <button key={o.k} onClick={() => setScanOs(o.k)} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${scanOs === o.k ? C.point : C.line}`, background: scanOs === o.k ? "rgba(244,255,117,0.10)" : "transparent", color: scanOs === o.k ? C.point : C.dim }}>{o.l}</button>
                  ))}
                </div>
              </div>

              {/* ②-b 내 모델 폴더 경로 (파인딩 m: checkpoints·vae가 바로 들어 있는 폴더 = 받기 절대 경로 기준) */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.divider}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>내 모델 폴더 경로 (선택)</div>
                <div style={{ fontSize: 13, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>폴더 안을 확인하지는 않습니다. 넣기 경로와 받기 스크립트를 내 PC 실제 경로로 완성해 줍니다. checkpoints·vae 폴더가 바로 들어 있는 상위 폴더를 입력해 주세요.</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* 파인딩 s: Windows 토글에서만 드라이브 셀렉트(폴더 버튼이 폴더명만 주므로 조립용). 기본 C. */}
                  {scanOs === "win" && (
                    <select value={scanDrive} onChange={(e) => { const d = e.target.value; setScanDrive(d); setEnv((p) => p.modelRootAssembled ? { ...p, modelRoot: swapDriveLetter(p.modelRoot, d) } : p); }} title="드라이브"
                      style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 6px", color: C.text, fontFamily: MONO, fontSize: 13, boxSizing: "border-box", flexShrink: 0, cursor: "pointer" }}>
                      {["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"].map((d) => <option key={d} value={d}>{d}:</option>)}
                    </select>
                  )}
                  <input type="text" value={env.modelRoot} onChange={(e) => { setEnv((p) => ({ ...p, modelRoot: e.target.value, modelRootPartial: false, modelRootAssembled: false })); setFolderPickWarn(false); setFolderPickMac(false); }}
                    placeholder={scanOs === "win" ? "예: D:\\ComfyModels" : "예: /Users/이름/Documents/ComfyUI/models"}
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: MONO, fontSize: 13, boxSizing: "border-box" }} />
                  <button onClick={async () => {
                    try {
                      if (window.showDirectoryPicker) {
                        const handle = await window.showDirectoryPicker();
                        applyPickedFolder(handle.name);
                      } else {
                        const input = document.createElement("input");
                        input.type = "file"; input.webkitdirectory = true;
                        input.onchange = () => { const f = input.files?.[0]; if (f?.webkitRelativePath) applyPickedFolder(f.webkitRelativePath.split("/")[0]); };
                        input.click();
                      }
                    } catch { /* user cancelled */ }
                  }} title="폴더 선택" style={{ background: C.surfaceHi, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 9px", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <FolderOpen size={16} color={C.point} />
                  </button>
                </div>
                {folderPickWarn && <div style={{ fontSize: 13, color: C.point, marginTop: 5, lineHeight: 1.4 }}>모델 종류 폴더가 아니라 그 상위 폴더를 선택해 주세요. checkpoints·vae·loras가 바로 들어 있는 폴더가 필요합니다.</div>}
                {env.modelRootPartial && !folderPickWarn && !folderPickMac && <div style={{ fontSize: 13, color: C.faint, marginTop: 5, lineHeight: 1.4 }}>브라우저 보안상 전체 경로는 직접 입력해 주세요.</div>}
                {/* v: Mac·Linux 토글에서 폴더 선택 시 발화(전체 경로 직접 입력 유도). 입력란은 무변. */}
                {folderPickMac && <div style={{ fontSize: 13, color: C.point, marginTop: 5, lineHeight: 1.5 }}>Mac에서는 전체 경로를 직접 입력해 주세요 (예: /Users/이름/Documents/ComfyUI/models). 폴더 선택으로는 전체 경로를 알 수 없습니다.</div>}
                {/* 2: Mac 경로 홈 누락 방어 — /Documents·/Desktop·/Downloads로 시작하면 홈(/Users/이름) 누락 추정. 판정만(자동 보정·사용자명 추정 금지). */}
                {/^\/(Documents|Desktop|Downloads)\b/i.test(env.modelRoot || "") && <div style={{ fontSize: 13, color: C.point, marginTop: 5, lineHeight: 1.5 }}>홈 경로가 빠진 것 같습니다. /Users/사용자명/Documents/... 형태의 전체 경로를 입력해 주세요.</div>}
              </div>

              {/* ②-c 내 모델 폴더 대조 (P2.7) — 읽기전용 나열 명령 복사 → 붙여넣기 → 요구 모델과 대조 → 완비 판정 */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.divider}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>내 모델 폴더 대조 (선택)</div>
                <div style={{ fontSize: 13, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>아래 명령을 복사해 실행한 뒤 나온 목록을 붙여넣으면, 필요한 모델을 이미 가지고 있는지 대조해 드립니다. 명령은 폴더 안을 읽기만 하며 아무것도 바꾸지 않습니다. (OS는 위 '내 PC 환경' 기준)</div>
                {(() => {
                  // 파인딩 q: 경로 채택 우선순위 = 수동 입력(modelRoot) > 로그 추출(basePath). bat·스니펫 공통.
                  const s = buildScanSnippet(env.modelRoot || env.basePath, scanOs);
                  // 파인딩 n-1: 폴더명만 입력(비절대) → 스니펫 대신 발화. 드라이브 추정 금지.
                  if (s.needsAbsolute) return <div style={{ fontSize: 13, color: C.point, marginBottom: 8, lineHeight: 1.5 }}>전체 경로(예: D:\ComfyModels)를 입력해 주세요. 폴더 이름만으로는 명령을 만들 수 없습니다.</div>;
                  return (<>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.bg, borderRadius: 8, padding: "8px 11px", marginBottom: 6 }}>
                      <code style={{ fontFamily: MONO, fontSize: 13, color: C.text, flex: 1, overflowWrap: "anywhere", lineHeight: 1.55 }}>{s.snippet}</code>
                      <button onClick={() => copy(s.snippet, "scan")} title="명령 복사" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: C.point, flexShrink: 0 }}>{copiedKey === "scan" ? <Check size={14} /> : <Copy size={14} />}</button>
                    </div>
                    {/* 파인딩 n-3: 실행 안내(OS별) + 기본 경로 안내 병기 */}
                    <div style={{ fontSize: 13, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>{scanOs === "win" ? "PowerShell을 열고 붙여넣어 실행해 주세요. 어느 폴더에서 열어도 됩니다." : "터미널에 붙여넣어 실행해 주세요."}{s.usingDefault ? " 지금은 기본 ComfyUI 모델 폴더 기준입니다. 위에 경로를 입력하면 내 모델 폴더 기준으로 만들어 드립니다." : ""}</div>
                  </>);
                })()}
                <textarea value={folderScan} onChange={(e) => setFolderScan(e.target.value)} placeholder="실행 결과 전체를 여기에 붙여넣어 주세요" rows={3}
                  style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: MONO, fontSize: 13, boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }} />
                {(() => {
                  // 파인딩 n-2: 파서 실패(에러 텍스트·목록 아님) 발화. 무반응 금지.
                  const diag = scanInputDiagnosis(folderScan, heldInv.size);
                  if (diag === "error_path") return <div style={{ fontSize: 13, color: C.point, marginTop: 7, lineHeight: 1.5 }}>경로를 찾지 못했다는 에러입니다. 내 환경 정보의 모델 폴더 경로가 실제 위치와 같은지 확인해 주세요.</div>;
                  if (diag === "no_items") return <div style={{ fontSize: 13, color: C.point, marginTop: 7, lineHeight: 1.5 }}>목록을 읽지 못했습니다. PowerShell(또는 터미널)에서 명령이 정상 실행된 결과인지 확인해 주세요. 에러 메시지가 아닌 파일 목록을 붙여넣어야 합니다.</div>;
                  if (!reconcile?.scanned) return null;
                  // 6-2: 상태별 카피(전량/부분/0건). found = 보유+제자리(✓). 완비 배너 있으면 중복 발화 금지(개수만).
                  const total = reconcile.results.length;
                  const found = reconcile.heldSet.size;
                  const misN = reconcile.results.filter((r) => r.misplaced).length;
                  const corruptFiles = reconcile.results.filter((r) => r.corrupt);
                  const corrN = corruptFiles.length;
                  let msg;
                  if (reconcile.complete) msg = `${found}/${total}개 확인됨.${summary?.envComplete ? "" : " 필요한 모델을 모두 가지고 있습니다."}`;
                  else if (found === 0 && misN === 0) msg = `0/${total}개 확인됨. 필요한 모델이 목록에 없습니다. 아래 받기 항목을 진행해 주세요.`;
                  else msg = `${found}/${total}개 확인됨. 아래 목록에서 이미 있음 표시(✓)를 확인해 주세요. 나머지는 받기 항목에 있습니다.`;
                  return (<>
                    <div style={{ fontSize: 13, marginTop: 7, lineHeight: 1.5, color: reconcile.complete ? C.green : C.point }}>
                      {msg}
                      {misN > 0 && <span style={{ color: C.memoBright }}> · 위치 다름 {misN}개(아래 이동 안내 참고)</span>}
                      {corrN > 0 && <span style={{ color: C.red }}> · 크기 이상(파일 깨짐 의심) {corrN}개</span>}
                    </div>
                    {/* 수리2: 크기 이상 파일 명시(개수만 → 파일별 보유/기대 용량 + 행동). 복수면 전부. */}
                    {corrN > 0 && <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {corruptFiles.map((r, i) => <div key={i} style={{ fontSize: 13, color: C.red, lineHeight: 1.5 }}><span style={{ fontFamily: MONO }}>{r.file}</span> · 보유 {fmtBytes(r.parsedSize)} / 기대 {r.expected || "확인 불가"} · 삭제 후 재다운로드 권장</div>)}
                    </div>}
                  </>);
                })()}
              </div>

              {/* ③ 명령어 안내는 소형1(4차)에서 '또는 직접 선택' 바로 아래로 이설. */}
                </div>
              )}
              </div>
              </div>
            )}
          </div>
        </div>

        {err && (<div className="td-fade" style={{ marginTop: 16, background: "rgba(239,83,80,0.08)", border: `1px solid ${C.red}55`, borderRadius: 12, padding: "13px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <CircleAlert size={17} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 14, lineHeight: 1.55 }}>{err}</span></div>)}

        {report && (<SectionBoundary><div className="td-fade">
          {/* ══ 처방전 (첫 화면). 기존 데이터(unmapped·recipesEnriched)에서 '할 일'만 뽑은 체크리스트 ══ */}
          <div style={{ marginTop: 40 }}>
            {summary && (() => {
              const gc = summary.grade === "red" ? C.red : summary.grade === "yellow" ? C.point : C.green;
              const gbg = summary.grade === "red" ? "rgba(239,83,80,0.08)" : summary.grade === "yellow" ? "rgba(244,255,117,0.08)" : "rgba(193,191,186,0.08)";
              return (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, border: `1px solid ${gc}`, background: gbg, borderRadius: 14, padding: "14px 20px", marginBottom: 20 }}>
                {summary.envComplete
                  ? <Check size={18} color={gc} style={{ flexShrink: 0 }} />
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={gc} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>}
                <span style={{ fontSize: 15, fontWeight: 700, color: gc, lineHeight: 1.5 }}>{summary.diagLine}</span>
              </div>);
            })()}
            {/* 3-2: 배너 하단 "에러 로그 진단" 링크 제거 → 실행 행 부속 줄로 이동(디아그노시스 앵커 유지) */}
            {summary?.valueCauses && (
              <div style={{ marginTop: 10, marginBottom: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.5 }}>원인 후보:</div>
                {summary.valueCauses.map((c, ci) => <div key={ci} style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.5, display: "flex", gap: 7 }}><span style={{ color: C.point, flexShrink: 0 }}>{ci === 0 ? "①" : "②"}</span><span>{c}</span></div>)}
              </div>
            )}
            {summary?.foreignErrors > 0 && (
              <div style={{ marginTop: 8, marginBottom: 16, fontSize: 13, color: C.faint, lineHeight: 1.5 }}>다른 워크플로우 실행의 오류로 보입니다 ({summary.foreignErrors}건). 이 워크플로우 판정에서는 제외했습니다.</div>
            )}
            {revisit && summary?.valueFindings?.length > 0 && (
              <div style={{ marginTop: 8, marginBottom: 18, background: C.surface, border: `1px solid ${C.divider}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>진단 결과: ComfyUI가 거부한 값</div>
                {summary.valueFindings.map((f, fi) => <div key={fi} style={{ fontSize: 13.5, color: C.dim, marginTop: 5, lineHeight: 1.5 }}><span style={{ fontFamily: MONO }}>{f.widget}</span> = <span style={{ fontFamily: MONO, color: C.red }}>{f.required}</span>{f.best ? <> · PC에 있는 후보: <span style={{ fontFamily: MONO, color: C.point }}>{f.best}</span></> : " · 폴더에 없거나 이름이 다릅니다"}</div>)}
                <div style={{ marginTop: 8 }}><a href="#diagnose-section" onClick={scrollToDiagnose} style={{ fontSize: 13, color: C.dim, textDecoration: "underline", cursor: "pointer" }}>전체 에러 로그 진단 보기</a></div>
              </div>
            )}
            {summary && (summary.grade === "yellow" || summary.grade === "green") && !errlog?.trim() && (
              <div style={{ fontSize: 13, color: C.dim, marginTop: 8, marginBottom: 20, lineHeight: 1.5 }}>에러 로그를 붙여넣으면 실행 시 값 오류까지 판정해 드립니다.</div>
            )}
            {rxTodos.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 22, marginTop: 40 }}>
              <div style={{ minWidth: 0 }}>
                <h2 id="solution-header" style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1, scrollMarginTop: 16 }}>Solution</h2>
              </div>
              {/* B: 제목 행 우측 · 처방전 버튼 왼쪽 = 진단 기준 환경 요약. 배경·테두리 없이 텍스트만(입력=C.point 요약·경로부터 말줄임 / 미입력=amber '지금 채우기'→ 입력 존 단계2). */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
                {(() => {
                  const spec = [env.gpu, env.torch && `torch ${env.torch}`, env.cuda && `CUDA ${env.cuda}`].filter(Boolean).join(" · ");
                  const p = env.modelRoot;
                  return (spec || p) ? (
                    <div title="이 진단의 기준 환경" style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%", minWidth: 0, fontFamily: SANS, fontSize: 13.5, lineHeight: 1.4 }}>
                      {spec && <span style={{ color: C.point, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{spec}</span>}
                      {p && <span style={{ color: C.point, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{spec ? " · " : ""}{p}</span>}
                    </div>
                  ) : (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontFamily: SANS, fontSize: 13.5, lineHeight: 1.4 }}>
                      <span style={{ color: C.amber }}>환경 미입력 · 보유 대조 생략됨 ·</span>
                      <span onClick={goFillEnv} style={{ ...ANCHOR_LINK }}>지금 채우기</span>
                    </div>
                  );
                })()}
                <button className="td-btn td-outline-w" onClick={saveReport} title="처방전을 Markdown(.md) 파일로 저장"
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "8px 16px", fontFamily: SANS, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                  <Download size={15} /> 처방전 저장 (.md)</button>
              </div>
            </div>
            )}

            {/* 당장 할 일. 액션 테이블(동사 선행). 근거는 각 행 "근거" 접이. 총론은 아래 판단 기준 안내. 5: 처방 다시 보기 토글 제거 → 상시 노출. */}
            {rxTodos.length > 0 && (
              <div style={{ background: C.surface, border: SOLUTION_STROKE, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
                {rxGroups.primary.map((r, ri) => renderActionRow(r, ri === 0, false, "fill"))}
                {rxGroups.heldDim.length > 0 && <div id="rx-held-anchor" style={{ scrollMarginTop: 90 }} />}
                {rxGroups.heldDim.map((r) => renderActionRow(r, false, true, "line"))}
                {rxGroups.otherGroup.length > 0 && (() => { const gts = [...new Set(rxGroups.otherGroup.map((r) => r.groupTitle).filter(Boolean))]; return (
                  <details className="td-fold" style={{ borderTop: `1px solid ${C.divider}` }}>
                    <summary style={{ cursor: "pointer", fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: C.dim, padding: "13px 18px", listStyle: "none", textAlign: "center" }}>▸ 다른 그룹용 {rxGroups.otherGroup.length}개{gts.length ? ` · ${gts.join(", ")}` : ""} (현재 bypass된 그룹의 모델)</summary>
                    <div style={{ background: C.evidenceBg }}>{rxGroups.otherGroup.map((r) => renderActionRow(r, false, false, "line"))}</div>
                  </details>); })()}
                {rxGroups.refInfo.length > 0 && (
                  <details className="td-fold" style={{ borderTop: `1px solid ${C.divider}` }}>
                    <summary style={{ cursor: "pointer", fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: C.dim, padding: "13px 18px", listStyle: "none", textAlign: "center" }}>▸ 참고 · 미확정 {rxGroups.refInfo.length}개 (대체 후보 · 제작자 안내 · 확인 필요)</summary>
                    <div style={{ background: C.evidenceBg }}>{rxGroups.refInfo.map((r) => renderActionRow(r, false, false, "line"))}</div>
                  </details>
                )}
              </div>
            )}

            {/* 2(판단근거 흡수): 별도 per-model 리스트 폐지 → 각 행 "근거" 접이로 흡수. 여긴 총론(판단 기준)만. clone 스크립트는 설치 행 install.bat 다운로드로 보존. */}
            {rxTodos.length > 0 && (
            <details id="rx-detail" className="td-fade" style={{ marginTop: 8 }} open={rxDetailOpen} onToggle={(e) => setRxDetailOpen(e.currentTarget.open)}>
              <summary style={{ cursor: "pointer", fontFamily: SANS, fontSize: 13, fontWeight: 600, color: C.faint, padding: "10px 0", listStyle: "none", textAlign: "center" }}>▸ 판단 기준 안내</summary>
              <div style={{ background: C.evidenceBg, border: `1px solid ${C.divider}`, borderRadius: 12, padding: "16px 18px", marginTop: 8, fontFamily: SANS, fontSize: 13.5, color: C.dim, lineHeight: 1.75 }}>
                <div>· 등급은 확정(검증된 카탈로그에 실존) · 워크플로우 안내(제작자 제공) · 추정 후보 · 확인 필요 순입니다. 각 행의 "근거"에서 파일별 등급과 출처를 확인하실 수 있습니다.</div>
                <div style={{ marginTop: 8 }}>· GPU와 VRAM을 입력하시면 그 기준으로 양자화 호환과 대체 후보를 판정합니다. 입력이 없으면 확정 판정을 하지 않습니다.</div>
                <div style={{ marginTop: 8 }}>· 콘솔 로그를 붙여넣으시면 설치 상태와 본체 버전을 실제 로그와 대조합니다.</div>
                <div style={{ marginTop: 8 }}>· 이 도구는 PC 안의 파일을 직접 보지 못합니다. 폴더 대조는 붙여넣으신 목록을 기준으로 합니다.</div>
              </div>
            </details>
            )}

            {/* o: 재시작 안내 각주 제거 → 실행 행 부속 줄로 편입. 하단 여백만 유지. */}
            <div style={{ marginBottom: 90 }} />
          </div>
        </div></SectionBoundary>)}
        {!report && !err && (<div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "0 20px 40px", boxSizing: "border-box", textAlign: "center", color: C.faint, fontSize: 13 }}>
          <Boxes size={26} strokeWidth={1.25} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 10 }}>파일을 올리거나 "샘플로 보기"로 시작하세요.</div></div>)}
      </div>

      {report && (
        <div style={{ flex: 1, position: "relative", width: "100%", background: C.bgDeep, display: "flex", flexDirection: "column" }}>
          {/* ── 경계 divider: 존 컨테이너의 top edge에 absolute 걸침(translateY -50%). 텍스트가 라인에 수직 중앙, 배경 투명(상반부 밝은/하반부 어두운). 부모(존) 폭 기준 full-bleed(100vw 아님 → 가로 스크롤 없음). ── */}
          <div id="detail-toggle" onClick={toggleDetail} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: "translateY(-50%)", scrollMarginTop: 16, display: "flex", alignItems: "center", cursor: "pointer", zIndex: 2 }}>
            <div style={{ flex: 1, borderTop: `3px dashed ${C.divider}` }} />
            <div className="td-divtoggle" style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: SANS, fontSize: 21, fontWeight: 600, flexShrink: 0, padding: "0 12px" }}>
              <span>자세한 진단 보기</span>
              {detailOpen ? <Minus size={21} /> : <Plus size={21} />}
            </div>
            <div style={{ flex: 1, borderTop: `3px dashed ${C.divider}` }} />
          </div>
          <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "36px 20px 0", boxSizing: "border-box", flex: 1, display: "flex", flexDirection: "column" }}>

          {detailOpen && (<div className="td-fade">
          {/* 소형2(2차): 펼침 스크롤 착지점은 위 #detail-toggle(토글 줄). Summary는 그 바로 아래로 이어짐. */}
          {/* Summary. 아래 Solution과의 구분선 제거(borderBottom 없음) */}
          {summary && (
            <div style={{ marginTop: 29, paddingBottom: 48 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, margin: "0 0 28px", flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>Summary</h2>
              </div>
              {/* 1(확정): Summary는 카드만(문장형 줄 0). 입력·출력 영문화. 샘플러·CFG·배치·파이프라인·비활성은 자세한 진단(노드/모델 상세)으로 이동. 값 미추출 미노출(날조 금지). */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(124px,1fr))", gap: 10, margin: "0 0 24px" }}>
                <MetricBox value={report.totalNodes} label="전체 노드" unit="개" />
                <MetricBox value={report.customPackTotal} label="커스텀 pack" unit="개" />
                {(() => { const ss = report.structSummary; if (!ss) return null; const kp = ss.keyParams || {}; const io = ss.io || { inputs: [], outputs: [] }; const byp = ss.groups.filter((g) => g.bypassed).length; const en = (x) => ({ "이미지": "Image", "오디오": "Audio", "영상": "Video", "텍스트": "Text" }[x] || x); return (<>
                  {io.inputs.length > 0 && <MetricBox value={io.inputs.map(en).join(" · ")} label="입력" />}
                  {io.outputs.length > 0 && <MetricBox value={io.outputs.map(en).join(" · ")} label="출력" />}
                  {kp.resolution != null && <MetricBox value={kp.resolution} label="해상도" />}
                  {kp.steps != null && <MetricBox value={kp.steps} label="스텝" />}
                  {ss.groups.length > 0 && <MetricBox value={ss.groups.length} label="그룹" unit={`개${byp ? ` (${byp} bypass)` : ""}`} />}
                </>); })()}
              </div>
              {report.authorNotes?.length > 0 && (
                <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${C.divider}` }}>
                  <div onClick={() => toggle("an")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <CircleAlert size={16} color={C.memoBright} style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.memoBright, flex: 1 }}>제작자 주의사항 (워크플로우 메모)</span>
                    <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle("an"); }} aria-label="펼치기/접기"
                      style={{ background: "transparent", border: "none", color: C.memoBright, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                      {open.an ? <Minus size={18} strokeWidth={2.25} /> : <Plus size={18} strokeWidth={2.25} />}
                    </button>
                  </div>
                  {open.an && (
                    <div style={{ marginTop: 10, paddingBottom: 16, paddingLeft: 24, fontSize: 13, color: C.memo, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
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

          {/* ══ Nodes — 커스텀 노드 설치 + 설치 스크립트(방법 A/B, env 우회 하위 구획). 고정 헤더(SectionTitle) + 라운드박스 + 번호 행(우측 +/- · 기본 닫힘). ══ */}
          {(() => {
            const installStep = rx.find((s) => s.key === "install");
            const envStep = rx.find((s) => s.key === "env");
            if (!hasNodeIssues && !installStep && !envStep) return null;
            const envBody = envStep && (<>
              <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.5, marginBottom: 11 }}>{envStep.desc}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {envStep.items.map((it, k) => (
                  <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.surfaceHi, borderRadius: 10, padding: "12px 14px" }}>
                    <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 3 }} />
                    <span style={{ fontSize: 15, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.action}</span>
                  </div>
                ))}
              </div>
            </>);
            return (
            <div style={{ marginTop: 29, paddingBottom: 48 }}>
              <SectionTitle>Nodes</SectionTitle>
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 34px", overflow: "hidden" }}>

                {/* ① 커스텀 노드 설치 — 미매핑·깨진 노드 목록(설치 대상 파악용). */}
                {hasNodeIssues && (
                <NumRow num={1} first title="커스텀 노드 설치" open={open.nd1} onToggle={() => toggle("nd1")}>
                  <div style={{ marginBottom: 4 }}>
                    {[...report.unmapped.map((u) => ({ t: "u", u })), ...report.broken.map((b) => ({ t: "b", b }))].map((it, i) => {
                      const u = it.u, b = it.b;
                      const ghUrl = it.t === "u" ? (u.clone_url ? u.clone_url.replace(/\.git$/, "") : (u.repo ? (u.repo.startsWith("https://") ? u.repo : `https://github.com/${u.repo}`) : null)) : null;
                      return (
                      <React.Fragment key={i}>
                        {i > 0 && <div style={{ borderTop: `1px solid ${C.divider}` }} />}
                        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: i === 0 ? "0 0 16px" : "16px 0" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {it.t === "u" ? (<>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: C.text }}>{u.type}</span>
                                <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>워크플로우 {u.id}번 노드</span>
                              </div>
                              {(u.repo || u.clone_url) ? (() => {
                                const repoEl = <span style={{ fontFamily: MONO, color: C.point }}>{(u.repo || u.clone_url || "").replace("https://github.com/", "").replace(/\.git$/, "")}</span>;
                                return (<>
                                <div style={{ marginTop: 8, fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                                  {u.repoSrc === "prefix" ? <>이 노드를 제공하는 확장으로 {repoEl} 가 추정됩니다.</> : <>이 노드를 제공하는 확장 {repoEl} 가 설치돼 있는지 확인해 주세요.</>}
                                </div>
                                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }}>
                                  {u.repoSrc === "manager" ? "ComfyUI Manager에서 설치할 수 있습니다." : u.repoSrc === "prefix" ? "설치 전 저장소를 확인해 주세요." : "출처 확인된 저장소입니다."}
                                </div>
                                </>);
                              })() : (
                                <div style={{ marginTop: 8, fontSize: 14, color: C.faint, lineHeight: 1.6 }}>출처를 확인할 수 없습니다. ComfyUI Manager에서 노드 이름으로 검색해 주세요.</div>
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
                </NumRow>
                )}

                {/* ② 설치 스크립트 (방법 A · B) — env 우회는 이 행의 하위 구획. installStep 없이 env만이면 제목·본문을 env로. */}
                {(installStep || envStep) && (() => { const n = hasNodeIssues ? 2 : 1; return (
                <NumRow num={n} first={!hasNodeIssues} title={installStep ? "설치 스크립트 (방법 A · B)" : "환경 의존 설정 우회"} open={open.nd2} onToggle={() => toggle("nd2")}>
                  {installStep && (<>
                  <div style={{ fontSize: 15, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>이 노드들을 ComfyUI custom_nodes 폴더에 설치하세요. 해당 폴더에서 git clone (또는 Manager의 Git URL 설치).</div>

                  <div style={{ fontSize: 17, fontWeight: 500, color: C.text, marginTop: 14, marginBottom: 6 }}>custom_nodes 폴더 찾기</div>
                  <div style={{ fontSize: 13, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>내 설치 유형에 맞는 경로를 탐색기/터미널 주소창에 붙여넣으세요.</div>
                  <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 12px", fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
                    {[
                      { os: "Windows", label: "Desktop 앱", path: "%LOCALAPPDATA%\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\custom_nodes" },
                      { os: "Windows", label: "Portable/일반", path: "ComfyUI 설치폴더\\ComfyUI\\custom_nodes" },
                      { os: "macOS/Linux", label: "일반 설치", path: "~/ComfyUI/custom_nodes" },
                    ].map((p, pi) => (
                      <div key={`${p.os}-${p.label}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: pi > 0 ? `1px solid ${C.divider}` : "none" }}>
                        <span style={{ fontSize: 13, color: C.faint, flexShrink: 0, minWidth: 110 }}>{p.os} · {p.label}:</span>
                        <code style={{ fontFamily: MONO, fontSize: 13, color: C.text, overflowWrap: "anywhere", flex: 1, minWidth: 0 }}>{p.path}</code>
                        <button className="td-copy" onClick={() => copy(p.path, `cn-${p.os}-${p.label}`)} title="복사" style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                          {copiedKey === `cn-${p.os}-${p.label}` ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 14, color: C.dim, lineHeight: 1.5 }}>※ macOS/Linux Desktop 앱은 설치 경로가 다를 수 있습니다. 앱 설정에서 ComfyUI 경로를 확인하세요.</div>

                  <div style={{ background: C.surfaceHi, borderRadius: 12, padding: "14px 18px", marginTop: 30, marginBottom: 12 }}>
                    <div style={{ fontSize: 17, fontWeight: 500, color: C.text, marginTop: 4, marginBottom: 8 }}>방법 A. 직접</div>
                    <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>custom_nodes 폴더에서 우클릭해 Git Bash Here(또는 터미널)를 열고, 아래 명령을 붙여넣으세요:</div>
                    {/* 복사 단위 = 값 행(명령 하나씩). CopyRows 단일 문법(전 화면 공통). */}
                    <CopyRows text={installStep.command} keyBase="nd-clone" copy={copy} copiedKey={copiedKey} />
                    {installStep.warn && <div style={{ marginTop: 7, fontSize: 13, color: C.amber, lineHeight: 1.45 }}>⚠ {installStep.warn}</div>}
                  </div>

                  <div style={{ background: C.surfaceHi, borderRadius: 12, padding: "14px 18px" }}>
                    <div style={{ fontSize: 17, fontWeight: 500, color: C.text, marginTop: 4, marginBottom: 8 }}>방법 B. 자동 스크립트</div>
                    <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, marginBottom: 18 }}>아래 스크립트를 custom_nodes 폴더에 넣고 실행하면 노드팩이 일괄 설치됩니다 (초보자 권장 · 반드시 custom_nodes 폴더 안에서 실행).</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                      <button className="td-hf-sand" onClick={() => downloadText("install.bat", buildInstallScript(report, "bat", env))}><Download size={15} /> install.bat (Windows)</button>
                      <button className="td-hf-sand" onClick={() => downloadText("install.sh", buildInstallScript(report, "sh", env))}><Download size={15} /> install.sh (Mac/Linux)</button>
                    </div>
                    {!env.customNodesPath && <div style={{ marginTop: 8, fontSize: 13, color: C.faint, lineHeight: 1.5, textAlign: "center" }}>로그에서 custom_nodes 경로를 찾지 못했습니다. 스크립트 안의 경로를 직접 입력해 주세요. (로그를 붙여넣으면 경로를 채워 드립니다.)</div>}
                    <div style={{ marginTop: 20, fontSize: 13, color: C.dim, lineHeight: 1.65, borderTop: `1px solid ${C.divider}`, paddingTop: 10 }}>
                      <div style={{ fontWeight: 650, color: C.text, marginBottom: 4 }}>설치 확인하는 법</div>
                      <div>· 실행하면 터미널에 "Cloning into …" 또는 "Successfully installed" 메시지가 뜹니다. 에러 시 빨간 글씨가 나옵니다.</div>
                      <div>· 가장 확실한 확인: ComfyUI를 완전히 재시작한 뒤 워크플로우를 다시 로드해서 빨간 노드가 사라졌는지 보세요. 빨간 노드가 없어졌으면 설치 성공.</div>
                      <div>· 설치했는데도 빨간 노드가 남아 있으면, custom_nodes 폴더 안에 해당 노드 폴더가 실제로 생겼는지 확인하세요.</div>
                    </div>
                  </div>

                  {isAdmin && installStep.installNotes && (
                    <div style={{ marginTop: 12, background: "rgba(239,83,80,0.06)", border: `1px solid ${C.red}33`, borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ fontSize: 13, fontWeight: 650, color: C.red, marginBottom: 6 }}>설치 후 주의</div>
                      {installStep.installNotes.map((n, ni) => (
                        <div key={ni} style={{ fontSize: 13, color: C.redMuted, lineHeight: 1.6, marginTop: ni > 0 ? 6 : 0 }}>
                          <span style={{ fontFamily: MONO, fontWeight: 600, color: C.text }}>{n.file}</span>. {n.desc}
                        </div>
                      ))}
                    </div>
                  )}
                  </>)}
                  {/* env 우회 — 설치 스크립트 하위 구획(installStep 있으면 소제목+구분선, env만이면 본문). */}
                  {envStep && (installStep
                    ? <DetailSub title="환경 의존 설정 우회">{envBody}</DetailSub>
                    : envBody)}
                </NumRow>
                ); })()}

              </div>
            </div>);
          })()}

          {/* ══ Models — GPU 점검·양자화 안내(1회) + 한 번에 받기 표(plan 기반·버튼 여기만) + 모델 맞추기 슬롯 표(참조·버튼 0). 고정 헤더(SectionTitle) + 라운드박스 + 번호 행(우측 +/- · 기본 닫힘). ══ */}
          {(() => {
            const quantStep = rx.find((s) => s.key === "quant");
            const dlEligible = (plan?.items || []).filter((it) => { const url = (it.promoted?.downloadUrl || it.downloadUrl) || ""; return (it.confidence === "confirmed" || it.confidence === "workflow_author") && /^https?:\/\//.test(url) && !/\/tree\//.test(url); });
            if (!quantStep && dlEligible.length === 0 && recipesEnriched.length === 0) return null;
            return (
            <div style={{ marginTop: 29, paddingBottom: 48 }}>
              <SectionTitle>Models</SectionTitle>
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 34px", overflow: "hidden" }}>

                {/* ① GPU 점검·양자화 안내 — 1회. 슬롯 표의 행별 비호환 표기(quantBad)는 별도 유지. */}
                {quantStep && (
                <NumRow num={1} first title="GPU 점검·양자화 안내" open={open.md1} onToggle={() => toggle("md1")}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {quantStep.items.map((it, k) => (
                      <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.surfaceHi, borderRadius: 10, padding: "12px 14px" }}>
                        <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 3 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.file}</div>
                          <div style={{ fontSize: 14, fontWeight: 400, color: C.dim, lineHeight: 1.5, overflowWrap: "anywhere", marginTop: 4 }}>{it.desc}</div>
                          {it.gguf && (
                            <div style={{ marginTop: 10, background: C.bg, border: `1px solid ${C.point}55`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
                              <div style={{ fontWeight: 700, color: C.point, marginBottom: 6, fontSize: 14 }}>GGUF 대체 세트 (권장 · 이 GPU에서 안정 동작)</div>
                              <div>{it.gguf.note}</div>
                              {(it.gguf.components || []).map((c, ci) => (
                                <div key={ci} style={{ marginTop: ci > 0 ? 15 : 9, paddingTop: ci > 0 ? 15 : 0, borderTop: ci > 0 ? `1px solid ${C.line}` : "none" }}>
                                  <div style={{ fontWeight: 650, color: C.text, fontSize: 13 }}>{c.role} · <span style={{ fontFamily: MONO, color: C.point }}>{c.folder}</span></div>
                                  {c.files.map((f, fi) => (
                                    <div key={fi} style={{ marginTop: 3, paddingLeft: 12, overflowWrap: "anywhere" }}>· <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: C.point }}>{f.name}</a>{f.size ? <span style={{ color: C.faint }}> ({f.size})</span> : ""}{f.note ? <span style={{ color: C.faint }}>. {f.note}</span> : ""}</div>
                                  ))}
                                </div>
                              ))}
                              {it.gguf.node && <div style={{ marginTop: 15, paddingTop: 15, borderTop: `1px solid ${C.line}` }}>필요 노드: <a href={it.gguf.node.repo} target="_blank" rel="noopener noreferrer" style={{ color: C.point, overflowWrap: "anywhere" }}>{it.gguf.node.name}</a></div>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </NumRow>
                )}

                {/* ② 한 번에 받기 — 출처 확인된 직링크(confirmed·workflow_author)만. 다운로드 버튼은 이 표에만(슬롯 표는 참조). */}
                {dlEligible.length > 0 && (() => { const n = quantStep ? 2 : 1; return (
                <NumRow num={n} first={!quantStep} title="한 번에 받기" open={open.md2} onToggle={() => toggle("md2")}>
                  <div style={{ fontSize: 14, color: C.dim, marginBottom: 14, lineHeight: 1.6 }}>출처가 확인된 파일입니다. 각 파일을 받아 지정 폴더에 넣거나, 아래 스크립트로 한 번에 받으세요.</div>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 66 }}>
                    <button className="td-hf-sand" onClick={() => downloadText("download.bat", buildDownloadScript(plan, env, reconcile?.heldSet))}><Download size={15} /> 모델 한 번에 받기</button>
                  </div>
                  <div style={{ borderTop: `1px solid ${C.divider}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1.3fr) minmax(0,0.7fr) 110px", gap: 14, padding: "11px 0", borderBottom: `1px solid ${C.divider}` }}>
                      {["받을 파일", "넣을 폴더", "용량", "다운로드"].map((h) => <span key={h} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.faint, letterSpacing: "0.03em", textAlign: h === "다운로드" ? "center" : "left" }}>{h}</span>)}
                    </div>
                    {dlEligible.map((it, k) => {
                      const p = it.promoted;
                      const file = p?.filename || it.selectedFile;
                      const folder = (p ? (p.fullPath || p.folder) : (it.fullPath || it.folder)) || "확인 필요";
                      const size = p?.size || it.size;
                      const rawUrl = p?.downloadUrl || it.downloadUrl;
                      const dlUrl = rawUrl.replace("/blob/", "/resolve/");
                      return (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1.3fr) minmax(0,0.7fr) 110px", gap: 14, padding: "13px 0", alignItems: "center", borderTop: k > 0 ? `1px solid ${C.divider}` : "none" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: MONO, fontSize: 14, color: C.text, overflowWrap: "anywhere", lineHeight: 1.4 }}>{file}</div>
                          {p && <div style={{ fontSize: 13, color: C.faint, marginTop: 3, lineHeight: 1.4, overflowWrap: "anywhere" }}>원 지정값: <span style={{ fontFamily: MONO }}>{p.originalFile}</span></div>}
                          {it.sourceRepo && <div style={{ fontSize: 13, color: C.faint, marginTop: 3, overflowWrap: "anywhere" }}>출처 <span style={{ fontFamily: MONO }}>{it.sourceRepo}</span></div>}
                        </div>
                        <div style={{ minWidth: 0, fontFamily: MONO, fontSize: 13, color: folder === "확인 필요" ? C.red : C.point, overflowWrap: "anywhere", lineHeight: 1.45 }}>{folder}</div>
                        <div style={{ minWidth: 0 }}>{size ? <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.text }}>{size}</span> : <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>확인 필요</span>}</div>
                        <div style={{ display: "flex", justifyContent: "center" }}><a className="td-hf" href={dlUrl} target="_blank" rel="noopener noreferrer">다운로드</a></div>
                      </div>);
                    })}
                  </div>
                  <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.6, marginTop: 12 }}>※ 받은 뒤 파일 용량을 위 표와 비교하세요. 수 KB/MB로 작으면 깨진 것이니 삭제 후 다시 받으세요.</div>
                </NumRow>
                ); })()}

                {/* ③ 모델 맞추기 (참조) — 워크플로우가 기록한 슬롯·현재 값·폴더. 참조 전용(버튼 0). 행별 GPU 비호환 표기는 여기 유지. */}
                {recipesEnriched.length > 0 && (() => { const n = (quantStep ? 1 : 0) + (dlEligible.length > 0 ? 1 : 0) + 1; return (
                <NumRow num={n} first={!quantStep && dlEligible.length === 0} title="모델 맞추기 (참조)" open={open.md3} onToggle={() => toggle("md3")}>
                  {/* 설명성 서브카피는 펼침 내용 첫 줄(dim). 접힘 시 제목만 노출(NumRow sub 슬롯 미사용). */}
                  <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, lineHeight: 1.6, marginBottom: 14 }}>모든 로더 노드의 참조 값 기록입니다. 파일 받기는 위 한 번에 받기 표에서 진행해 주세요.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {recipesEnriched.map((r, ri) => (
                      <div key={`${r.type}-${r.id}`} style={{ paddingTop: ri > 0 ? 42 : 0, borderTop: ri > 0 ? `1px solid ${C.divider}` : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                          <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: C.text }}>{r.type}</span>
                          <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>#{r.id}</span>
                          {r.tab && <span style={{ fontFamily: SANS, fontSize: 13, color: C.violet, display: "inline-flex", alignItems: "center", gap: 5 }}>{r.tabColor && <span style={{ width: 9, height: 9, borderRadius: 999, background: r.tabColor, flexShrink: 0 }} />}[탭: {r.tab}]</span>}
                          {r.sub && <span style={{ fontFamily: SANS, fontSize: 13, color: C.violet }}>[서브그래프]</span>}
                          {isAdmin && r.__offset_warning && <span style={{ fontFamily: SANS, fontSize: 13, color: C.amber }}>⚠ offset 보정됨</span>}
                        </div>
                        <div style={{ borderTop: `1px solid ${C.line}` }}>
                          <div style={{ display: "grid", gridTemplateColumns: "24px minmax(0,0.8fr) minmax(0,2fr) minmax(0,1fr)", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                            {["#", "슬롯", "현재 값", "폴더"].map((h) => <span key={h} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.faint }}>{h}</span>)}
                          </div>
                          {r.slots.map((s, si) => (
                            <div key={si}>
                              <div style={{ display: "grid", gridTemplateColumns: "24px minmax(0,0.8fr) minmax(0,2fr) minmax(0,1fr)", gap: 10, padding: "12px 0", alignItems: "center", borderTop: si > 0 ? `1px solid ${C.divider}` : "none", opacity: hasRedInput && s.missing === false ? 0.45 : 1 }}>
                                <span style={{ fontFamily: MONO, fontSize: 14, color: C.faint }}>{si + 1}</span>
                                <span style={{ fontFamily: MONO, fontSize: 14, color: C.dim, overflowWrap: "anywhere" }}>{s.slot}</span>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontFamily: MONO, fontSize: 14, color: s.quantBad ? C.amber : C.text, overflowWrap: "anywhere", lineHeight: 1.4 }}>{s.value}</div>
                                  {s.quantBad && <div style={{ fontFamily: SANS, fontSize: 13, color: C.amber, marginTop: 4, lineHeight: 1.5 }}>이 형식({s.quantFmt})은 이 GPU(Ampere)에서 기본 지원되지 않습니다. 최신 ComfyUI는 변환 경로로 실행될 수 있으나 느리거나 불안정할 수 있습니다. 안정 실행에는 GGUF 대체를 권장합니다.</div>}
                                  {s.quantUnknown && <div style={{ fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>이 형식({s.quantFmt})은 GPU에 따라 실행되지 않을 수 있습니다. 상단 '내 환경 정보'에 GPU를 입력하면 판정해 드립니다.</div>}
                                  {s.quantBad && s.ggufAlt?.alternatives && s.ggufAlt.alternatives.map((a, ai) => (
                                    <div key={ai} style={{ fontFamily: SANS, fontSize: 13, color: C.point, marginTop: 3, lineHeight: 1.5, paddingLeft: 10 }}>
                                      대체 파일: <span style={{ fontFamily: MONO }}>{a.name}</span> · {a.folder}
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
                                    </div>
                                  )}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  {(() => { const pit = planByFile.get(s.value.replace(/\\/g, "/").split("/").pop().toLowerCase()); const folder = pit ? (pit.promoted ? (pit.promoted.fullPath || pit.promoted.folder) : (pit.fullPath || pit.folder)) : s.folder; return (<>
                                    <div style={{ fontFamily: MONO, fontSize: 14, color: folder === "확인 필요" ? C.red : C.point, overflowWrap: "anywhere", lineHeight: 1.4 }}>{folder}</div>
                                    {pit ? <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>{pit.confidence}</span> : (s.src && s.src !== "rule" && s.src !== "none" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint }}>{s.src}</span>)}
                                    {!pit && s.src === "none" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.red }}>폴더 확인 필요</span>}
                                  </>); })()}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </NumRow>
                ); })()}

              </div>
            </div>);
          })()}

          {/* ══ Bypassed — bypass·음소거된 노드 목록. 고정 헤더(SectionTitle) + 라운드박스 + 번호 행(우측 +/- · 기본 닫힘). 콘텐츠 1개여도 동일 문법 유지. ══ */}
          {report.structSummary?.inactive?.length > 0 && (() => { const inact = report.structSummary.inactive; return (
            <div id="bypassed-section" style={{ marginTop: 29, paddingBottom: 48, scrollMarginTop: 16 }}>
              <SectionTitle>Bypassed</SectionTitle>
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 34px", overflow: "hidden" }}>
                <NumRow num={1} first title="비활성 노드 목록" open={open.bp1} onToggle={() => toggle("bp1")}>
                  <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, lineHeight: 1.6, marginBottom: 12 }}>현재 꺼져 있어(우회·음소거) 실행되지 않는 노드입니다. 의도한 설정인지 확인해 주세요.</div>
                  {/* 4(4차): 비활성 상세는 여기 1곳. 1열 행 구분선 표(노드명 + 상태·그룹 dim 우측). 그룹은 짧은 라벨만(문장·메모·판정불가 미표기·날조 금지). 끊김 경고(⚠)를 전체 현황에서 흡수 — 해당 행 부속(dim amber). 중복 없음(노드별 1행 → 현황 집계 N과 일치). */}
                  {(() => { const okGroup = (g) => g && g.trim().length > 0 && g.trim().length <= 28; return (
                    <div style={{ borderTop: `1px solid ${C.divider}` }}>
                      {inact.map((n, i) => { const brk = report.bypassBreaks.find((b) => String(b.id) === String(n.id)); return (
                        <div key={i} style={{ padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                            <span style={{ fontFamily: SANS, fontSize: 14, color: C.text, overflowWrap: "anywhere", lineHeight: 1.5, minWidth: 0 }}>{n.type}</span>
                            <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, flexShrink: 0, textAlign: "right", lineHeight: 1.5 }}>{n.mode === 4 ? "우회" : "음소거"}{okGroup(n.group) ? ` · ${n.group.trim()}` : ""}</span>
                          </div>
                          {brk && <div style={{ marginTop: 4, fontSize: 13, color: C.amber, lineHeight: 1.45 }}>⚠ 연결 경로 중간에 있습니다. 뒤 노드{brk.targets.length ? ` (${brk.targets.join(", ")})` : ""} 입력이 끊길 수 있습니다.</div>}
                        </div>); })}
                    </div>); })()}
                </NumRow>
              </div>
            </div>); })()}

          {/* Findings. 박스 없는 아코디언. 헤더는 BlockHead로 통일. */}
          <div style={{ marginTop: 29, paddingBottom: 48 }}>
            <SectionTitle>Findings</SectionTitle>

            {/* ── 문제 블록: 번호 1,2,3 동적. 펼친 상태로 또렷하게. ── */}
            {(() => { let fnum = 0; return (<>

            {/* 깨진 노드. type이 null인 노드. 있을 때만 표시. 빨간 경고. */}
            {report.broken?.length > 0 && (
            <div style={{ borderTop: "none", paddingTop: 0 }}>
              <BlockHead num="!" label="깨진 노드" count={report.broken.length} open={open.fb} onToggle={() => toggle("fb")}
                role="type이 없는(null) 노드입니다. 해당 커스텀 노드가 설치되지 않으면 워크플로우 실행이 불가합니다." />
              <div style={{ marginTop: open.fb ? 27 : 0, paddingBottom: open.fb ? 31 : 31 }}>{open.fb && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {report.broken.map((b, i) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                      <CircleAlert size={16} color={C.red} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: C.red, lineHeight: 1.5 }}>이 노드는 설치되지 않으면 워크플로우 실행 불가 (노드 #{b.id}, type=null)</span>
                    </div>))}
                </div>
              )}</div>
            </div>)}

            {report.anomalous?.length > 0 && (() => { fnum++; return (
            <div style={{ borderTop: report.broken?.length ? `1px solid ${C.divider}` : "none", paddingTop: report.broken?.length ? 27 : 0 }}>
              <BlockHead num={String(fnum)} label="정체 미상 노드" count={report.anomalous.length} open={open.fa} onToggle={() => toggle("fa")}
                role={`이 워크플로우에는 이름을 확인할 수 없는 노드가 ${report.anomalous.length}개 있습니다. 도구가 출처를 찾을 수 없어 ComfyUI 화면에서 해당 노드(빨간 테두리)를 직접 확인해야 합니다.`} />
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
                role="이 워크플로우가 쓰는 노드팩과 기록된 버전입니다. 처방 1단계(설치)에 들어갈 저장소의 근거입니다." />
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
                        <span style={{ color: C.dim, flexShrink: 0 }}>-</span>
                        <span><b style={{ color: C.text }}>{p.id}</b> 버전 충돌. {hasCommit ? "재현이 목적이면 기록된 커밋으로 git checkout, 아니면 최신 한 버전으로 통일 설치하세요." : "최신 한 버전으로 통일해 재설치하세요."}</span>
                      </div>);
                    })}
                    {report.packs.some((p) => p.vers.some((v) => /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v))) && (
                      <div style={{ display: "flex", gap: 7, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
                        <span style={{ color: C.dim, flexShrink: 0 }}>-</span>
                        <span>점 버전(<span style={{ fontFamily: MONO, color: C.text }}>1.4.5</span>)은 정식 릴리스 태그, <span style={{ fontFamily: MONO, color: C.faint }}>commit</span> 표시(<span style={{ fontFamily: MONO, color: C.text }}>a6645ed…</span>)는 특정 git 커밋에서 설치한 것입니다. 한 pack에 둘이 섞이면 재현 시 그 커밋을 checkout 해야 할 수 있어 <span style={{ color: C.red }}>버전 충돌</span>로 표시됩니다.</span>
                      </div>
                    )}
                    {report.sameRepo.map((s) => (
                      <div key={s.repo} style={{ display: "flex", gap: 7, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
                        <span style={{ color: C.dim, flexShrink: 0 }}>-</span>
                        <span><b style={{ color: C.green }}>{s.ids.join(" + ")}</b> 는 모두 <span style={{ fontFamily: MONO, color: C.green }}>{s.repo}</span> 하나에서 나옵니다. 한 번만 설치하면 됩니다.</span>
                      </div>))}
                  </div>)}
              </>)}</div>
            </div>); })()}

            {(() => { fnum++; return (
            <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 27 }}>
              <BlockHead num={String(fnum)} label="전체 현황" count={`모델 ${report.models.length} · 비활성 ${report.muted.length}`} open={open.inv} onToggle={() => toggle("inv")}
                role="이 워크플로우가 참조하는 모델·자산 전체와 비활성(bypass/mute) 노드입니다." />
              <div style={{ marginTop: open.inv ? 27 : 0 }}>{open.inv && (<div className="td-fade">
              <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.dim }}>모델 · 자산 인벤토리 <span style={{ color: C.faint, fontWeight: 400 }}>· {report.models.length}개</span></div>
              <div style={{ fontSize: 13, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>참조 모델·자산 전체(VRAM·출처 포함). 실제 받기는 위 Solution '받아야 할 모델' 표에서.</div>
              <div style={{ marginTop: 16 }}>{(
                report.models.length === 0 ? <Empty text="참조된 모델 파일을 찾지 못했습니다." /> : (() => {
                  // 6: 분류 기준 = 행동 가능 여부(직링크 보유). 직링크 있으면 등급 불문 펼침(다운로드 가능한데 가려지는 모순 제거). 링크 없는 진짜 미확정(검색 폴백)만 접기.
                  const confirmed = [];
                  const unconfirmed = [];
                  for (const m of report.models) {
                    const eff = m.compat || liveCompat[m.file] || learnedModel(m.file);
                    const dlUrl = directDownloadUrl(eff, m.file, modelResearch[m.file], m.noteUrl);
                    if (dlUrl) confirmed.push(m);
                    else unconfirmed.push(m);
                  }
                  const renderCard = (m, i, bg = C.surface) => {
                    const live = liveCompat[m.file];
                    const eff = m.compat || live || learnedModel(m.file);
                    const src = eff?.source;
                    const mr = modelResearch[m.file];
                    const dlUrl = directDownloadUrl(eff, m.file, mr, m.noteUrl);
                    const isWeight = WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e));
                    return (
                    <div key={i} style={{ minHeight: 150, background: bg, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                      <span style={{ fontFamily: MONO, fontSize: 18, color: C.text, overflowWrap: "anywhere", lineHeight: 1.35 }}>{m.file}</span>
                      {(() => { const pit = planByFile.get(m.file.replace(/\\/g, "/").split("/").pop().toLowerCase()); const folder = pit?.folder || m.folder; return (<>
                        <span style={{ fontFamily: SANS, fontSize: 14, color: folder === "확인 필요" ? C.faint : C.point, opacity: 1, marginTop: 8, lineHeight: 1.4 }}>{folder}{pit && pit.badge ? ` [${pit.badge}]` : ""}</span>
                        {(pit?.fullPath || (env.modelRoot && rewritePath(m.file, env.modelRoot))) && <span style={{ fontFamily: MONO, fontSize: 13, color: C.point, opacity: 0.7, marginTop: 4 }}>내 경로: {pit?.fullPath || rewritePath(m.file, env.modelRoot)}</span>}
                      </>); })()}
                      {(() => { const ks = knownModelSize(m.file); const sz = eff?.size_gb ? fmtSize(eff.size_gb) : eff?.size_label || (ks ? fmtSize(ks) : null); return (eff?.vram_gb || sz) ? <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.3 }}>{eff?.vram_gb ? `VRAM ${eff.vram_gb} GB` : ""}{eff?.vram_gb && sz ? " · " : ""}{sz ? `정상 ${sz}` : ""}</span> : null; })()}
                      {!eff?.size_gb && !eff?.size_label && !knownModelSize(m.file) && WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)) && <span style={{ fontFamily: SANS, fontSize: 13, color: C.faint, marginTop: 4 }}>용량 확인 필요</span>}
                      {m.rename && <span style={{ fontSize: 13, color: C.amber, marginTop: 7, lineHeight: 1.4 }}>⤷ {m.rename}</span>}
                      {(() => { const al = modelAliasInfo(m.file); return al ? <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.4 }}>다른 이름으로 이미 있을 수 있음: <span style={{ fontFamily: MONO, color: C.point }}>{al.others.join(", ")}</span></span> : null; })()}
                      {m.origin && <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, opacity: 0.7, marginTop: 4 }}>{m.origin}</span>}
                      {src && <span style={{ fontFamily: SANS, fontSize: 13, color: src === "curated" ? C.point : src === "learned" ? C.amber : C.green, opacity: src === "curated" ? 1 : 0.7, marginTop: 5 }}>{src === "curated" ? "큐레이션" : src === "manager_live" ? "Manager(실시간)" : src === "learned" ? "내 적립(미확정)" : "Manager"}</span>}
                      {dlUrl ? (
                        <>
                          <a className="td-hf-sm" href={dlUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 14 }}>다운로드</a>
                          {isAdmin && !eff && mr?.result?.found && <button onClick={() => learnModelLink(m.file, mr.result)} style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.amber, background: "transparent", border: `1px solid ${C.amber}`, borderRadius: 999, padding: "5px 0", width: 280, maxWidth: "100%", cursor: "pointer", marginTop: 8 }}>이거 맞았어 (적립)</button>}
                          {isAdmin && eff?.source === "learned" && <span style={{ fontFamily: SANS, fontSize: 13, color: C.amber, marginTop: 6 }}>✓ 적립됨 (미확정)</span>}
                        </>
                      ) : !isWeight ? null : mr?.loading ? (
                        <span style={{ fontFamily: SANS, fontSize: 13, color: C.dim, marginTop: 14 }}>찾는 중…</span>
                      ) : (!AI_KEY || mr?.error || (mr?.result && !mr.result.found)) ? (
                        <a className="td-hf-sm td-outline-w" href={searchUrl(m.file)} target="_blank" rel="noopener noreferrer" style={{ marginTop: 14 }}>웹에서 검색 ↗</a>
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
                            {/* 5: 래퍼 큰 박스 제거. 개별 라운드박스 각각 배경을 evidenceBg 토큰으로(기존 개별 박스 구조 유지). */}
                            {unconfirmed.map((m, i) => renderCard(m, confirmed.length + i, C.evidenceBg))}
                          </div>
                        )}
                      </div>
                    )}
                  </>);
                })()
              )}</div>

              {/* 4(4차): 비활성 노드는 집계 1줄만(상세 목록·끊김 경고는 Bypassed 1곳). 중복 노출 제거. */}
              <div style={{ marginTop: 36, paddingTop: 28, borderTop: `1px solid ${C.divider}` }}>
                {report.muted.length === 0 ? (
                  <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: C.dim }}>비활성 노드 <span style={{ color: C.faint, fontWeight: 400 }}>· 없음</span></div>
                ) : (() => { const byp = report.muted.filter((m) => m.mode === 4).length; const mut = report.muted.length - byp; return (
                  <div style={{ fontFamily: SANS, fontSize: 14, color: C.dim, lineHeight: 1.6 }}><span style={{ fontWeight: 700 }}>비활성 노드 {report.muted.length}개</span> <span style={{ color: C.faint }}>(우회 {byp} · 음소거 {mut})</span> · 상세는 <a href="#bypassed-section" onClick={openBypassed} style={ANCHOR_LINK}>Bypassed 섹션</a></div>); })()}
              </div>
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
          <div id="diagnose-section" style={{ marginTop: 64, paddingTop: 32, paddingBottom: 48, borderTop: `1px solid ${C.green}` }}>
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
              <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, marginBottom: 12 }}>실행 버튼을 누른 뒤에 나온 로그를 붙여넣어 주세요. 실행 전 로그에는 오류 정보가 없습니다. pytorch·cuda·python 버전 호환성은 각 pack의 requirements.txt 영역이라 JSON만으로는 확인할 수 없어, 에러 로그로 보완합니다.</div>
              <textarea value={errlog} onChange={(e) => setErrlog(e.target.value)} onPaste={onPasteShot} spellCheck={false}
                placeholder={"마지막 Traceback 블록 전체를 붙여넣으세요.\n예) Traceback (most recent call last):\n  File \".../nodes.py\", line 123, in ...\nModuleNotFoundError: No module named 'flash_attn'"}
                style={{ width: "100%", minHeight: 120, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text,
                  border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontFamily: MONO, fontSize: 13, lineHeight: 1.65, outline: "none" }} />

              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input ref={shotRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onShots(e.target.files)} />
                <button className="td-btn" onClick={() => shotRef.current?.click()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 15px", fontFamily: SANS, fontSize: 13, cursor: "pointer" }}>
                  <ImagePlus size={15} /> 캡처 이미지 첨부</button>
                <span style={{ fontSize: 13, color: C.faint }}>캡처는 이렇게 찍어 주세요. 1. 빨간 노드가 보이게 해당 부분을 확대해 1장. 2. 워크플로우 안에 Note(설명 메모)가 있으면 그 부분 1장. 전체 화면을 축소해 찍으면 글자가 뭉개져 도움이 되지 않습니다. 캡처 후 Ctrl+V(맥 Cmd+V)로 바로 붙여넣을 수 있습니다.</span>
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
                    구조 분석{briefingInfo.lines > 0 ? ` + 에러 ${briefingInfo.lines}줄` : ""} 정리 완료 · 총 {briefingInfo.chars.toLocaleString()}자 복사됨 · {briefingInfo.chars <= 10000 ? "LLM 채팅창 1회 분량" : "1회 분량 초과, 나눠 붙여넣기 권장"}
                    {briefingInfo.shots > 0 ? <span style={{ color: C.dim }}> · 이미지 {briefingInfo.shots}장은 텍스트에 안 담기니 챗에 따로 첨부하세요</span> : null}
                  </span>
                </div>
              )}
              </>)}
            </div>

            {/* 파일 이름 불일치. "Value not in list" errlog 직접 파싱 (PC에 있는 후보로 교체) */}
            {(() => { const hits = parseValueNotInList(errlog); return hits.length > 0 ? (
              <div className="td-fade" style={{ marginTop: 24 }}>
                <div style={{ background: C.surface, border: `1px solid ${C.red}`, borderRadius: 14, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <CircleAlert size={18} color={C.red} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.red }}>실행 시 값 오류 {hits.length}건. ComfyUI가 이 값을 거부했습니다</span>
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
                    <span style={{ fontSize: 14, color: C.dim }}>이 워크플로우의 구조와 에러를 결합해 Claude가 분석 중…</span>
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
                      <div style={{ marginTop: 18 }}>
                        {/* 복사 단위 = 값 행(명령 줄 하나씩). CopyRows 단일 문법. */}
                        <CopyRows text={aiResult.command} keyBase="ai-cmd" copy={copy} copiedKey={copiedKey} />
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
          {/* 소형2: 푸터를 어두운 존 최하단 고정 흐름으로(marginTop auto). 9: 자세한 진단(detailOpen) 펼침 시에만 노출. */}
          {detailOpen && (
          <div style={{ marginTop: "auto", paddingTop: 40, paddingBottom: 32, textAlign: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: 13, color: C.faintDim, letterSpacing: "0.02em" }}>
              <span style={{ fontSize: "1.2em" }}>©</span> 2026 Comfy-Teardown · Built by Joon Hyung Kim
            </span>
          </div>
          )}
            </div>
          </div>
        )}
      {/* UX6: Top 버튼 — 1뷰포트 초과 스크롤 시 페이드인. 플로팅 예외로 원형 필 허용(테두리 없음·옅은 보라 배경·chevron up). */}
      <button aria-label="맨 위로" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        style={{ position: "fixed", right: 24, bottom: 24, zIndex: 40, width: 44, height: 44, borderRadius: 999, background: "rgba(166,120,224,0.18)", border: "none", color: C.violet, cursor: "pointer", display: "grid", placeItems: "center", opacity: showTop ? 1 : 0, pointerEvents: showTop ? "auto" : "none", transition: "opacity 0.3s" }}>
        <ChevronUp size={20} strokeWidth={2} /></button>
    </div>
  );
}
