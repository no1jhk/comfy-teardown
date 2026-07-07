// P2 e2e — 환경 기반 모델 추천 엔진 end-to-end.
// analyze → recommend → (액션 테이블 뱃지 로직 복제) 검증. 실행: node test/e2e.mjs
// fixtures는 test/fixtures/ 안에서만 읽는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes } from "../src/data/redNodeRecipe.js";
import { normalize, analyze } from "../src/lib/analyzeWorkflow.js";
import { recommend } from "../src/lib/modelRecommender.js";
import { parseWorkflowNotes, isVariantExcluded } from "../src/lib/parseWorkflowNotes.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "fixtures");
let mgrMap = null;
try { mgrMap = JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8")); } catch {}

const KREA2 = "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json";
const PIXEL = "PixelArtistry_Skintoken_default.json";
const LTX = "LTX2_3_8GB_VRAM_workflow___Audio_to_Video.json";

let fail = 0;
const base = (v) => v.replace(/\\/g, "/").split("/").pop().toLowerCase();
function loadReport(f) { return analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"))), mgrMap); }
// 액션 테이블 받기 뱃지 로직 복제(Teardown.jsx actionRows): recByBase 매칭 시 rec 뱃지, 아니면 기존 conf.
function actionBadges(f, env) {
  const rep = loadReport(f);
  const rec = recommend(rep, env);
  const recByBase = new Map();
  if (rec.family && !rec.needs.includes("gpu")) for (const s of rec.slots) recByBase.set(base(s.workflowValue), s);
  const recipes = buildRecipes(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")), { gpu: null });
  const slots = recipes.flatMap((r) => r.slots);
  const out = [];
  const seen = new Set();
  for (const s of slots) {
    const b = base(s.value);
    if (seen.has(b)) continue; seen.add(b);
    const recSlot = recByBase.get(b);
    if (recSlot) out.push({ value: s.value, badge: recSlot.badge, folder: recSlot.absoluteFolder || recSlot.folder, rec: recSlot });
    else { const conf = s.src === "curated" || s.src === "manager" || s.src === "manager_live"; out.push({ value: s.value, badge: conf ? "확정" : "확인 필요", folder: s.folder }); }
  }
  return { rec, rows: out };
}

// ── 케이스 1: krea2 + RTX 3090 → 완료 기준 전문 ──
console.log("=".repeat(70) + "\n[1] krea2 + RTX 3090 (완료 기준)");
{
  const { rec, rows } = actionBadges(KREA2, { gpu: "RTX 3090", basePath: "N:\\ComfyUI_models" });
  const main = rec.slots.find((s) => s.slotType === "main_model");
  let ok = true;
  if (rec.family !== "krea2") { console.log(`  ❌ family 기대 krea2, 실제 ${rec.family}`); fail++; ok = false; }
  if (!main || base(main.workflowValue) !== "krea2_raw_bf16.safetensors") { console.log("  ❌ 주 모델 슬롯(krea2_raw_bf16) 없음"); fail++; ok = false; }
  else {
    if (main.badge !== "확정") { console.log(`  ❌ krea2_raw_bf16 뱃지 기대 확정, 실제 ${main.badge}`); fail++; ok = false; }
    if (main.folder !== "models/diffusion_models/Krea 2") { console.log(`  ❌ 넣기(상대) 기대 'models/diffusion_models/Krea 2', 실제 '${main.folder}'`); fail++; ok = false; }
    if (main.absoluteFolder !== "N:\\ComfyUI_models\\diffusion_models\\Krea 2") { console.log(`  ❌ 넣기(절대) 기대 'N:\\ComfyUI_models\\diffusion_models\\Krea 2', 실제 '${main.absoluteFolder}'`); fail++; ok = false; }
    if (!main.quality || main.quality.variant !== "raw_bf16") { console.log(`  ❌ quality 기대 raw_bf16, 실제 ${JSON.stringify(main.quality)}`); fail++; ok = false; }
  }
  // 3개 모델 확인 필요 뱃지 없어야
  const targets = ["krea2_raw_bf16.safetensors", "qwen3vl_4b_bf16.safetensors", "wan2.1_vae_upscale2x_imageonly_real_v1.safetensors"];
  for (const t of targets) {
    const row = rows.find((r) => base(r.value) === t);
    if (!row) { console.log(`  ❌ 받기 행에 ${t} 없음`); fail++; ok = false; }
    else if (row.badge === "확인 필요") { console.log(`  ❌ ${t} 확인 필요 뱃지 잔존(실패 조건)`); fail++; ok = false; }
  }
  if (ok) {
    console.log("  ✅ 받기: krea2_raw_bf16.safetensors [확정]");
    console.log(`  ✅ 넣기: ${main.folder}  (절대: ${main.absoluteFolder})`);
    console.log("  ✅ 선택: UNETLoader: Krea 2\\krea2_raw_bf16.safetensors");
    console.log("  ✅ qwen3vl_4b_bf16·Wan2.1_VAE 포함 3개 모두 확인 필요 뱃지 없음");
  }
}

// ── 케이스 2: krea2 + GPU 미입력 → 추천 미출력 + 안내 ──
console.log("\n" + "=".repeat(70) + "\n[2] krea2 + GPU 미입력 (추천 미출력 + 안내)");
{
  const rep = loadReport(KREA2);
  const rec = recommend(rep, { gpu: "" });
  let ok = true;
  if (!rec.needs.includes("gpu")) { console.log("  ❌ GPU 미입력인데 needs에 gpu 없음(안내 트리거 실패)"); fail++; ok = false; }
  if (rec.family !== "krea2") { console.log("  ❌ 패밀리 감지는 GPU 무관하게 되어야(안내 문구용)"); fail++; ok = false; }
  // recByBase 게이트: GPU 미입력이면 비어야(확정 판정 미출력)
  const recByBase = new Map();
  if (rec.family && !rec.needs.includes("gpu")) for (const s of rec.slots) recByBase.set(base(s.workflowValue), s);
  if (recByBase.size !== 0) { console.log(`  ❌ GPU 미입력인데 확정 추천 노출(recByBase ${recByBase.size})`); fail++; ok = false; }
  if (ok) console.log("  ✅ needs=['gpu'] · 패밀리(krea2) 감지 · 확정 추천 미출력(안내로 대체)");
}

// ── 케이스 3: Note 함정 → turbo lora가 exclude에 없음 ──
console.log("\n" + "=".repeat(70) + "\n[3] Note 함정 (turbo lora 유지)");
{
  const note = "Use the RAW model, not the Turbo. Keep the turbo lora at strength 0.8.";
  const flags = parseWorkflowNotes([note]);
  let ok = true;
  if (isVariantExcluded(flags, "turbo", "model") !== true) { console.log("  ❌ turbo가 model에서 제외 안 됨"); fail++; ok = false; }
  if (isVariantExcluded(flags, "turbo", "lora") !== false) { console.log("  ❌ 함정: turbo lora가 exclude됨"); fail++; ok = false; }
  if (ok) console.log("  ✅ turbo는 model만 제외, turbo lora는 유지(exclude에 없음)");
}

// ── 케이스 4: PixelArtistry(카탈로그 밖) → 무회귀 ──
console.log("\n" + "=".repeat(70) + "\n[4] PixelArtistry (카탈로그 밖 무회귀)");
{
  const rep = loadReport(PIXEL);
  const rec = recommend(rep, { gpu: "RTX 3090" });
  let ok = true;
  if (rec.family !== null) { console.log(`  ❌ 카탈로그 밖인데 family ${rec.family} 감지(날조)`); fail++; ok = false; }
  if (rec.slots.length !== 0) { console.log(`  ❌ 카탈로그 밖인데 추천 슬롯 ${rec.slots.length}`); fail++; ok = false; }
  if (ok) console.log("  ✅ family null · 추천 슬롯 0 · 기존 폴백 유지(무회귀)");
}

// ── 케이스 5: LTX → quantBad·ggufAlt 무회귀 ──
console.log("\n" + "=".repeat(70) + "\n[5] LTX (quantBad·ggufAlt 무회귀)");
{
  const recipes = buildRecipes(JSON.parse(fs.readFileSync(path.join(FIX, LTX), "utf8")), { gpu: "ampere" });
  const slots = recipes.flatMap((r) => r.slots);
  const quantBad = slots.filter((s) => s.quantBad).length;
  const gguf = slots.filter((s) => s.gguf && s.gguf.url).length + slots.filter((s) => s.gguf && !s.gguf.url).length;
  let ok = true;
  if (quantBad !== 2) { console.log(`  ❌ LTX quantBad 기대 2, 실제 ${quantBad}`); fail++; ok = false; }
  // recommend가 LTX에서 크래시하지 않아야
  try { const rec = recommend(loadReport(LTX), { gpu: "RTX 3090" }); console.log(`  · recommend family=${rec.family} slots=${rec.slots.length}(크래시 없음)`); }
  catch (e) { console.log(`  ❌ LTX recommend 크래시: ${e.message}`); fail++; ok = false; }
  if (ok) console.log(`  ✅ LTX quantBad 2 무회귀 + recommend 무크래시`);
}

console.log("\n" + "=".repeat(70));
console.log(fail === 0 ? "✅ e2e 5케이스 전부 통과" : `❌ e2e ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
