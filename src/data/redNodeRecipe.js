// src/data/redNodeRecipe.js
// 워크플로 JSON → "모델 보유 노드"별 탭·슬롯·폴더·URL 교정 레시피 추출.
// red 확정(디스크 상태)은 하지 않는다 — 상태를 모르면 전부 "교정 대상"으로 둔다.
// 브라우저(ESM import)·node(콘솔 검증) 양쪽 안전: node 전용 모듈은 main 가드 안에서 동적 import.

const MODEL_EXT = /\.(safetensors|gguf|ckpt|pt|bin)$/i;
const QUANT_BAD = /nvfp4|fp4|fp8/i;

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
export function buildRecipes(json, { gpu = "ampere" } = {}) {
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
      return { slot, value, ...r, quantBad: gpu === "ampere" && QUANT_BAD.test(value) }; // 8. 양자화 비호환
    });
    const recipe = { id: n.id, type: n.type, tab: n.properties?.pipeline_mode || null, sub: n._inSubgraph || null, slots };
    if (offsetWarning) recipe.__offset_warning = true;
    recipes.push(recipe);
  }
  return recipes;
}
export default buildRecipes;

// ── 검증(콘솔): node src/data/redNodeRecipe.js <workflow.json> ──
async function main() {
  const fs = await import("node:fs");
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
}
const isNode = typeof process !== "undefined" && process.versions?.node;
if (isNode && process.argv[1] && /redNodeRecipe\.js$/.test(process.argv[1])) main();
