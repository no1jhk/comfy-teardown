import React, { useState, useCallback, useRef } from "react";
import {
  Upload, Boxes, ChevronRight, GitBranch,
  CircleAlert, Copy, Check, ExternalLink, Plus, Minus, Download,
  Terminal, ImagePlus, X, ScanSearch,
} from "lucide-react";
import { LOGO } from "./assets/logo.js";

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
  bg: "#201926", surface: "#2A2333", surfaceHi: "#342C3F", line: "#3A3248",
  quiet: "#241D2E",
  divider: "rgba(255,255,255,0.09)",
  text: "#C2BFB9", dim: "#A39BAE", faint: "#76707F",
  point: "#F4FF75",
  green: "#C1BFBA", amber: "#C1BFBA", red: "#EF5350", violet: "#A678E0",
};
const INK = "#1A1505"; // 노랑 배경 위 텍스트
const MONO = "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,Menlo,monospace";
const DISPLAY = "'PP Formula','Space Grotesk','Neue Haas Grotesk Display Pro',Inter,sans-serif"; // 제목용 — comfy.org 공식은 PP Formula(유료). 없으면 Space Grotesk로 폴백.
const SANS = "Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const MODEL_EXTS = [".safetensors",".ckpt",".pt",".pth",".bin",".gguf",".onnx",".glb",".fbx",".obj",".vrm",".gltf"];
const WEIGHT_EXTS = [".ckpt",".safetensors",".pt",".pth",".bin",".gguf",".onnx"];

const FRONTEND_ONLY = new Set(["Note","MarkdownNote","Reroute","PrimitiveNode"]);

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

function repoForUnmapped(type) {
  for (const [pre, repo] of REPO_BY_PREFIX) if (type.startsWith(pre)) return repo;
  return null;
}
function normalize(wf) {
  if (wf && Array.isArray(wf.nodes)) {
    return { format: "UI", nodes: wf.nodes.map((n) => ({
      id: n.id, type: n.type, cnr_id: n.properties?.cnr_id ?? null,
      ver: n.properties?.ver ?? null, mode: n.mode ?? 0,
      widgets: Array.isArray(n.widgets_values) ? n.widgets_values : [] })) };
  }
  if (wf && typeof wf === "object") {
    const e = Object.entries(wf).filter(([, v]) => v && v.class_type);
    if (e.length) return { format: "API", nodes: e.map(([id, v]) => ({
      id, type: v.class_type, cnr_id: null, ver: null, mode: 0,
      widgets: Object.values(v.inputs || {}).filter((x) => typeof x === "string") })) };
  }
  return null;
}
function guessFolder(file, type) {
  const f = file.toLowerCase(), ext = "." + f.split(".").pop();
  if ([".glb",".fbx",".obj",".vrm",".gltf"].includes(ext)) return "3D 메시·리그 입출력 자산";
  if (f.includes("clip")) return "models/text_encoders · 추정";
  if (f.includes("vae")) return "models/vae · 추정";
  if (f.includes("lora")) return "models/loras · 추정";
  if (f.includes("control")) return "models/controlnet · 추정";
  if (ext === ".gguf") return "models/text_encoders · 추정";
  if (ext === ".onnx") return "models/onnx · 추정";
  if ([".ckpt",".safetensors",".pt",".pth",".bin"].includes(ext)) {
    if (/motion|dit|hymotion/i.test(type)) return "models/hymotion/… · 추정";
    return "models/checkpoints · 추정";
  }
  return "확인 필요";
}
function portabilityScan(nodes) {
  const hits = [];
  for (const n of nodes) for (const w of n.widgets) {
    if (typeof w !== "string") continue;
    if (w === "flash_attn") hits.push({ node: n.type, value: w, risk: "flash_attn 어텐션 — Windows 빌드가 까다롭습니다. 설치가 막히면 sdpa로 변경하세요." });
    else if (/[A-Za-z0-9._-]+\\[A-Za-z0-9._\\-]+/.test(w)) {
      if (/_\d{8}_/.test(w) && /\.(fbx|glb|obj)$/i.test(w))
        hits.push({ node: n.type, value: w, risk: "과거 실행 산출물 경로입니다. 다른 PC엔 없을 수 있어 새 파일을 선택하거나 단계를 다시 실행하세요." });
      else hits.push({ node: n.type, value: w, risk: "Windows 경로 구분자(\\)입니다. Mac/Linux에선 / 로 바꿔야 합니다." });
    }
  }
  return hits;
}
function analyze(norm) {
  const packVers = {}, packNodes = {}, unmappedRaw = [], frontendOnly = [], muted = [], models = [];
  for (const n of norm.nodes) {
    if (n.cnr_id) { (packVers[n.cnr_id] ||= new Set()).add(n.ver); (packNodes[n.cnr_id] ||= new Set()).add(n.type); }
    else if (FRONTEND_ONLY.has(n.type)) frontendOnly.push(n.type);
    else unmappedRaw.push({ id: n.id, type: n.type, repo: repoForUnmapped(n.type) });
    if (n.mode === 2 || n.mode === 4) muted.push({ id: n.id, type: n.type, mode: n.mode });
    for (const w of n.widgets) if (typeof w === "string" && MODEL_EXTS.some((e) => w.toLowerCase().endsWith(e))) {
      const base = w.replace(/\\/g, "/").split("/").pop().toLowerCase();
      models.push({ node: n.type, file: w.replace(/\\/g, "/"), folder: guessFolder(w, n.type), rename: RENAME_HINT[base] || null });
    }
  }
  const packs = Object.keys(packVers).map((id) => {
    const vers = [...packVers[id]].filter(Boolean).map(String);
    return { id, vers, repo: REPO_BY_CNR[id] || null, nodeTypes: [...packNodes[id]],
      isCore: id === "comfy-core", conflict: id !== "comfy-core" && vers.length > 1 };
  }).sort((a, b) => (a.isCore - b.isCore) || b.vers.length - a.vers.length);

  const byRepo = {};
  for (const p of packs) if (p.repo) (byRepo[p.repo] ||= []).push(p.id);
  const sameRepo = Object.entries(byRepo).filter(([, ids]) => ids.length > 1).map(([repo, ids]) => ({ repo, ids }));

  return {
    format: norm.format, totalNodes: norm.nodes.length,
    customPackCount: packs.filter((p) => !p.isCore).length,
    packs, unmapped: unmappedRaw, frontendOnly: [...new Set(frontendOnly)],
    muted, models, sameRepo, portability: portabilityScan(norm.nodes),
  };
}

// 에러 로그(텍스트)를 패턴 매칭해 진단 항목으로 변환 (룰 기반 v1.1 초기 버전, LLM 불필요)
// report가 있으면 컨텍스트(노드명·pack)를 결합해 더 구체적인 제안을 붙인다.
function analyzeLog(log, report) {
  if (!log || !log.trim()) return [];
  const text = log;
  const low = text.toLowerCase();
  const found = [];
  const has = (re) => re.test(text);

  // 1) ModuleNotFoundError / ImportError — 빠진 패키지
  const modMatches = [...text.matchAll(/(?:ModuleNotFoundError|ImportError)[^\n]*?No module named ['"]([\w.]+)['"]/g)];
  const mods = [...new Set(modMatches.map((m) => m[1].split(".")[0]))];
  for (const mod of mods) {
    // 특수 케이스: flash_attn은 빌드가 까다로워 별도 안내
    if (/flash[_-]?attn/i.test(mod)) {
      found.push({
        key: `mod-flash`, sev: "high", title: "flash_attn 모듈이 설치되지 않음",
        cause: "flash-attn은 CUDA 빌드가 필요해 Windows·일부 환경에서 설치가 자주 실패합니다.",
        fixes: [
          "우선 설치 시도: pip install flash-attn --no-build-isolation",
          "설치가 계속 막히면 해당 노드의 attention 옵션을 flash_attn → sdpa(또는 pytorch)로 변경",
        ],
        command: "pip install flash-attn --no-build-isolation",
      });
    } else {
      found.push({
        key: `mod-${mod}`, sev: "high", title: `파이썬 모듈 없음: ${mod}`,
        cause: `의존 패키지 ${mod} 가 현재 파이썬 환경에 설치되어 있지 않습니다.`,
        fixes: [
          `해당 노드팩 폴더의 requirements.txt 설치: pip install -r requirements.txt`,
          `또는 개별 설치: pip install ${mod}`,
        ],
        command: `pip install ${mod}`,
      });
    }
  }

  // 2) CUDA out of memory
  if (has(/CUDA out of memory|OutOfMemoryError|CUDA error: out of memory/i)) {
    const want = (text.match(/Tried to allocate\s+([\d.]+\s*[MG]iB)/i) || [])[1];
    found.push({
      key: "oom", sev: "high", title: "CUDA 메모리 부족 (VRAM OOM)",
      cause: `GPU VRAM이 모델·해상도를 감당하지 못했습니다${want ? ` (할당 시도: ${want})` : ""}.`,
      fixes: [
        "해상도·배치 크기·프레임 수를 낮추기",
        "VRAM 정리 노드(VRAMCleanup 등)를 중간에 배치하거나, 모델을 단계별로 언로드",
        "가능하면 fp16/bf16·양자화(GGUF) 모델 사용으로 메모리 절감",
        "다른 프로세스가 VRAM을 점유 중인지 확인(nvidia-smi)",
      ],
    });
  }

  // 2-b) xformers 미설치/불일치 — flash_attn과 유사한 어텐션 라이브러리
  if (has(/No module named ['"]xformers['"]|xformers.*not (?:installed|available)|WARNING.*xformers|Cannot import xformers/i)) {
    found.push({
      key: "xformers", sev: "mid", title: "xformers 미설치·비호환",
      cause: "xformers는 torch 버전에 맞는 휠이 필요해, 버전이 엇갈리면 import가 실패합니다.",
      fixes: [
        "현재 torch에 맞는 xformers 설치: pip install -U xformers --index-url https://download.pytorch.org/whl/cu121",
        "설치가 계속 막히면 해당 노드의 attention을 sdpa(또는 pytorch)로 변경 — xformers 없이도 동작",
      ],
      command: "pip install -U xformers --index-url https://download.pytorch.org/whl/cu121",
    });
  }

  // 2-c) numpy 2.x ABI 충돌 — 컴파일된 패키지와 numpy 2.x 호환성 깨짐
  if (has(/numpy\.dtype size changed|_ARRAY_API not found|A module that was compiled using NumPy 1\.x|numpy\.core\.multiarray failed to import/i)) {
    found.push({
      key: "numpy2", sev: "mid", title: "NumPy 2.x ABI 충돌",
      cause: "NumPy 1.x로 빌드된 패키지가 설치된 NumPy 2.x와 충돌합니다. 많은 ComfyUI 노드가 아직 numpy<2 전제입니다.",
      fixes: [
        "numpy를 1.x로 다운그레이드: pip install \"numpy<2\"",
        "이후에도 남으면 해당 패키지를 numpy 2.x 호환 버전으로 업데이트",
      ],
      command: "pip install \"numpy<2\"",
    });
  }

  // 3) torch / CUDA 버전 불일치
  if (has(/The detected CUDA version|CUDA version.*mismatch|not compatible with the current PyTorch|requires CUDA/i) ||
      (has(/torch/i) && has(/CUDA capability|sm_\d+|kernel image/i))) {
    found.push({
      key: "torch-cuda", sev: "mid", title: "PyTorch — CUDA 버전 불일치",
      cause: "설치된 torch가 현재 GPU·CUDA 드라이버와 맞지 않습니다.",
      fixes: [
        "GPU에 맞는 CUDA 빌드의 torch 설치 (예: cu121). https://pytorch.org/get-started/locally 참고",
        "nvidia-smi로 드라이버 CUDA 버전 확인 후 맞는 휠 설치",
      ],
    });
  }

  // 4) 가중치 파일 로드 — 경로/파일 없음
  if (has(/FileNotFoundError|No such file or directory|Error\(s\) in loading state_dict|size mismatch for/i)) {
    found.push({
      key: "weights", sev: "mid", title: "모델·가중치 로드 실패",
      cause: "참조하는 파일이 없거나 경로·이름이 맞지 않거나, 다른 버전의 가중치입니다.",
      fixes: [
        "Inventory·Solution의 모델 경로·리네임 안내를 따라 파일명·위치 확인",
        "size mismatch면 모델 버전이 다른 경우니 워크플로에 맞는 체크포인트를 받기",
      ],
    });
  }

  // 4-b) 텐서 shape 불일치 — 해상도·차원 불일치
  if (has(/Sizes of tensors must match|mat1 and mat2 shapes cannot be multiplied|The size of tensor a \(\d+\) must match|Expected.*dimension|RuntimeError:.*shape/i)) {
    found.push({
      key: "shape", sev: "mid", title: "텐서 shape 불일치",
      cause: "노드 간 입·출력 텐서 차원이 안 맞습니다. 해상도·채널 수·모델 조합이 원인일 때가 많습니다.",
      fixes: [
        "해상도를 모델 권장값(예: 8의 배수)으로 맞추기",
        "서로 다른 모델·인코더를 섞은 경우 호환되는 쌍으로 교체(예: VAE·CLIP 버전 일치)",
      ],
    });
  }

  // 4-c) 노드 미등록(설치 안 됨) — report.packs와 교차해 어떤 pack인지 연결
  {
    const nodeMatches = [...text.matchAll(/(?:was not found|does not exist|Cannot (?:find|execute) node|Node type ['"]?([\w.]+)['"]?(?: was)? not found)/gi)];
    const missingTypes = [...new Set([
      ...nodeMatches.map((m) => m[1]).filter(Boolean),
      ...[...text.matchAll(/['"]([A-Z][\w]+)['"] was not found/g)].map((m) => m[1]),
    ])];
    if (has(/was not found|node type.*not found|Cannot find reference|When loading the graph/i)) {
      // report가 있으면 미매핑·추정 pack과 교차해 구체적으로
      const ctx = [];
      if (report) {
        for (const t of missingTypes) {
          const u = report.unmapped?.find((x) => x.type === t);
          if (u && u.repo) ctx.push(`${t} → ${u.repo}에서 설치(추정)`);
          else if (u) ctx.push(`${t} → 출처 미상, Manager의 Install Missing으로 확인`);
        }
      }
      found.push({
        key: "missing-node", sev: "high", title: "설치되지 않은 노드가 있음" + (missingTypes.length ? `: ${missingTypes.slice(0, 4).join(", ")}` : ""),
      cause: "워크플로가 참조하는 커스텀 노드가 현재 컴파일에 설치되어 있지 않습니다.",
        fixes: [
          "ComfyUI-Manager → Install Missing Custom Nodes 실행",
          ...(ctx.length ? ctx : ["아래 Findings의 패키지·출처 추정 목록에서 해당 노드의 저장소를 확인해 git clone"]),
        ],
      });
    }
  }

  // 4-d) HuggingFace 다운로드 실패 — 토큰·gated repo
  if (has(/401 Client Error|403 Client Error|Repository Not Found|Cannot access gated repo|GatedRepoError|Invalid user token|Unauthorized.*huggingface/i)) {
    found.push({
      key: "hf-auth", sev: "mid", title: "HuggingFace 다운로드 권한 실패",
      cause: "비공개(gated) 모델이거나, HF 토큰이 없거나 해당 모델 약관에 동의하지 않은 상태입니다.",
      fixes: [
        "HF 페이지에서 모델 약관 동의(Agree) 후 재시도",
        "토큰 로그인: huggingface-cli login (또는 HF_TOKEN 환경변수 설정)",
      ],
      command: "huggingface-cli login",
    });
  }

  // 4-e) AttributeError — 노드팩·의존 라이브러리 버전 불일치 신호(구체 원인은 불확실 → sev low)
  if (has(/AttributeError: (?:module ['"][\w.]+['"] has no attribute|['"]?\w+['"]? object has no attribute)/i)) {
    const attr = (text.match(/has no attribute ['"]([\w]+)['"]/) || [])[1];
    found.push({
      key: "attr", sev: "low", title: "AttributeError — 노드팩 버전 불일치 가능성" + (attr ? ` (${attr})` : ""),
      cause: "코드가 기대한 속성이 없습니다. 노드팩·의존 라이브러리 버전이 서로 안 맞을 때 자주 나타납니다.",
      fixes: [
        "해당 노드팩을 최신으로 업데이트(git pull) 후 ComfyUI 재시작",
        "그래도 남으면 Traceback 최하단의 파일·줄을 근거로 해당 pack의 issues 검색",
      ],
    });
  }

  // report 컨텍스트 결합: 로그에 flash_attn 언급 + 워크플로에도 flash_attn이 있으면 연결 멘트
  if (report && found.some((f) => f.key === "mod-flash")) {
    const hit = report.portability?.find((h) => h.value === "flash_attn");
    if (hit) {
      const f = found.find((x) => x.key === "mod-flash");
      f.fixes.push(`이 워크플로의 ${hit.node} 노드가 flash_attn을 쓰고 있습니다 — 여기서 sdpa로 바꾸면 해결됩니다.`);
    }
  }

  // 탐지된 게 없고 로그는 있는 경우
  if (found.length === 0) {
    found.push({
      key: "unknown", sev: "low", title: "알려진 패턴과 일치하는 오류를 찾지 못함",
      cause: "현재 룰(v1.1 초기)이 인식하는 패턴(ModuleNotFound·flash_attn·xformers·numpy 2.x·CUDA OOM·torch·cuda 불일치·가중치·shape·미등록 노드·HF 권한)과 달라요.",
      fixes: [
        "에러의 마지막 줄(Traceback 최하단)을 중심으로 메시지를 확인하세요.",
        "이 유형의 정밀 진단은 v1.1 AI 진단(LLM)에서 다룰 예정입니다.",
      ],
    });
  }
  return found;
}

// 분석 결과(report)를 순서 있는 "처방" 액션으로 변환 (룰 기반, LLM 불필요)
function buildPrescription(r) {
  const steps = [];
  const repos = new Set();
  for (const p of r.packs) if (!p.isCore && p.repo) repos.add(p.repo);
  for (const u of r.unmapped) if (u.repo) repos.add(u.repo);
  const repoList = [...repos];
  const unknown = r.unmapped.filter((u) => !u.repo).length;
  if (repoList.length) steps.push({
    key: "install",
    title: `커스텀 노드 ${repoList.length}개 pack 설치`,
    desc: "custom_nodes 폴더에서 git clone (또는 Manager의 Git URL 설치).",
    command: repoList.map((rp) => `git clone https://github.com/${rp}`).join("\n"),
    warn: unknown ? `출처 미상 ${unknown}개는 Manager의 "Install Missing Custom Nodes"로 확인.` : null,
  });
  const dl = r.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)));
  if (dl.length) steps.push({
    key: "models",
    title: `모델 ${dl.length}개 다운로드·배치`,
    desc: "지정 폴더에 배치. 리네임 표시는 이름을 정확히 맞추세요.",
    models: dl,
  });
  const env = r.portability.filter((h) => h.value === "flash_attn");
  if (env.length) steps.push({
    key: "env",
    title: "환경 의존 설정 우회",
    desc: "설치가 막히면 대체값으로 바꾸세요.",
    items: env.map((h) => ({ action: `${h.node} — attention을 flash_attn → sdpa 로 변경` })),
  });
  const stale = r.portability.filter((h) => /산출물/.test(h.risk));
  const sep = r.portability.filter((h) => /구분자/.test(h.risk));
  if (stale.length || sep.length) {
    const items = [];
    for (const h of stale) items.push({ action: `${h.node} — 과거 산출물 경로. 새 파일 선택 또는 단계 재실행` });
    if (sep.length) items.push({ action: `Windows 경로 구분자(\\) ${sep.length}곳 — Mac/Linux로 옮길 때 / 로 치환` });
    steps.push({ key: "paths", title: "끊어진 경로·입력 파일 정리", desc: "다른 PC엔 없는 경로. 실행 전 새로 지정.", items });
  }
  return steps;
}

// 진단 결과(report)를 사람이 읽는 Markdown으로 변환 → 복기·기록용 .md 저장
// (의존성 없이 순수 문자열 조립. 노션/GitHub에 그대로 붙여넣기 가능)
function buildMarkdown(report, summary, rx) {
  const L = [];
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  L.push(`# Teardown 진단 리포트`);
  L.push(``);
  L.push(`- 대상: \`${report.source}\``);
  L.push(`- 포맷: ${report.format}`);
  L.push(`- 생성: ${stamp}`);
  L.push(``);
  if (summary) L.push(`> ${summary.headline}`);
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
    for (const it of summary.issues) L.push(`- **${it.head}** — ${it.body}`);
    L.push(``);
  }

  // 에러 로그 진단 (있을 때만)
  if (report.logFindings && report.logFindings.length) {
    L.push(`## 에러 로그 진단`);
    L.push(``);
    for (const d of report.logFindings) {
      const sev = d.sev === "high" ? "치명" : d.sev === "mid" ? "주의" : "참고";
      L.push(`### [${sev}] ${d.title}`);
      L.push(d.cause);
      for (const fx of d.fixes) L.push(`- ${fx}`);
      if (d.command) { L.push("```bash"); L.push(d.command); L.push("```"); }
      L.push(``);
    }
  }

  // Solution (처방)
  if (rx.length) {
    L.push(`## Solution`);
    L.push(``);
    rx.forEach((step, i) => {
      L.push(`### ${i + 1}. ${step.title}`);
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
        for (const m of step.models) {
          const hf = hfLink(m.file);
          const link = hf ? ` — [${hf.exact ? "HF 받기" : "HF 검색"}](${hf.url})` : "";
          L.push(`- \`${m.file}\` → ${m.folder}${link}`);
          if (m.rename) L.push(`  - ⤷ ${m.rename}`);
        }
      }
      if (step.items) for (const it of step.items) L.push(`- ${it.action}`);
      L.push(``);
    });
  }

  // Findings (근거)
  L.push(`## Findings`);
  L.push(``);
  L.push(`### 1. 이식 위험 값 (${report.portability.length})`);
  if (report.portability.length === 0) L.push(`- 없음`);
  else for (const h of report.portability) L.push(`- \`${h.value}\` (${h.node}) — ${h.risk}`);
  L.push(``);
  L.push(`### 2. 패키지 · 버전 (${report.packs.length})`);
  for (const p of report.packs) {
    const repo = p.repo ? ` · ${p.repo}` : "";
    const conf = p.conflict ? ` · ⚠ 버전 충돌` : "";
    L.push(`- \`${p.id}\`${repo} — ${p.vers.join(", ") || "버전 미기록"}${conf} (${p.nodeTypes.length}종)`);
  }
  L.push(``);
  L.push(`### 3. 출처 추정 노드 (${report.unmapped.length})`);
  if (report.unmapped.length === 0) L.push(`- 없음`);
  else for (const u of report.unmapped) L.push(`- \`${u.type}\` — ${u.repo ? `${u.repo} · 추정` : "출처 미상 (Manager로 확인)"}`);
  L.push(``);

  // Inventory
  L.push(`## Inventory`);
  L.push(``);
  L.push(`### 1. 모델 · 자산 (${report.models.length})`);
  if (report.models.length === 0) L.push(`- 없음`);
  else for (const m of report.models) L.push(`- \`${m.file}\` → ${m.folder}${m.rename ? ` (⤷ ${m.rename})` : ""}`);
  L.push(``);
  L.push(`### 2. 비활성 노드 (${report.muted.length})`);
  if (report.muted.length === 0) L.push(`- 없음`);
  else for (const m of report.muted) L.push(`- \`${m.type}\` — ${m.mode === 4 ? "bypass" : "muted"}`);
  L.push(``);

  L.push(`---`);
  L.push(`> pytorch·cuda·python 호환성은 JSON에 없어 미표시 (각 pack requirements.txt 영역). 에러 로그 기반 AI 진단은 v1.1 예정.`);
  L.push(`> Generated by Teardown`);

  return L.join("\n");
}

// 브라우저 다운로드 (서버·라이브러리 없이 Blob)
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
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
      <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.dim, margin: 0, lineHeight: 1.6, textAlign: "right", maxWidth: 540 }}>{sub}</p>
    </div>);
  }
  return (<div style={{ margin: "0 0 28px" }}>
    <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>{children}</h2>
    {sub && <p style={{ fontFamily: SANS, fontSize: 13.5, color: C.dim, margin: "10px 0 0", lineHeight: 1.6 }}>{sub}</p>}
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
          <span style={{ fontFamily: SANS, fontSize: 24, fontWeight: 650, letterSpacing: "-0.01em", color: C.text }}>{label}</span>
          {count != null && <span style={{ fontFamily: MONO, fontSize: 13, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 20, padding: "2px 11px" }}>{count}</span>}
        </div>
        {role && <p style={{ fontSize: 18.75, color: C.dim, margin: "13px 0 0", lineHeight: 1.5 }}>{role}</p>}
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
    <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.3 }}>{label}</div>
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
  const [open, setOpen] = useState({ s0: true }); // Solution 1단계는 기본 펼침
  const [errlog, setErrlog] = useState("");       // 에러 로그 텍스트 (A안: 상시 노출)
  const [errShots, setErrShots] = useState([]);   // 선택 추가: 에러 캡처 이미지 [{name,url}]
  const [rawJson, setRawJson] = useState("");     // A안: 진단하기 버튼이 재실행할 원본 JSON
  const [rawSrc, setRawSrc] = useState("");
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
  const saveReport = () => {
    if (!report) return;
    const md = buildMarkdown(report, summary, rx);
    const safe = (report.source || "workflow").replace(/\.[^.]+$/, "").replace(/[^\w가-힣.-]+/g, "_").slice(0, 40);
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    downloadText(`teardown-${safe}-${day}.md`, md);
  };

  const run = useCallback((text, src, logText = "") => {
    setErr(null);
    setRawJson(text); setRawSrc(src);
    try {
      const norm = normalize(JSON.parse(text));
      if (!norm) throw new Error("ComfyUI 워크플로 형식이 아닙니다. nodes 배열 또는 class_type 키가 보이지 않습니다.");
      const rep = analyze(norm);
      const logFindings = logText && logText.trim() ? analyzeLog(logText, rep) : [];
      setReport({ ...rep, source: src, logFindings });
    } catch (e) {
      setReport(null);
      setErr(/JSON|Unexpected|token/.test(e.message)
        ? "JSON을 읽지 못했습니다. ComfyUI 워크플로 export가 맞는지 확인하세요." : e.message);
    }
  }, []);
  const onFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => run(String(r.result), file.name);
    r.onerror = () => setErr("파일을 읽지 못했습니다. 다시 시도하세요.");
    r.readAsText(file);
  };
  // 진단하기 — 저장된 원본 JSON + 현재 에러 로그를 함께 넘겨 재진단.
  const diagnose = () => { if (rawJson) run(rawJson, rawSrc, errlog); };

  const rx = report ? buildPrescription(report) : [];

  // 진단 요약 계산
  let summary = null;
  if (report) {
    const conflictPacks = report.packs.filter((p) => p.conflict);
    const unknownNodes = report.unmapped.filter((u) => !u.repo);
    const weightCount = report.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e))).length;
    const issues = [];
    if (conflictPacks.length) issues.push({ head: `버전 충돌 ${conflictPacks.length}건`,
      body: `${conflictPacks.map((p) => p.id).join(", ")} — 같은 pack이 여러 버전으로 기록돼 재현이 불안정합니다.` });
    if (report.portability.length) issues.push({ head: `이식 위험 ${report.portability.length}건`,
      body: "flash_attn·경로 등 다른 PC로 옮기면 깨질 값이 있습니다." });
    if (unknownNodes.length) issues.push({ head: `출처 미상 ${unknownNodes.length}개`,
      body: "자동 매핑이 안 된 노드입니다. Manager의 Install Missing으로 확인하세요." });
    if (report.muted.length) issues.push({ head: `비활성 노드 ${report.muted.length}개`,
      body: "bypass/muted 상태입니다. 단계별로 켜고 끄는 워크플로면 정상이고, 의도와 다르면 점검하세요." });
    summary = {
      headline: `이 워크플로는 커스텀 노드 ${report.customPackCount}개 pack과 모델 ${weightCount}개에 의존합니다.`,
      issues, weightCount,
    };
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: SANS, padding: "32px 20px", position: "relative", overflow: "hidden",
      backgroundImage: `radial-gradient(circle at 25% -8%, rgba(244,255,117,0.05), transparent 32%)` }}>
      {/* 파일 미선택 시에만 — 공식 hero 이미지를 화면 하단에 깔아 빈 공간을 채움.
          opacity 깜빡임(td-hero-breathe) + 위아래 부유(td-hero-float)로 살아있는 느낌. JSON 올리면 사라짐. */}
      {!report && (
        <div aria-hidden className="td-hero" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "58vh", pointerEvents: "none", zIndex: 0,
          backgroundImage: `url(${HERO_BG})`, backgroundRepeat: "no-repeat", backgroundPosition: "center bottom",
          backgroundSize: "contain", maskImage: "linear-gradient(to bottom, transparent, #000 38%)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 38%)" }} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
        .td-drop{transition:border-color .18s,background .18s}
        .td-btn{transition:transform .12s,opacity .18s}
        .td-btn:hover{transform:translateY(-1px)} .td-btn:active{transform:translateY(0)}
        .td-copy{transition:opacity .15s;opacity:.85}.td-copy:hover{opacity:1}
        .td-acc{transition:opacity .15s;opacity:.9}.td-acc:hover{opacity:1}
        .td-hf{display:inline-flex;align-items:center;gap:6px;border:1px solid ${C.point};color:${C.point};background:transparent;border-radius:999px;padding:6px 16px;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf:hover{background:${C.point};color:${INK}}
        .td-hf-sm{display:inline-flex;align-items:center;justify-content:center;width:280px;max-width:100%;border:1px solid ${C.point};color:${C.point};background:transparent;border-radius:999px;padding:8px 0;font-family:${SANS};font-size:12px;font-weight:700;text-decoration:none;transition:background .15s,color .15s;cursor:pointer;white-space:nowrap}
        .td-hf-sm:hover{background:${C.point};color:${INK}}
        /* 결과저장 등 아웃라인 pill — hover시 노랑으로 채움 (다른 버튼과 동일) */
        .td-outline{border:1px solid ${C.point};color:${C.point};background:transparent;transition:background .15s,color .15s,transform .12s}
        .td-outline:hover{background:${C.point};color:${INK};transform:translateY(-1px)}.td-outline:active{transform:translateY(0)}
        /* 진단하기 풀폭 CTA — 아웃라인, hover시 채움. disabled면 회색·채움 없음 */
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
      <div style={{ maxWidth: 1080, margin: "0 auto", position: "relative", zIndex: 1 }}>
        {/* 헤더 — 로고 */}
        <img src={LOGO} alt="Comfy Teardown" style={{ height: 50, width: "auto", display: "block", marginBottom: 16 }} />
        <p style={{ color: C.dim, fontSize: 14.5, margin: "0 0 28px", lineHeight: 1.6 }}>ComfyUI 에서 파이프라인 실행에 문제 있는 JSON 파일을 첨부하면, 모든 노드를 일일이 분석해서 문제점을 진단하고 해결법을 제시합니다.</p>

        {/* B안 1차 입력 — JSON 드롭존(주인공, 노란 점선 단독). 드래그&드롭으로 넣는 공간임을 명확히. */}
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
              <div style={{ fontSize: 14.5, fontWeight: 600, color: C.text, overflowWrap: "anywhere" }}>{report.source}</div>
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>분석 완료 · {report.format} 포맷 · 다른 파일을 올리면 다시 분석합니다</div>
            </>) : (<>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>workflow.json을 끌어다 놓기</div>
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>ComfyUI에서 내보낸 UI/API 포맷 모두 지원</div>
            </>)}
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
          {/* 두 버튼은 별도 래퍼로 묶어 gap 13(기존 26의 절반)만 적용 — 부모 gap 18과 분리 */}
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <button className="td-btn" onClick={() => fileRef.current?.click()}
              style={{ background: C.point, color: INK, border: "none", borderRadius: 999, padding: "10px 20px", fontFamily: SANS, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{report ? "다른 파일" : "파일 선택"}</button>
            <button className="td-btn" onClick={() => run(JSON.stringify(SAMPLE_WORKFLOW), "샘플 · Rig+Anim 파이프라인")}
              style={{ background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 18px", fontFamily: SANS, fontSize: 13.5, cursor: "pointer" }}>샘플 보기</button>
          </div>
        </div>

        {/* B안 2차 입력 — JSON 분석 후에만 등장. 점선 아닌 솔리드 톤다운 박스(보조 위계). "막혔으면 로그도 넣어보세요". */}
        {report && (
          <div className="td-fade" style={{ marginTop: 12, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "18px 22px", position: "relative", zIndex: 1 }}
            onDragOver={(e) => e.stopPropagation()} onDrop={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18, minWidth: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: C.surfaceHi, display: "grid", placeItems: "center", border: `1px solid ${C.line}`, flexShrink: 0 }}>
                  <Terminal size={19} color={C.point} strokeWidth={1.9} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>에러 로그 붙여넣기</div>
                  <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>터미널·콘솔의 빨간 에러를 복사·붙여넣기 후 아래 버튼을 누르면 JSON과 함께 진단합니다.</div>
                </div>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 11px", flexShrink: 0 }}>v1.1 연결 예정</span>
            </div>
            <textarea value={errlog} onChange={(e) => setErrlog(e.target.value)} spellCheck={false}
              placeholder={"마지막 Traceback 블록 전체를 붙여넣으세요.\n예) Traceback (most recent call last):\n  File \".../nodes.py\", line 123, in ...\nModuleNotFoundError: No module named 'flash_attn'"}
              style={{ width: "100%", minHeight: 120, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text,
                border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontFamily: MONO, fontSize: 12.5, lineHeight: 1.65, outline: "none" }} />

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input ref={shotRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onShots(e.target.files)} />
              <button className="td-btn" onClick={() => shotRef.current?.click()}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 15px", fontFamily: SANS, fontSize: 12.5, cursor: "pointer" }}>
                <ImagePlus size={15} /> 캡처 이미지 첨부</button>
              <span style={{ fontSize: 12, color: C.faint }}>긴 로그는 텍스트 붙여넣기가 더 정확합니다. 캡처는 보조용.</span>
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

            {/* 진단하기 — 아웃라인 CTA(hover시 채움). 로그 비어있으면 비활성. 중앙정렬, 가로 300px 고정. 아이콘 없음. */}
            <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
              <button className="td-cta" onClick={diagnose} disabled={!errlog.trim()}
                style={{ width: 300, maxWidth: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 999, padding: "13px 0", fontFamily: SANS, fontSize: 14, fontWeight: 700, cursor: errlog.trim() ? "pointer" : "not-allowed", letterSpacing: "-0.01em" }}>
                Error Log 진단하기</button>
            </div>
          </div>
        )}

        {err && (<div className="td-fade" style={{ marginTop: 16, background: "rgba(239,83,80,0.08)", border: `1px solid ${C.red}55`, borderRadius: 12, padding: "13px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <CircleAlert size={17} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{err}</span></div>)}

        {report && (<div className="td-fade">
          {/* 에러 로그 진단 — 로그를 넣고 "진단하기"를 누른 경우에만. 워크플로 구조보다 먼저(실행 실패=지금 가장 급한 문제). */}
          {report.logFindings && report.logFindings.length > 0 && (
            <div style={{ marginTop: 64 }}>
              <SectionTitle>Error Diagnosis</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {report.logFindings.map((d) => {
                  const sevColor = d.sev === "high" ? C.red : d.sev === "mid" ? C.amber : C.faint;
                  const sevLabel = d.sev === "high" ? "CRITICAL" : d.sev === "mid" ? "WARNING" : "INFO";
                  return (
                  <div key={d.key} style={{ background: C.surface, border: `1.5px solid ${C.red}`, borderRadius: 14, padding: "18px 20px", boxShadow: `0 0 0 4px rgba(239,83,80,0.06)` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: d.sev === "high" ? C.red : INK, background: d.sev === "high" ? "rgba(239,83,80,0.12)" : sevColor, borderRadius: 6, padding: "3px 9px", letterSpacing: "0.02em" }}>{sevLabel}</span>
                      <span style={{ fontSize: 17, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>{d.title}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: C.dim, marginTop: 10, lineHeight: 1.6 }}>{d.cause}</div>
                    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                      {d.fixes.map((fx, k) => (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 15, background: C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1 }}>{k + 1}</div>
                          <span style={{ fontSize: 17.5, color: C.dim, lineHeight: 1.5 }}>{fx}</span>
                        </div>))}
                    </div>
                    {d.command && (
                      <div style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", position: "relative" }}>
                        <button className="td-copy" onClick={() => copy(d.command, `log-${d.key}`)} title="복사" style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", color: C.point, padding: 4, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                          {copiedKey === `log-${d.key}` ? <Check size={16} /> : <Copy size={16} />}</button>
                        <pre style={{ margin: 0, fontFamily: MONO, fontSize: 12, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6, paddingRight: 32 }}>{d.command}</pre>
                      </div>
                    )}
                  </div>);
                })}
              </div>
              <div style={{ marginTop: 12, fontSize: 11.5, color: C.faint, lineHeight: 1.5 }}>
                ※ 룰 기반 1차 진단입니다. 복잡한 Traceback의 정밀 분석은 v1.1 AI 진단(LLM)에서 다룰 예정.
              </div>
            </div>
          )}

          {/* Summary — 아래 Solution과의 구분선 제거(borderBottom 없음) */}
          {summary && (
            <div style={{ marginTop: 64, paddingBottom: 48 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, margin: "0 0 28px", flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, color: C.text, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.1 }}>Summary</h2>
                <button className="td-btn td-outline" onClick={saveReport} title="진단 결과를 Markdown(.md) 파일로 저장"
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "8px 16px", fontFamily: SANS, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  <Download size={15} /> 결과 저장 (.md)</button>
              </div>
              <p style={{ fontSize: 14.5, color: C.text, margin: "0 0 20px", lineHeight: 1.5 }}>{summary.headline}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(124px,1fr))", gap: 10, margin: "0 0 24px" }}>
                <MetricBox value={report.totalNodes} label="전체 노드" unit="개" />
                <MetricBox value={report.customPackCount} label="커스텀 pack" unit="개" />
                <MetricBox value={summary.weightCount} label="모델" unit="개" />
                <MetricBox value={report.packs.filter((p) => p.conflict).length} label="버전 충돌" unit="건" />
                <MetricBox value={report.portability.length} label="이식 위험" unit="건" />
              </div>
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
                          <span style={{ width: 3.5, height: 3.5, borderRadius: 999, background: C.point, flexShrink: 0 }} />
                          <span style={{ fontSize: 13.5, fontWeight: 650, color: C.text }}>{headLabel}</span>
                        </span>
                        {headNum && <span style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 700, color: C.point, textAlign: "right", minWidth: 44 }}>{headNum}</span>}
                      </div>
                      <span style={{ fontSize: 13.5, color: C.dim, textAlign: "right", lineHeight: 1.5 }}>{it.body}</span>
                    </div>);
                  })}
                </div>
              )}
            </div>
          )}

          {/* Solution — 위 Summary와의 구분선 제거(Summary 박스의 borderBottom을 없앰) */}
          {rx.length > 0 && (
            <div style={{ marginTop: 60, paddingBottom: 60 }}>
              <SectionTitle>Solution</SectionTitle>
              <div style={{ background: C.surface, border: `1.5px solid ${C.point}`, borderRadius: 18, padding: "18px 34px", boxShadow: `0 0 0 4px rgba(244,255,117,0.06)` }}>
                {rx.map((step, i) => {
                  const sk = `s${i}`;
                  const sopen = !!open[sk]; // s0는 기본 펼침(useState 초기값)
                  return (
                  <div key={step.key} style={{ padding: "20px 0", borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                    {/* 번호(동그라미) + 제목 + 펼침 토글 — 수직 중앙정렬 */}
                    <div onClick={() => toggle(sk)} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 15, background: C.point, color: INK, fontFamily: SANS, fontSize: 15, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ fontSize: 22.5, fontWeight: 680, color: C.text, lineHeight: 1.2, flex: 1 }}>{step.title}</div>
                      <button className="td-acc" onClick={(e) => { e.stopPropagation(); toggle(sk); }} aria-label="펼치기/접기"
                        style={{ background: "transparent", border: "none", color: C.point, padding: 2, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 0 }}>
                        {sopen ? <Minus size={26} strokeWidth={2.25} /> : <Plus size={26} strokeWidth={2.25} />}
                      </button>
                    </div>
                    {sopen && <div style={{ paddingLeft: 44, marginTop: 8 }}>
                      <div style={{ fontSize: 17.5, color: C.dim, lineHeight: 1.5 }}>{step.desc}</div>
                      {step.command && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", position: "relative" }}>
                            <button className="td-copy" onClick={() => copy(step.command, step.key)} title="전체 복사" style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", color: C.point, padding: 4, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                              {copiedKey === step.key ? <Check size={16} /> : <Copy size={16} />}</button>
                            <pre style={{ margin: 0, fontFamily: MONO, fontSize: 12, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7, paddingRight: 32 }}>{step.command}</pre>
                          </div>
                          <div style={{ marginTop: 7, fontSize: 12, color: C.faint, lineHeight: 1.45 }}>※ 한 줄씩 복사·실행을 권장합니다. 여러 줄을 한꺼번에 붙여넣어도 보통 순차 실행되지만, 중간에 인증·중복 에러가 나면 그 자리에서 멈출 수 있습니다.</div>
                          {step.warn && <div style={{ marginTop: 7, fontSize: 12, color: C.amber, lineHeight: 1.45 }}>⚠ {step.warn}</div>}
                        </div>
                      )}
                      {step.models && (
                        <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 8 }}>
                          {step.models.map((m, k) => {
                            const hf = hfLink(m.file);
                            return (
                            <div key={k} style={{ background: C.surfaceHi, borderRadius: 10, padding: "14px 34px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                  <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 4 }} />
                                  <span style={{ fontFamily: MONO, fontSize: 20, color: C.text, overflowWrap: "anywhere" }}>{m.file}</span>
                                </div>
                                <div style={{ fontFamily: MONO, fontSize: 12, color: C.point, marginTop: 8, paddingLeft: 26 }}>{m.folder}</div>
                                {m.rename && <div style={{ fontSize: 12, color: C.amber, marginTop: 6, lineHeight: 1.4, paddingLeft: 26 }}>⤷ {m.rename}</div>}
                              </div>
                              {hf && <a className="td-hf" href={hf.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>{hf.exact ? "HuggingFace에서 받기" : "HuggingFace에서 검색"} <ExternalLink size={12} /></a>}
                            </div>);
                          })}
                        </div>
                      )}
                      {step.items && (
                        <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 8 }}>
                          {step.items.map((it, k) => (
                            <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.surfaceHi, borderRadius: 10, padding: "12px 14px" }}>
                              <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 3 }} />
                              <span style={{ fontSize: 20, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.action}</span></div>))}
                        </div>
                      )}
                    </div>}
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* Findings — 박스 없는 아코디언. 헤더는 BlockHead로 통일. */}
          <div style={{ marginTop: 60, paddingBottom: 48 }}>
            <SectionTitle>Findings</SectionTitle>

            {/* 1 이식 위험 값 — Findings 제목 바로 아래 구분선 제거(borderTop 없음)
                간격 규칙: 제목↔내용 60(상단 marginTop) / 내용↔다음 순번 60(하단 paddingBottom). 모든 블록 동일. */}
            <div style={{ borderTop: "none", paddingTop: 0 }}>
              <BlockHead num="1" label="이식 위험 값" count={report.portability.length} open={open.f1} onToggle={() => toggle("f1")}
                role="다른 PC로 옮길때 생기는 호환성 이슈. 환경 의존 설정 우회와 끊어진 경로·입력 파일 정리에 대한 근거." />
              <div style={{ marginTop: open.f1 ? 60 : 0, paddingBottom: open.f1 ? 60 : 40 }}>{open.f1 && (
                report.portability.length === 0 ? <Empty text="이식 시 깨질 위험 값이 없습니다." /> : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {report.portability.map((h, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, paddingTop: i > 0 ? 16 : 0, marginTop: i > 0 ? 16 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <ChevronRight size={16} color={C.amber} style={{ flexShrink: 0 }} />
                            <span style={{ fontFamily: MONO, fontSize: 18.5, color: C.text, overflowWrap: "anywhere" }}>{h.value}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: C.green, opacity: 0.6, marginTop: 6, lineHeight: 1.5, paddingLeft: 24 }}>{h.risk}</div>
                        </div>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: C.faint, flexShrink: 0, maxWidth: "32%", textAlign: "right", overflowWrap: "anywhere" }}>{h.node}</div>
                      </div>))}
                  </div>)
              )}</div>
            </div>

            {/* 2 패키지 · 버전 — 간격 규칙 동일(상단 60 / 하단 60) */}
            <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 30 }}>
              <BlockHead num="2" label="패키지 · 버전" count={report.packs.length} open={open.f2} onToggle={() => toggle("f2")}
                role="이 워크플로가 쓰는 노드팩과 기록된 버전입니다. 처방 1단계(설치)에 들어갈 저장소의 근거입니다." />
              <div style={{ marginTop: open.f2 ? 60 : 0, paddingBottom: open.f2 ? 60 : 40 }}>{open.f2 && (<>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {report.packs.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 18, paddingTop: i > 0 ? 18 : 0, marginTop: i > 0 ? 18 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                      {/* 좌: > + pack id + repo */}
                      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <ChevronRight size={16} color={C.amber} style={{ flexShrink: 0 }} />
                          <span style={{ fontFamily: MONO, fontSize: 18.5, color: p.isCore ? C.dim : C.text, overflowWrap: "anywhere" }}>{p.id}{p.isCore && <span style={{ color: C.faint, fontSize: 13 }}> · 내장</span>}</span>
                        </div>
                        {p.repo && <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                          <GitBranch size={13} color={C.green} style={{ flexShrink: 0, opacity: 0.6 }} /><span style={{ fontFamily: MONO, fontSize: 12, color: C.green, opacity: 0.6, overflowWrap: "anywhere" }}>{p.repo}</span></div>}
                      </div>
                      {/* 버전(빨강) 블록 — "버전 충돌" 라벨 좌측(세로중앙) + 우측에 버전 칩들 줄바꿈 채움 */}
                      {(p.conflict || p.vers.length > 0) && (
                        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 0, maxWidth: 340 }}>
                          {p.conflict && <span style={{ fontSize: 12, fontWeight: 700, color: C.red, flexShrink: 0, whiteSpace: "nowrap" }}>버전 충돌</span>}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {p.vers.map((v, j) => {
                              const isHash = /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v);
                              return (
                              <span key={j} title={isHash ? `git 커밋 ${v}` : `릴리스 버전 ${v}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 12, color: p.conflict ? C.red : C.dim,
                                background: p.conflict ? "rgba(239,83,80,0.1)" : C.surfaceHi, border: `1px solid ${p.conflict ? C.red + "44" : C.line}`, borderRadius: 5, padding: "2px 8px" }}>
                                {isHash && <span style={{ fontSize: 12, color: C.faint }}>commit</span>}
                                {v}
                              </span>);
                            })}
                          </div>
                        </div>
                      )}
                      {/* 우: N종 — 맨 오른쪽 끝 보장(marginLeft auto로 버전 블록과 공간 분리) */}
                      <span style={{ marginLeft: "auto", paddingLeft: 12, fontSize: 12, color: C.faint, flexShrink: 0 }}>{p.nodeTypes.length}종</span>
                    </div>))}
                </div>
                {/* 점버전 설명 + 한 저장소 안내 — 한 묶음 `-` 개조식. gap 0 + 줄간격만으로 붙임(알트엔터처럼). 위 여백 2배(36) + 좌측 들여쓰기(indent)로 탭 들어간 느낌. */}
                {(report.packs.some((p) => p.vers.some((v) => /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v))) || report.sameRepo.length > 0) && (
                  <div style={{ marginTop: 36, paddingTop: 36, paddingLeft: 24, borderTop: `1px solid ${C.divider}` }}>
                    {report.packs.some((p) => p.vers.some((v) => /^[0-9a-f]{7,}$/i.test(v) && !/^\d+\.\d+/.test(v))) && (
                      <div style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.6, color: C.dim }}>
                        <span style={{ color: C.green, flexShrink: 0 }}>-</span>
                        <span>점 버전(<span style={{ fontFamily: MONO, color: C.text }}>1.4.5</span>)은 정식 릴리스 태그, <span style={{ fontFamily: MONO, color: C.faint }}>commit</span> 표시(<span style={{ fontFamily: MONO, color: C.text }}>a6645ed…</span>)는 특정 git 커밋에서 설치한 것입니다. 한 pack에 둘이 섞이면 재현 시 그 커밋을 checkout 해야 할 수 있어 <span style={{ color: C.red }}>버전 충돌</span>로 표시됩니다.</span>
                      </div>
                    )}
                    {report.sameRepo.map((s) => (
                      <div key={s.repo} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.6, color: C.dim }}>
                        <span style={{ color: C.green, flexShrink: 0 }}>-</span>
                        <span><b style={{ color: C.green }}>{s.ids.join(" + ")}</b> 는 모두 <span style={{ fontFamily: MONO, color: C.green }}>{s.repo}</span> 하나에서 나옵니다. 한 번만 설치하면 됩니다.</span>
                      </div>))}
                  </div>)}
              </>)}</div>
            </div>

            {/* 3 출처 추정 노드 — 간격 규칙 동일(상단 60 / 하단 60) */}
            <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 30 }}>
              <BlockHead num="3" label="출처 추정 노드" count={report.unmapped.length} open={open.f3} onToggle={() => toggle("f3")}
                role="메타데이터가 없어 이름으로 출처를 추측한 노드입니다. 설치 후 반드시 Manager에서 한번 더 확인하세요." />
              <div style={{ marginTop: open.f3 ? 60 : 0, paddingBottom: open.f3 ? 60 : 40 }}>{open.f3 && (<>
                {report.unmapped.length === 0 ? <Empty text="cnr_id 없는 노드가 모두 출처로 해소됩니다." /> : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {report.unmapped.map((u, i) => (
                      <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 18.5, color: C.text, minWidth: 0, flex: 1 }}>
                          <ChevronRight size={16} color={C.amber} style={{ flexShrink: 0 }} /><span style={{ overflowWrap: "anywhere" }}>{u.type}</span></div>
                        {u.repo ? <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, maxWidth: "45%", justifyContent: "flex-end" }}>
                          <GitBranch size={11} color={C.green} style={{ flexShrink: 0 }} /><span style={{ fontFamily: MONO, fontSize: 12, color: C.green, overflowWrap: "anywhere", textAlign: "right" }}>{u.repo} · 추정</span></div>
                          : <div style={{ fontSize: 12, color: C.faint, flexShrink: 0, textAlign: "right" }}>출처 미상 — Manager로 확인</div>}
                      </div>))}
                  </div>)}
                {report.frontendOnly.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.divider}`, fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
                    프론트엔드 전용(설치 불필요)으로 제외: <span style={{ fontFamily: MONO }}>{report.frontendOnly.join(", ")}</span></div>)}
              </>)}</div>
            </div>
          </div>

          {/* Inventory — Findings와 동일한 BlockHead 헤더 사용 (푸터 위 구분선 제거) */}
          <div style={{ marginTop: 60, paddingBottom: 48 }}>
            <SectionTitle>Inventory</SectionTitle>

            {/* 1 모델 · 자산 인벤토리 — 간격 규칙 Findings와 동일. 제목 바로 아래 구분선 제거(borderTop 없음). 하단 여백은 펼침/닫힘 무관 항상 60. */}
            <div style={{ borderTop: "none", paddingTop: 0 }}>
              <BlockHead num="1" label="모델 · 자산 인벤토리" count={report.models.length} open={open.i1} onToggle={() => toggle("i1")}
                role="워크플로가 참조하는 모델·자산 전체입니다. 처방의 '다운로드' 단계는 이 중 가중치 파일만 추린 것입니다." />
              <div style={{ marginTop: open.i1 ? 60 : 0, paddingBottom: open.i1 ? 60 : 40 }}>{open.i1 && (
                report.models.length === 0 ? <Empty text="참조된 모델 파일을 찾지 못했습니다." /> : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {report.models.map((m, i) => {
                      const hf = hfLink(m.file);
                      return (
                      <div key={i} style={{ aspectRatio: "3 / 2", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", overflow: "hidden" }}>
                        <span style={{ fontFamily: MONO, fontSize: 18.5, color: C.text, overflowWrap: "anywhere", lineHeight: 1.35 }}>{m.file}</span>
                        <span style={{ fontFamily: SANS, fontSize: 14, color: /추정/.test(m.folder) ? C.green : C.point, opacity: /추정/.test(m.folder) ? 0.6 : 1, marginTop: 8, lineHeight: 1.4 }}>{m.folder}</span>
                        {m.rename && <span style={{ fontSize: 12, color: C.amber, marginTop: 7, lineHeight: 1.4 }}>⤷ {m.rename}</span>}
                        {hf && <a className="td-hf-sm" href={hf.url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 20 }}>{hf.exact ? "다운로드" : "찾아보기"}</a>}
                      </div>);
                    })}
                  </div>)
              )}</div>
            </div>

            {/* 2 비활성 노드 — 간격 규칙 동일(상단 60 / 하단 60), 1번과 구분선으로 분리 */}
            <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 30 }}>
              <BlockHead num="2" label="비활성 노드" count={report.muted.length} open={open.i2} onToggle={() => toggle("i2")}
                role="꺼졌거나(muted) 우회된(bypass) 노드입니다. 의도한 게 아니라면 결과가 달라질 수 있어 점검 대상입니다." />
              <div style={{ marginTop: open.i2 ? 60 : 0, paddingBottom: open.i2 ? 60 : 40 }}>{open.i2 && (
                report.muted.length === 0 ? <Empty text="muted/bypass된 노드가 없습니다." /> : (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {report.muted.map((m, i) => (<div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0, borderTop: i > 0 ? `1px solid ${C.divider}` : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <ChevronRight size={16} color={C.amber} style={{ flexShrink: 0 }} /><span style={{ fontFamily: MONO, fontSize: 18.5, color: C.text, overflowWrap: "anywhere" }}>{m.type}</span></div>
                      <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint, flexShrink: 0 }}>{m.mode === 4 ? "bypass" : "muted"}</span></div>))}
                  </div>)
              )}</div>
            </div>
          </div>

          <p style={{ marginTop: 120, fontSize: 12, color: C.faint, lineHeight: 1.6, textAlign: "center" }}>
            pytorch·cuda·python 버전 호환성은 각 pack의 requirements.txt 영역으로 JSON 파일만으로는 확인할 수 없음. AI 진단(에러 로그 + JSON 컨텍스트 → LLM) 업데이트 예정.
            <br />
            <a href="https://no1jhk.space" target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: MONO, color: C.faint, textDecoration: "none", letterSpacing: "0.02em" }}>
              Built by Joon Hyung Kim · no1jhk.space
            </a>
          </p>
        </div>)}

        {!report && !err && (<div style={{ marginTop: 40, textAlign: "center", color: C.faint, fontSize: 13 }}>
          <Boxes size={26} strokeWidth={1.25} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 10 }}>파일을 올리거나 "샘플로 보기"로 시작하세요.</div></div>)}
      </div>
    </div>
  );
}
