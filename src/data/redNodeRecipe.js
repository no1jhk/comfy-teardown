// src/data/redNodeRecipe.js
// 워크플로 JSON → "모델 보유 노드"별 탭·슬롯·폴더·URL 교정 레시피 추출.
// red 확정(디스크 상태)은 하지 않는다 — 상태를 모르면 전부 "교정 대상"으로 둔다.
// 브라우저(ESM import)·node(콘솔 검증) 양쪽 안전: node 전용 모듈은 main 가드 안에서 동적 import.

import ggufFileMap from "./gguf_file_map.json" with { type: "json" };

const MODEL_EXT = /\.(safetensors|gguf|ckpt|pt|bin)$/i;
const QUANT_BAD = /nvfp4|fp4|fp8/i;

function lookupGgufAlt(filename) {
  const low = filename.toLowerCase();
  for (const m of (ggufFileMap?.maps || [])) {
    if (m.match.some((kw) => low.includes(kw.toLowerCase()))) {
      return m.alternatives.length ? { alternatives: m.alternatives } : { pending: true };
    }
  }
  return null;
}

// 10. SLOT_FOLDER / TYPE_FOLDER — Teardown.jsx의 NODE_FOLDER_MAP과 같은 값.
const TYPE_FOLDER = {
  UNETLoader: "models/unet",
  CLIPLoader: "models/text_encoders",
  DualCLIPLoader: "models/text_encoders",
  VAELoader: "models/vae",
  LoraLoader: "models/loras",
  LoraLoaderModelOnly: "models/loras",
  CheckpointLoaderSimple: "models/checkpoints",
  LatentUpscaleModelLoader: "models/latent_upscale_models",
  UpscaleModelLoader: "models/upscale_models",
};
const SLOT_FOLDER = {
  gguf_unet_name: "models/unet",
  diffusion_model_name: "models/unet",
  unet_name: "models/unet",
  video_vae_name: "models/vae",
  audio_vae_name: "models/vae",
  vae_name: "models/vae",
  text_encoder_name: "models/text_encoders",
  text_projection_name: "models/text_encoders",
  clip_name: "models/text_encoders",
  checkpoint_name: "models/checkpoints",
  ckpt_name: "models/checkpoints",
  lora_name: "models/loras",
};

function normFolder(d) {
  if (!d || typeof d !== "string") return null;
  return d.startsWith("models/") ? d : "models/" + d.replace(/^\/+/, "");
}

// 1. flatten — json.nodes + definitions.subgraphs[].nodes 재귀 평탄화. 서브그래프 노드엔 _inSubgraph 태그.
export function flatten(json) {
  const out = [];
  // API 포맷: 최상위가 노드ID 키 + 각 값에 class_type (json.nodes 없음). 내부 노드 형태로 변환.
  //   inputs 객체는 _apiInputs로 넘겨 alignSlots가 직접 파싱. properties.models는 대개 없음 → rule fallback.
  if (json && typeof json === "object" && !Array.isArray(json.nodes)) {
    const apiEntries = Object.entries(json).filter(([, v]) => v && typeof v === "object" && v.class_type);
    if (apiEntries.length) {
      for (const [id, v] of apiEntries)
        out.push({ id, type: v.class_type, mode: 0, properties: v.properties || {}, _apiInputs: v.inputs || {} });
      return out;
    }
  }
  const push = (nodes, tag) => { for (const n of nodes || []) out.push(tag ? { ...n, _inSubgraph: tag } : n); };
  push(json?.nodes, null);
  const walk = (defs) => {
    for (const sg of defs?.subgraphs || []) {
      push(sg.nodes, sg.name || sg.id || "subgraph");
      walk(sg.definitions); // 중첩 서브그래프 재귀
    }
  };
  walk(json?.definitions);
  return out;
}

function dedupeModels(models) {
  if (!Array.isArray(models)) return [];
  const seen = new Set(); const out = [];
  for (const m of models) { if (!m?.name || seen.has(m.name)) continue; seen.add(m.name); out.push(m); }
  return out;
}

// 6-(2). DenoLTXModelDownloader.widgets_values 안 JSON 매니페스트 추출 + active preset의 files[] 조회.
function extractManifest(nodes) {
  const dn = nodes.find((n) => /DenoLTXModelDownloader/i.test(n.type || ""));
  if (!dn) return null;
  for (const v of dn.widgets_values || []) {
    if (typeof v === "string" && v.trim().startsWith("{")) {
      try { const m = JSON.parse(v); if (m && (m.presets || m.active_preset_id)) return m; } catch { /* not the manifest */ }
    }
  }
  return null;
}
function manifestLookup(manifest, filename) {
  if (!manifest) return null;
  const presets = manifest.presets || [];
  const pid = manifest.active_preset_id;
  const preset = Array.isArray(presets) ? presets.find((p) => p.id === pid) : presets[pid];
  if (!preset) return null;
  const f = (preset.files || []).find((x) => x.filename === filename);
  return f ? { folder: normFolder(f.target_subdir), url: f.url } : null;
}

// Canonical slot name per TYPE_FOLDER node type (fallback when inputs lack widget.name).
const TYPE_SLOT = {
  UNETLoader: "unet_name", CLIPLoader: "clip_name", DualCLIPLoader: "clip_name",
  VAELoader: "vae_name", CheckpointLoaderSimple: "ckpt_name",
  LoraLoader: "lora_name", LoraLoaderModelOnly: "lora_name",
  LatentUpscaleModelLoader: "model_name", UpscaleModelLoader: "model_name",
};

// 5. 슬롯명↔값 정렬 (phantom offset 보정 — 순진한 zip 금지).
function alignSlots(n) {
  // API 포맷: inputs가 {슬롯명: 값} 객체 → *_name류 파일값 직접 추출 (phantom-offset 없음).
  if (n._apiInputs) {
    const pairs = Object.entries(n._apiInputs)
      .filter(([s, v]) => /_name$/.test(s) && typeof v === "string" && MODEL_EXT.test(v));
    return { pairs, offsetWarning: false };
  }
  const widgetSlots = (n.inputs || []).filter((i) => i?.widget?.name).map((i) => i.widget.name);
  const vals = Array.isArray(n.widgets_values) ? n.widgets_values : [];
  if (widgetSlots.length && widgetSlots.length === vals.length) {
    return { pairs: widgetSlots.map((s, i) => [s, vals[i]]), offsetWarning: false };
  }
  if (widgetSlots.length) {
    // 불일치: 빈 슬롯이 낀 것 → 파일확장자 값만 추려 파일류 슬롯명 순서대로 매칭.
    const fileSlots = widgetSlots.filter((s) => /_name$/.test(s));
    const fileVals = vals.filter((v) => typeof v === "string" && MODEL_EXT.test(v));
    return { pairs: fileSlots.map((s, i) => [s, fileVals[i] ?? null]), offsetWarning: true };
  }
  // No widget-named inputs (e.g. Flux standard loaders) — infer slot from TYPE_SLOT + positional file values.
  const fileVals = vals.filter((v) => typeof v === "string" && MODEL_EXT.test(v));
  const slot = TYPE_SLOT[n.type];
  if (slot && fileVals.length) {
    return { pairs: fileVals.map((v, i) => [i === 0 ? slot : `${slot}_${i}`, v]), offsetWarning: false };
  }
  return { pairs: [], offsetWarning: false };
}

// 3. 모델 보유 노드 판별.
function isModelNode(n, pairs) {
  if (TYPE_FOLDER[n.type]) return true;
  if (/Loader|Preset/.test(n.type || "")) return true;
  return pairs.some(([s, v]) => /_name$/.test(s) && typeof v === "string" && MODEL_EXT.test(v));
}

// 6 + 7. 폴더/URL 해결 — 우선순위: (1)properties.models > (2)manifest > (3)SLOT_FOLDER > (4)TYPE_FOLDER > (5)확인 필요.
//        properties.models가 (3)(4) 규칙을 이긴다(author값 우선). 위젯값 ≠ properties.models.name이면 둘 다 남김.
function resolveSlot(n, slot, value, manifest) {
  const ruleFolder = SLOT_FOLDER[slot] || TYPE_FOLDER[n.type] || null;
  const models = dedupeModels(n.properties?.models);
  // (1) properties.models name 정확 매칭
  const exact = models.find((m) => m.name === value);
  if (exact) return { folder: normFolder(exact.directory) || ruleFolder || "확인 필요", url: exact.url || "확인 필요", src: "properties.models" };
  // (7) 위젯 선택값 ≠ properties.models.name 이지만 properties.models 존재 → author 우선 + currentValue 병기
  if (models.length) {
    const ar = models.find((m) => normFolder(m.directory) === ruleFolder) || models[0];
    return {
      folder: normFolder(ar.directory) || ruleFolder || "확인 필요",
      url: ar.url || "확인 필요",
      src: "properties.models",
      currentValue: value,
      authorRecommend: { name: ar.name, directory: ar.directory, url: ar.url || "확인 필요" },
    };
  }
  // (2) manifest
  const mf = manifestLookup(manifest, value);
  if (mf) return { folder: mf.folder, url: mf.url || "확인 필요", src: "manifest" };
  // (3) SLOT_FOLDER / (4) TYPE_FOLDER
  if (ruleFolder) return { folder: ruleFolder, url: "확인 필요", src: "rule" };
  // (5)
  return { folder: "확인 필요", url: "확인 필요", src: "none" };
}

// 9. 워크플로 JSON → 레시피 배열.
export function buildRecipes(json, { gpu = null } = {}) {
  const nodes = flatten(json).filter((n) => n.mode !== 4 && n.mode !== 2); // 2. bypass/mute 제외
  const manifest = extractManifest(nodes);
  const recipes = [];
  for (const n of nodes) {
    const { pairs, offsetWarning } = alignSlots(n);
    if (!isModelNode(n, pairs)) continue;
    const modelPairs = pairs.filter(([s, v]) => /_name$/.test(s) && typeof v === "string" && MODEL_EXT.test(v));
    if (!modelPairs.length) continue;
    const slots = modelPairs.map(([slot, value]) => {
      const r = resolveSlot(n, slot, value, manifest);
      const fpMatch = value.match(QUANT_BAD); // fp8/fp4/nvfp4 형식 매칭
      const qb = gpu === "ampere" && !!fpMatch; // 판정: GPU 입력 + ampere일 때만 (미입력 시 추정 금지)
      const quantUnknown = !gpu && !!fpMatch;   // GPU 미입력 + fp 파일 → 안내용(판정 아님, 등급 무관)
      return { slot, value, ...r, quantBad: qb, quantUnknown, quantFmt: fpMatch ? fpMatch[0] : null, ggufAlt: qb ? lookupGgufAlt(value) : null }; // 8. 양자화 비호환 + GGUF 대안
    });
    const recipe = { id: n.id, type: n.type, tab: n.properties?.pipeline_mode || null, tabColor: n.bgcolor || n.color || null, sub: n._inSubgraph || null, slots };
    if (offsetWarning) recipe.__offset_warning = true;
    recipes.push(recipe);
  }
  return recipes;
}

// 미씽 커스텀 노드를 repo 키로 그룹핑. 같은 repo는 clone 1회로 묶음. 화면·CLI 겸용(순수 함수).
export function groupNodesByRepo(unmapped) {
  const groups = new Map();
  const solo = [];
  for (const u of (unmapped || [])) {
    if (u.isCore) continue;
    const key = u.repo || u.clone_url;
    if (!key) { solo.push(u); continue; }
    if (!groups.has(key)) groups.set(key, { repo: u.repo, clone_url: u.clone_url, repoSrc: u.repoSrc, manager_searchable: u.manager_searchable, registry: u.registry, install_note: u.install_note, ids: [], types: [] });
    const g = groups.get(key);
    g.ids.push(u.id); g.types.push(u.type);
  }
  return { groups: [...groups.values()], solo };
}
export default buildRecipes;

// ── 검증(콘솔): node src/data/redNodeRecipe.js <workflow.json> ──
// Vite가 import("node:fs")를 정적 분석해 경고를 내므로, 브라우저에서는 main 자체를 정의하지 않는다.
const isNode = typeof process !== "undefined" && process.versions?.node;
if (isNode && process.argv[1] && /redNodeRecipe\.js$/.test(process.argv[1])) {
  (async () => {
    const _m = "node:" + "fs"; const fs = await import(_m);
    const file = process.argv[2];
    if (!file) { console.error("usage: node redNodeRecipe.js <workflow.json>"); process.exit(1); }
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const recipes = buildRecipes(json);
    console.log(`\n=== ${file} — 모델 노드 ${recipes.length}개 ===`);
    for (const r of recipes) {
      const head = `[${r.type}] #${r.id}` + (r.tab ? ` · 탭:${r.tab}` : "") + (r.sub ? ` · sub:${r.sub}` : "") + (r.__offset_warning ? " ⚠offset" : "");
      console.log("\n" + head);
      for (const s of r.slots) {
        console.log(`  ${s.slot} = ${s.value}`);
        console.log(`    → ${s.folder} (${s.src}) · URL ${s.url}` + (s.quantBad ? "  ⚠비호환" : ""));
        if (s.authorRecommend) console.log(`    author추천: ${s.authorRecommend.name} → ${normFolder(s.authorRecommend.directory)} (현재선택: ${s.currentValue})`);
      }
    }
  })();
}
