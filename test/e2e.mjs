// P2 e2e — 검증된 모델 선택 엔진 end-to-end. 실행: node test/e2e.mjs
// 화면·인벤토리·MD·브리핑이 공유하는 buildModelPlan(단일 진실 공급원)을 검증한다.
// buildBriefing/buildMarkdown은 Teardown.jsx(JSX)라 node import 불가 → 공유 소스(modelPlan)로 검증.
// fixtures는 test/fixtures/ 안에서만 읽는다. 파일명은 startsWith로 탐색(유니코드 안전).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildRecipes } from "../src/data/redNodeRecipe.js";
import { normalize, analyze } from "../src/lib/analyzeWorkflow.js";
import { recommend } from "../src/lib/modelRecommender.js";
import { buildModelPlan } from "../src/lib/modelPlan.js";
import { parseWorkflowNotes, isVariantExcluded } from "../src/lib/parseWorkflowNotes.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "fixtures");
let mgrMap = null;
try { mgrMap = JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8")); } catch {}

const findFix = (prefix) => fs.readdirSync(FIX).find((f) => f.startsWith(prefix) && f.endsWith(".json"));
const KREA2 = findFix("krea2_simple_full_turbo");
const PIXEL = findFix("PixelArtistry_Skintoken_default");
const LTX = findFix("LTX2_3_8GB_VRAM_workflow");

let fail = 0;
const base = (v) => v.replace(/\\/g, "/").split("/").pop().toLowerCase();
function loadReport(f) { return analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"))), mgrMap); }
// 화면 액션 테이블이 쓰는 것과 동일하게 plan.items/unknowns → 받기 행(뱃지·폴더·직링크).
function planRows(f, env) {
  const plan = buildModelPlan(loadReport(f), env);
  const rows = [
    ...plan.items.map((it) => ({ value: it.workflowValue, file: it.selectedFile, badge: it.badge, folder: it.fullPath || it.folder, size: it.size, repo: it.sourceRepo, url: it.downloadUrl, confidence: it.confidence })),
    ...plan.unknowns.map((it) => ({ value: it.workflowValue, file: it.selectedFile, badge: "확인 필요", folder: it.folder, confidence: "unknown" })),
  ];
  return { plan, rows };
}

// ── 케이스 1: krea2 + RTX 3090 → 완료 기준 전문(confirmed 실측) ──
console.log("=".repeat(70) + "\n[1] krea2 + RTX 3090 (완료 기준 · confirmed 실측)");
{
  const { plan, rows } = planRows(KREA2, { gpu: "RTX 3090", basePath: "N:\\ComfyUI_models" });
  const main = plan.items.find((i) => i.role === "main_model");
  let ok = true;
  if (plan.family !== "krea2") { console.log(`  ❌ family 기대 krea2, 실제 ${plan.family}`); fail++; ok = false; }
  if (!main || main.selectedFile !== "krea2_raw_bf16.safetensors") { console.log("  ❌ 주 모델(krea2_raw_bf16) 없음"); fail++; ok = false; }
  else {
    if (main.confidence !== "confirmed") { console.log(`  ❌ confidence 기대 confirmed, 실제 ${main.confidence}`); fail++; ok = false; }
    if (main.fullPath !== "N:\\ComfyUI_models\\diffusion_models\\Krea 2") { console.log(`  ❌ 넣기 기대 'N:\\ComfyUI_models\\diffusion_models\\Krea 2', 실제 '${main.fullPath}'`); fail++; ok = false; }
    if (main.size !== "26.3GB") { console.log(`  ❌ 용량 기대 26.3GB, 실제 ${main.size}`); fail++; ok = false; }
    if (main.sourceRepo !== "Comfy-Org/Krea-2") { console.log(`  ❌ 출처 기대 Comfy-Org/Krea-2, 실제 ${main.sourceRepo}`); fail++; ok = false; }
    if (!/Comfy-Org\/Krea-2\/blob\/main\/diffusion_models\/krea2_raw_bf16/.test(main.downloadUrl || "")) { console.log(`  ❌ 직링크 이상: ${main.downloadUrl}`); fail++; ok = false; }
  }
  const targets = ["krea2_raw_bf16.safetensors", "qwen3vl_4b_bf16.safetensors", "wan2.1_vae_upscale2x_imageonly_real_v1.safetensors"];
  for (const t of targets) {
    const it = plan.items.find((i) => i.selectedFile === t);
    if (!it) { console.log(`  ❌ ${t}가 plan.items에 없음(unknowns로 빠짐?)`); fail++; ok = false; }
    else if (it.confidence !== "confirmed") { console.log(`  ❌ ${t} confidence ${it.confidence}(confirmed 기대)`); fail++; ok = false; }
    else if (/unet|확인 필요/.test(it.folder || "")) { console.log(`  ❌ ${t} 폴더에 models/unet·확인 필요 잔존: ${it.folder}`); fail++; ok = false; }
  }
  // 워크플로우 실제 요구 VAE는 Wan2.1_VAE_upscale2x. Note의 대체(qwen_image_vae)로 치환되면 실패(실측: 워크플로우 참조값 우선)
  const vae = plan.items.find((i) => i.role === "vae");
  if (vae?.selectedFile !== "wan2.1_vae_upscale2x_imageonly_real_v1.safetensors" || /qwen_image_vae/i.test(vae?.selectedFile || "")) { console.log(`  ❌ VAE selectedFile 기대 Wan2.1_VAE_upscale2x, 실제 ${vae?.selectedFile}`); fail++; ok = false; }
  if (vae && vae.size !== "484MB") { console.log(`  ❌ VAE 용량 기대 484MB(실측), 실제 ${vae.size}`); fail++; ok = false; }
  if (ok) {
    console.log("  ✅ Main Model: krea2_raw_bf16.safetensors [confirmed] 26.3GB Comfy-Org/Krea-2");
    console.log(`  ✅ 넣기: ${main.fullPath}`);
    console.log("  ✅ 3모델(main·text·vae) 전부 confirmed · models/unet·확인 필요 없음");
    console.log(`  ✅ VAE: ${vae.selectedFile} · ${vae.size}(qwen_image_vae 치환 아님)`);
  }
}

// ── 케이스 2: krea2 + GPU 미입력 → 파일 확정은 유지(GPU 무관), 대체 판정만 미출력 ──
console.log("\n" + "=".repeat(70) + "\n[2] krea2 + GPU 미입력 (파일 확정 유지 · 대체 판정 게이트)");
{
  const plan = buildModelPlan(loadReport(KREA2), { gpu: "" });
  let ok = true;
  if (!plan.needs.includes("gpu")) { console.log("  ❌ GPU 미입력 needs=gpu 아님"); fail++; ok = false; }
  const main = plan.items.find((i) => i.role === "main_model");
  if (main?.confidence !== "confirmed") { console.log("  ❌ 파일 존재 confirmed는 GPU 무관해야(files DB)"); fail++; ok = false; }
  if (plan.alternatives.length !== 0) { console.log(`  ❌ GPU 미입력인데 대체 후보 출력(${plan.alternatives.length}) — 불변① 위반`); fail++; ok = false; }
  if (ok) console.log("  ✅ needs=gpu · 파일 confirmed 유지(GPU 무관) · 대체 후보 미출력(GPU 판정 게이트)");
}

// ── 케이스 3: Note 함정 → turbo lora 유지 ──
console.log("\n" + "=".repeat(70) + "\n[3] Note 함정 (turbo lora 유지)");
{
  const flags = parseWorkflowNotes(["Use the RAW model, not the Turbo. Keep the turbo lora at strength 0.8."]);
  let ok = true;
  if (isVariantExcluded(flags, "turbo", "model") !== true) { console.log("  ❌ turbo가 model에서 제외 안 됨"); fail++; ok = false; }
  if (isVariantExcluded(flags, "turbo", "lora") !== false) { console.log("  ❌ 함정: turbo lora가 exclude됨"); fail++; ok = false; }
  if (ok) console.log("  ✅ turbo는 model만 제외, turbo lora 유지");
}

// ── 케이스 4: PixelArtistry(카탈로그 밖) → 무회귀 ──
console.log("\n" + "=".repeat(70) + "\n[4] PixelArtistry (카탈로그 밖 무회귀)");
{
  const plan = buildModelPlan(loadReport(PIXEL), { gpu: "RTX 3090" });
  let ok = true;
  if (plan.family !== null) { console.log(`  ❌ 카탈로그 밖인데 family ${plan.family}(날조)`); fail++; ok = false; }
  if (plan.items.some((i) => i.confidence === "confirmed")) { console.log("  ❌ 카탈로그 밖인데 confirmed 발생"); fail++; ok = false; }
  if (ok) console.log("  ✅ family null · confirmed 0 · 기존 폴백(무회귀)");
}

// ── 케이스 5: LTX → quantBad 무회귀 + plan 무크래시 ──
console.log("\n" + "=".repeat(70) + "\n[5] LTX (quantBad 무회귀 + plan 무크래시)");
{
  const recipes = buildRecipes(JSON.parse(fs.readFileSync(path.join(FIX, LTX), "utf8")), { gpu: "ampere" });
  const quantBad = recipes.flatMap((r) => r.slots).filter((s) => s.quantBad).length;
  let ok = true;
  if (quantBad !== 2) { console.log(`  ❌ LTX quantBad 기대 2, 실제 ${quantBad}`); fail++; ok = false; }
  try { const plan = buildModelPlan(loadReport(LTX), { gpu: "RTX 3090" }); console.log(`  · plan family=${plan.family} items=${plan.items.length} unknowns=${plan.unknowns.length}(크래시 없음)`); }
  catch (e) { console.log(`  ❌ LTX plan 크래시: ${e.message}`); fail++; ok = false; }
  if (ok) console.log("  ✅ LTX quantBad 2 무회귀 + plan 무크래시");
}

// ── 케이스 6: Note 링크·강도 (직링크 승격 + Turbo Lora 강도) ──
console.log("\n" + "=".repeat(70) + "\n[6] Note 링크·강도 (제작자 안내)");
{
  const { plan } = planRows(KREA2, { gpu: "RTX 3090", basePath: "N:\\ComfyUI_models" });
  let ok = true;
  // 3모델은 confirmed(files DB)라 직링크가 검증 repo로. VAE는 spacepxl.
  const vae = plan.items.find((i) => i.role === "vae");
  if (!/spacepxl\/Wan2\.1-VAE-upscale2x/.test(vae?.downloadUrl || "")) { console.log(`  ❌ VAE 직링크(spacepxl) 이상: ${vae?.downloadUrl}`); fail++; ok = false; }
  // Turbo Lora 강도 안내 = authorLinks(슬롯 아님)에서
  const turbo = plan.authorLinks.find((a) => /turbo\s*lora/i.test(a.label) && a.strength);
  if (!turbo || turbo.strength !== "0.6") { console.log(`  ❌ Turbo Lora 강도 0.6 없음: ${JSON.stringify(turbo)}`); fail++; ok = false; }
  if (plan.authorLinks.length < 3) { console.log(`  ❌ 제작자 안내 링크 일괄 누락(${plan.authorLinks.length})`); fail++; ok = false; }
  if (ok) console.log(`  ✅ VAE 직링크 spacepxl · Turbo Lora 강도 0.6 · 제작자 안내 링크 ${plan.authorLinks.length}건 일괄`);
}

// ── 케이스 7: 버튼 앵커 스냅샷 + Note 없는 슬롯 오매칭 무회귀 ──
console.log("\n" + "=".repeat(70) + "\n[7] 버튼 앵커 스냅샷 + LTX 무회귀");
{
  let ok = true;
  const recLtx = recommend(loadReport(LTX), { gpu: "RTX 3090" });
  if (recLtx.noteLinkByBase.size !== 0) { console.log(`  ❌ LTX 슬롯 Note 링크 오매칭(${recLtx.noteLinkByBase.size})`); fail++; ok = false; }
  const src = fs.readFileSync(path.join(DIR, "..", "src", "Teardown.jsx"), "utf8");
  if (/openSearch/.test(src)) { console.log("  ❌ openSearch(window.open) 잔존"); fail++; ok = false; }
  const hfButtons = src.match(/HuggingFace 검색 ↗<\/a>/g) || [];
  const hfAnchors = src.match(/<a[^>]*href=\{searchUrl\([^)]*\)\}[^>]*>HuggingFace 검색 ↗<\/a>/g) || [];
  if (hfButtons.length !== hfAnchors.length) { console.log(`  ❌ HF 검색 ${hfButtons.length}개 중 앵커 ${hfAnchors.length}개(불일치)`); fail++; ok = false; }
  if (ok) console.log(`  ✅ LTX 슬롯 오매칭 0 · openSearch 제거 · HF 검색 ${hfAnchors.length}개 전부 <a href> 앵커`);
}

// ── 케이스 8: 브리핑(=plan) confirmed 3모델 + diffusion_models/Krea 2 + turbo 제외 + 대체 raw_fp8_scaled만 ──
console.log("\n" + "=".repeat(70) + "\n[8] 브리핑(plan) confirmed 3 + turbo 제외 + 대체 raw_fp8_scaled만");
{
  const { plan } = planRows(KREA2, { gpu: "RTX 3090", basePath: "N:\\ComfyUI_models" });
  let ok = true;
  const confirmed3 = plan.items.filter((i) => ["main_model", "text_encoder", "vae"].includes(i.role) && i.confidence === "confirmed");
  if (confirmed3.length < 3) { console.log(`  ❌ confirmed 3모델 미달(${confirmed3.length})`); fail++; ok = false; }
  // 3모델 행에 models/unet·확인 필요 없어야
  if (confirmed3.some((i) => /unet/.test(i.folder) || i.badge === "확인 필요")) { console.log("  ❌ 3모델 행에 models/unet·확인 필요 잔존"); fail++; ok = false; }
  const main = plan.items.find((i) => i.role === "main_model");
  if (!/diffusion_models[\\/]Krea 2/.test(main.folder)) { console.log(`  ❌ 메인 폴더에 diffusion_models/Krea 2 없음: ${main.folder}`); fail++; ok = false; }
  // 대체 후보 = raw_fp8_scaled만(int8_convrot 제거)
  const altNames = plan.alternatives.map((a) => a.filename);
  if (!(altNames.length === 1 && altNames[0] === "krea2_raw_fp8_scaled.safetensors")) { console.log(`  ❌ 대체 후보 기대 [raw_fp8_scaled], 실제 ${JSON.stringify(altNames)}`); fail++; ok = false; }
  if (altNames.some((a) => /int8_convrot/.test(a))) { console.log("  ❌ int8_convrot 대체 후보 잔존(실파일 없음)"); fail++; ok = false; }
  // turbo 4종 제외
  const exNames = plan.exclusions.map((e) => e.filename);
  if (!(exNames.length === 4 && exNames.every((e) => /turbo/.test(e)))) { console.log(`  ❌ turbo 제외 기대 4종, 실제 ${JSON.stringify(exNames)}`); fail++; ok = false; }
  if (ok) console.log(`  ✅ confirmed 3 · diffusion_models/Krea 2 · 대체 raw_fp8_scaled만 · turbo 4종 제외 · models/unet·확인 필요 없음`);
}

// ── 케이스 9: 화면 = 브리핑 (동일 plan 소스, 결정적) ──
console.log("\n" + "=".repeat(70) + "\n[9] 화면=브리핑 모델 값 동일성(단일 소스)");
{
  const env = { gpu: "RTX 3090", basePath: "N:\\ComfyUI_models" };
  const rep = loadReport(KREA2);
  const p1 = buildModelPlan(rep, env), p2 = buildModelPlan(rep, env);
  let ok = true;
  // 결정적: 두 번 호출이 동일(양쪽 출력이 같은 소스를 받는다는 불변)
  const sig = (p) => p.items.map((i) => `${i.selectedFile}|${i.fullPath || i.folder}|${i.confidence}|${i.downloadUrl}`).join("\n");
  if (sig(p1) !== sig(p2)) { console.log("  ❌ buildModelPlan 비결정적 — 화면/브리핑 드리프트 가능"); fail++; ok = false; }
  // 화면(fullPath||folder)과 브리핑(fullPath||folder)은 동일 필드 → 어떤 항목도 models/unet 아님
  if (p1.items.some((i) => /models[\\/]unet/.test(i.fullPath || i.folder || ""))) { console.log("  ❌ plan 항목에 models/unet 잔존(드리프트)"); fail++; ok = false; }
  // 구조 보장: 액션 테이블·buildBriefing·buildMarkdown이 실제로 buildModelPlan 참조(단일 소스)
  const src = fs.readFileSync(path.join(DIR, "..", "src", "Teardown.jsx"), "utf8");
  const usages = (src.match(/buildModelPlan\(/g) || []).length;
  if (usages < 3) { console.log(`  ❌ buildModelPlan 참조 ${usages}곳(액션·브리핑·MD 3곳 이상 기대) — 단일 소스 미통일`); fail++; ok = false; }
  if (ok) console.log(`  ✅ buildModelPlan 결정적 · 참조 ${usages}곳(액션·브리핑·MD·인벤토리) · models/unet 없음`);
}

// ── 케이스 10: krea2 + RTX 3060 8GB → 대용량 경고 + raw 대체(turbo 제외 유지) ──
console.log("\n" + "=".repeat(70) + "\n[10] krea2 + RTX 3060 8GB (대용량 경고 · raw 대체)");
{
  const plan = buildModelPlan(loadReport(KREA2), { gpu: "RTX 3060 8GB", basePath: "N:\\ComfyUI_models" });
  const main = plan.items.find((i) => i.role === "main_model");
  let ok = true;
  // (갱신) 경고 or → 승격 and: 받기 행 본체가 대체로 승격돼야(main.promoted)
  if (!main.promoted) { console.log("  ❌ 저VRAM인데 대체 승격 미발생(경고만으로 부족)"); fail++; ok = false; }
  else {
    if (main.promoted.filename !== "krea2_raw_fp8_scaled.safetensors") { console.log(`  ❌ 승격 대체 기대 raw_fp8_scaled, 실제 ${main.promoted.filename}`); fail++; ok = false; }
    if (main.promoted.originalFile !== "krea2_raw_bf16.safetensors") { console.log(`  ❌ 원 지정값 표기 기대 bf16, 실제 ${main.promoted.originalFile}`); fail++; ok = false; }
    if (/turbo/.test(main.promoted.filename)) { console.log("  ❌ Note RAW 강제인데 turbo로 승격"); fail++; ok = false; }
  }
  // 4: 승격 시 확정 대체가 경고를 대신 → vramWarning은 null, GPU 정보는 promoted.reason에 확정형으로.
  if (main.vramWarning) { console.log(`  ❌ 승격 시 vramWarning 중복(null이어야): ${main.vramWarning}`); fail++; ok = false; }
  if (!/8GB/.test(main.promoted?.reason || "")) { console.log(`  ❌ 확정 대체 사유에 GPU 미표기: ${main.promoted?.reason}`); fail++; ok = false; }
  // turbo 제외 유지
  if (!plan.exclusions.every((e) => /turbo/.test(e.filename))) { console.log("  ❌ turbo 제외 목록 이상"); fail++; ok = false; }
  if (ok) { console.log(`  ✅ 승격: 받기 본체 → ${main.promoted.filename}(13.1GB) [확정] · 원 지정값 bf16은 하위 표기`); console.log(`  ✅ 확정 대체 사유: ${main.promoted.reason}`); console.log("  ✅ turbo 제외 유지(Note RAW 강제 정합)"); }
}

// ── 케이스 11: krea2 + RTX 3090 무회귀(케이스 1과 diff 0: vramWarning 없음, 동일 items) ──
console.log("\n" + "=".repeat(70) + "\n[11] krea2 + RTX 3090 무회귀(케이스 1 diff 0)");
{
  const p = buildModelPlan(loadReport(KREA2), { gpu: "RTX 3090", basePath: "N:\\ComfyUI_models" });
  let ok = true;
  if (p.items.some((i) => i.vramWarning)) { console.log("  ❌ 3090에 vramWarning 발생(26.3<36이라 무경고여야 — 실측: 3090 실행됨)"); fail++; ok = false; }
  const main = p.items.find((i) => i.role === "main_model");
  if (main.promoted) { console.log("  ❌ 3090에 대체 승격 발생(무회귀 위반 — bf16 그대로여야)"); fail++; ok = false; }
  if (main.confidence !== "confirmed" || main.selectedFile !== "krea2_raw_bf16.safetensors" || main.size !== "26.3GB") { console.log("  ❌ 케이스 1과 메인 모델 불일치(무회귀 위반)"); fail++; ok = false; }
  if (p.alternatives.length !== 1 || p.alternatives[0].filename !== "krea2_raw_fp8_scaled.safetensors") { console.log("  ❌ 케이스 1과 대체 후보 불일치"); fail++; ok = false; }
  if (ok) console.log("  ✅ 3090 vramWarning 0 · 메인 bf16 confirmed 26.3GB · 대체 raw_fp8_scaled(케이스 1 diff 0)");
}

// ── 케이스 12(후속): Silent Snow Full + 3090 — ltx23 confirmed 없이 폴백 정합 ──
console.log("\n" + "=".repeat(70) + "\n[12] Silent Snow Full + 3090 (ltx23 폴백 정합)");
{
  const FULL = findFix("Silent Snow LTX2.3 Full");
  const plan = buildModelPlan(loadReport(FULL), { gpu: "RTX 3090" });
  let ok = true;
  if (plan.family !== "ltx23") { console.log(`  ❌ family 기대 ltx23, 실제 ${plan.family}`); fail++; ok = false; }
  if (plan.items.some((i) => i.confidence === "confirmed")) { console.log("  ❌ ltx23는 files DB 미등재라 confirmed 없어야(폴백 유지)"); fail++; ok = false; }
  if (plan.items.some((i) => /models[\\/]unet/.test(i.folder || ""))) { console.log("  ❌ modelPlan 경유인데 models/unet 잔존"); fail++; ok = false; }
  const badges = [...new Set(plan.items.map((i) => i.badge))];
  if (ok) console.log(`  ✅ family ltx23 · confirmed 0(폴백) · 받기 ${plan.items.length}행 뱃지 ${JSON.stringify(badges)} · models/unet 없음`);
}

// ── 케이스 13(후속): Video To Audio + 3060 8GB — quantBad(recipe) + gpu_rules 저VRAM 공존 ──
console.log("\n" + "=".repeat(70) + "\n[13] Video To Audio + 3060 8GB (quantBad·저VRAM 공존)");
{
  const V2A = findFix("Ltx2.3 Video To Audio Deno");
  const j = JSON.parse(fs.readFileSync(path.join(FIX, V2A), "utf8"));
  const quantBad = buildRecipes(j, { gpu: "ampere" }).flatMap((r) => r.slots).filter((s) => s.quantBad).length;
  const plan = buildModelPlan(analyze(normalize(j), mgrMap), { gpu: "RTX 3060 8GB" });
  let ok = true;
  if (quantBad !== 3) { console.log(`  ❌ quantBad(recipe) 기대 3, 실제 ${quantBad}`); fail++; ok = false; }
  // 두 판정 레이어가 크래시·충돌 없이 공존(quantBad=recipe층, vramWarning=plan층). 크기 미상이라 vramWarning은 없음이 정상.
  const vw = plan.items.filter((i) => i.vramWarning).length;
  if (ok) { console.log(`  ✅ quantBad(recipe층)=${quantBad} · plan items=${plan.items.length}(confidence ${[...new Set(plan.items.map((i) => i.confidence))].join(",")}) · vramWarning(plan층)=${vw}(크기 미상이라 무발화, 정상)`); console.log("  ✅ 두 판정 레이어 크래시·충돌 없이 공존"); }
}

// ── 케이스 14: 8(대체 후보 방향) — 작은 메인이 GPU 적합이면 더 큰 raw는 "상위 품질(VRAM 여유 시)", 동급 미노출, OOM 오방향 0 ──
console.log("\n" + "=".repeat(70) + "\n[14] 대체 후보 방향(24GB): 더 큰 raw=상위 품질 · 동급 미노출 · OOM 오방향 0");
{
  const plan = buildModelPlan({ models: [{ file: "krea2_turbo_fp8_scaled.safetensors", node: "UNETLoader" }] }, { gpu: "RTX 3090", vram: 24 });
  let ok = true;
  const main = plan.items.find((i) => i.role === "main_model");
  const gSize = (s) => { const m = String(s || "").match(/([\d.]+)\s*GB/i); return m ? +m[1] : null; };
  const bf16 = plan.alternatives.find((a) => a.filename === "krea2_raw_bf16.safetensors");
  if (!bf16 || !/상위 품질/.test(bf16.reason)) { console.log(`  ❌ 더 큰 raw_bf16 상위 품질 카피 아님: ${bf16?.reason || "(없음)"}`); fail++; ok = false; }
  if (plan.alternatives.some((a) => a.filename === "krea2_raw_fp8_scaled.safetensors")) { console.log("  ❌ 동급 크기 대체(raw_fp8_scaled) 미노출 위반"); fail++; ok = false; }
  const mg = gSize(main?.size);
  const wrongOOM = plan.alternatives.filter((a) => /OOM/.test(a.reason) && gSize(a.size) != null && mg != null && gSize(a.size) >= mg);
  if (wrongOOM.length) { console.log(`  ❌ OOM 오방향(메인보다 큰데 OOM 대체): ${wrongOOM.map((a) => a.filename)}`); fail++; ok = false; }
  if (ok) console.log(`  ✅ 메인 ${main?.size} · raw_bf16 상위 품질 · 동급 미노출 · OOM 오방향 0`);
}

// ── 케이스 15: 렌더 스모크(모듈 로드 TDZ 정적 스캔 + 메인 컴포넌트 렌더 예외 0). 별도 프로세스(react/esbuild 로드 격리). ──
console.log("\n" + "=".repeat(70) + "\n[15] 렌더 스모크 (모듈 로드 TDZ + 컴포넌트 렌더 예외 0)");
{
  const r = spawnSync("node", [path.join(DIR, "smoke.mjs")], { encoding: "utf8" });
  process.stdout.write(r.stdout || "");
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) { console.log("  ❌ 렌더 스모크 실패(위 로그 참조)"); fail++; }
}

console.log("\n" + "=".repeat(70));
console.log(`fixtures: krea2=${!!KREA2} pixel=${!!PIXEL} ltx=${!!LTX}`);
console.log(fail === 0 ? "✅ e2e 15케이스 전부 통과" : `❌ e2e ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
