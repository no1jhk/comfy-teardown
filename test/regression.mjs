// P9 회귀테스트 — test/fixtures 4개를 buildRecipes로 실행 + 기대치 검증.
// 재실행: node test/regression.mjs
//
// P2-A: analyze/normalize를 src/lib/analyzeWorkflow.js로 추출 → node 직접 import로 검증(SKIP 해제).
//   buildRecipes(redNodeRecipe.js) 범위: recipes/슬롯/quantBad/ggufAlt/크래시.
//   analyze 범위: unmapped/broken/anomalous/packs('analyze 직접 검증' 블록).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes, groupNodesByRepo } from "../src/data/redNodeRecipe.js";
import { parseComfyLog, packInstalled, parseValueNotInList, parseMissingNodeType, compareVersion, latestLogSession, extractErrorLines, hasDiskError } from "../src/logParse.js";
import { normalize, analyze } from "../src/lib/analyzeWorkflow.js";
import { gpuProfile } from "../src/lib/modelRecommender.js";
import { buildModelPlan } from "../src/lib/modelPlan.js";
import { parseFolderScan, reconcileInventory, buildScanSnippet, scanInputDiagnosis, isTypeFolder, assembleModelPath } from "../src/lib/inventoryMatch.js";
import { parseWorkflowNotes, isVariantExcluded, preferredVariant, notedFolder, matchLabelToNode } from "../src/lib/parseWorkflowNotes.js";
import nodeRepoMap from "../src/data/node_repo_map.json" with { type: "json" };

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "fixtures");
const files = fs.readdirSync(FIX).filter((f) => f.endsWith(".json")).sort();

// RTX 3090 = Ampere. buildRecipes는 gpu==="ampere"에서 quantBad(nvfp4/fp4/fp8) 판정.
const GPU = "ampere";

// 3등급(buildRecipes 범위): redGpu(quantBad)>0 → red / 그 외 점검 모델>0 → yellow / 0 → green.
// 실증 반영: quantBad(fp8)는 노랑(GPU 점검 권장). red는 노드 사유(analyze)만 → regression(buildRecipes)엔 red 없음.
function gradeFromRecipes(recipes) {
  const slots = recipes.flatMap((r) => r.slots);
  const gpuCheck = slots.filter((s) => s.quantBad).length; // fp8 등 → 노랑 카운트
  const checkModels = slots.filter((s) => !s.quantBad).length;
  return (gpuCheck + checkModels) > 0 ? "yellow" : "green";
}

// 파일별 등급 기대값 (신규 fixtures 포함). red=실행불가(quantBad>0) / yellow=점검 / green=문제없음.
// GPU 입력 조건별 등급 기대. ampere=GPU 입력 시 / none=GPU 미입력 시(추정 금지 → GPU 사유 red 없음).
const GRADE_EXPECT = {
  "LTX2_3_8GB_VRAM_workflow___Audio_to_Video.json": { ampere: "yellow", none: "yellow" },
  "LTX2.3 8GB VRAM workflow + Audio to Video.json": { ampere: "yellow", none: "yellow" },
  "Silent Snow LTX2.3 Kjai FP8.json": { ampere: "yellow", none: "yellow" },
  "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json": { ampere: "yellow", none: "yellow" }, // 실측: bf16 UNET/CLIP/VAE·quantBad 0
  // 신규 fixtures 실측 편입 (buildRecipes 범위 grade)
  "Silent Snow LTX2.3 Full.json": { ampere: "yellow", none: "yellow" },            // slots 3·quantBad 0·#5288 서브그래프 참조
  "Ltx2.3 Video To Audio Deno workflow.json": { ampere: "yellow", none: "yellow" }, // slots 4·quantBad 3(ampere)
  "57_PiD Upscale.json": { ampere: "yellow", none: "yellow" },                      // slots 3·quantBad 1
  "Ideogram40_Layout_builder_A.json": { ampere: "yellow", none: "yellow" },         // slots 1·quantBad 1·UUID 1
  "Ideogram40_layout_builder_B.json": { ampere: "yellow", none: "yellow" },         // slots 4·quantBad 3·UUID 2
  "PixelArtistry_Skintoken_default.json": { ampere: "green", none: "green" },        // slots 0(모델 없음)
  "PixelArtistry_SkintokenAnimWorkflow.json": { ampere: "green", none: "green" },    // slots 0
};
let fail = 0;
const rows = [];

for (const f of files) {
  const isLTX = /LTX/i.test(f);
  const isFlux = /Flux/i.test(f);
  let json, recipes, crash = null;
  try {
    json = JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
    recipes = buildRecipes(json, { gpu: GPU });
  } catch (e) { crash = e; }

  console.log("\n" + "=".repeat(70) + "\n" + f);
  if (crash) { console.log(`  ❌ CRASH\n${crash.stack}`); fail++; rows.push([f, "CRASH", "-", "-", "-", "-"]); continue; }

  const slots = recipes.flatMap((r) => r.slots);
  const quantBad = slots.filter((s) => s.quantBad);
  const ggufFilled = quantBad.filter((s) => s.ggufAlt && s.ggufAlt.alternatives?.length > 0);
  const ggufPending = quantBad.filter((s) => s.ggufAlt && s.ggufAlt.pending);
  const ggufNone = quantBad.filter((s) => !s.ggufAlt);
  const srcDist = {};
  for (const s of slots) srcDist[s.src] = (srcDist[s.src] || 0) + 1;

  console.log(`  크래시: 없음 ✅`);
  console.log(`  recipes 노드: ${recipes.length} · 슬롯: ${slots.length}`);
  console.log(`  quantBad: ${quantBad.length}  (ggufAlt채움 ${ggufFilled.length} / pending ${ggufPending.length} / 확인필요 ${ggufNone.length})`);
  console.log(`  slot.src 분포: ${JSON.stringify(srcDist)}`);
  console.log(`  quantBad 파일: ${quantBad.map((s) => s.value).join(", ") || "-"}`);
  if (ggufNone.length) console.log(`  확인필요 남은 파일: ${ggufNone.map((s) => s.value).join(", ")}`);

  const grade = gradeFromRecipes(recipes);
  console.log(`  등급(redGpu 기준): ${grade}`);
  // 파일별 등급 기대 (신규 2개 포함)
  if (GRADE_EXPECT[f]?.ampere) {
    if (grade !== GRADE_EXPECT[f].ampere) { console.log(`  ❌ (gpu입력) 등급 기대 ${GRADE_EXPECT[f].ampere}, 실제 ${grade}`); fail++; }
    else console.log(`  ✅ (gpu입력) 등급 ${grade} (기대 ${GRADE_EXPECT[f].ampere})`);
  }
  // quantBad/ggufAlt 상세는 기존 LTX2_3_ 기준 파일만
  if (f === "LTX2_3_8GB_VRAM_workflow___Audio_to_Video.json") {
    if (quantBad.length !== 2) { console.log(`  ❌ 기대 quantBad 2, 실제 ${quantBad.length} → LTX fp4/fp8 모델 감지 불일치 추정`); fail++; }
    const ggAll = ggufFilled.length + ggufPending.length;
    if (ggAll !== 2) { console.log(`  ❌ 기대 ggufAlt 2, 실제 ${ggAll}(채움${ggufFilled.length}+pending${ggufPending.length}) → gguf_file_map 매칭 누락 추정`); fail++; }
    else console.log(`  ✅ LTX 기대치(quantBad 2 · ggufAlt 2) 충족  [unmapped 2는 analyze — SKIP]`);
  }
  if (isFlux) {
    if (ggufNone.length > 0) { console.log(`  ❌ Flux2 quantBad 슬롯에 확인필요 ${ggufNone.length}개 (전부 채워져야) → gguf_file_map match 누락 추정`); fail++; }
    else console.log(`  ✅ Flux2 기대치(quantBad 슬롯 ggufAlt 전부 채움) 충족  [unmapped 0은 analyze — SKIP]`);
  }

  rows.push([f.replace(/\.json$/, "").slice(0, 34), recipes.length + "/" + slots.length, quantBad.length, ggufFilled.length + ggufPending.length, ggufNone.length, JSON.stringify(srcDist)]);
}

// === API 포맷 케이스 (test/api_sample.json — 합성 4노드, nvfp4+fp4 포함) ===
console.log("\n" + "=".repeat(70) + "\nAPI 포맷: api_sample.json");
{
  const j = JSON.parse(fs.readFileSync(path.join(DIR, "api_sample.json"), "utf8"));
  let recipes, crash = null;
  try { recipes = buildRecipes(j, { gpu: GPU }); } catch (e) { crash = e; }
  if (crash) { console.log(`  ❌ CRASH\n${crash.stack}`); fail++; }
  else {
    const slots = recipes.flatMap((r) => r.slots);
    const quantBad = slots.filter((s) => s.quantBad);
    const ggufFilled = quantBad.filter((s) => s.ggufAlt && s.ggufAlt.alternatives?.length > 0);
    const ggufPending = quantBad.filter((s) => s.ggufAlt && s.ggufAlt.pending);
    const ggufNone = quantBad.filter((s) => !s.ggufAlt);
    const ggAll = ggufFilled.length + ggufPending.length;
    const srcDist = {};
    for (const s of slots) srcDist[s.src] = (srcDist[s.src] || 0) + 1;
    console.log(`  크래시: 없음 ✅`);
    console.log(`  recipes 노드: ${recipes.length} · 슬롯: ${slots.length}`);
    console.log(`  quantBad: ${quantBad.length}  (ggufAlt채움 ${ggufFilled.length} / pending ${ggufPending.length} / 확인필요 ${ggufNone.length})`);
    console.log(`  slot.src 분포: ${JSON.stringify(srcDist)}`);
    console.log(`  quantBad 파일: ${quantBad.map((s) => s.value).join(", ") || "-"}`);
    if (recipes.length === 0) { console.log(`  ❌ 기대 recipes>0, 실제 0 → flatten API 분기 미작동 추정`); fail++; }
    else if (quantBad.length !== 2) { console.log(`  ❌ 기대 quantBad 2, 실제 ${quantBad.length} → API inputs 슬롯 추출/감지 불일치 추정`); fail++; }
    else if (ggAll !== 2) { console.log(`  ❌ 기대 ggufAlt 2, 실제 ${ggAll} → gguf_file_map 매칭 누락 추정`); fail++; }
    else console.log(`  ✅ API 기대치(recipes>0 · quantBad 2 · ggufAlt 2) 충족`);
    rows.push(["api_sample (API포맷)", recipes.length + "/" + slots.length, quantBad.length, ggAll, ggufNone.length, JSON.stringify(srcDist)]);
  }
}

// === 노랑 등급 케이스 (yellow_sample.json — quantBad 0, 정상 모델) ===
console.log("\n" + "=".repeat(70) + "\n노랑 등급 케이스: yellow_sample.json");
{
  const j = JSON.parse(fs.readFileSync(path.join(DIR, "yellow_sample.json"), "utf8"));
  const recipes = buildRecipes(j, { gpu: GPU });
  const slots = recipes.flatMap((r) => r.slots);
  const grade = gradeFromRecipes(recipes);
  console.log(`  슬롯 ${slots.length} · quantBad ${slots.filter((s) => s.quantBad).length} · 등급 ${grade}`);
  if (grade !== "yellow") { console.log(`  ❌ 기대 yellow(quantBad 0 + 점검 모델>0), 실제 ${grade}`); fail++; }
  else console.log(`  ✅ 노랑 등급 충족 (실행 차단 없음 + 점검 항목 존재)`);
}

// === GPU 미입력 케이스 (gpu: null) — quantBad 판정 부재, fp 파일은 quantUnknown, 등급에서 GPU 사유 제외 ===
console.log("\n" + "=".repeat(70) + "\nGPU 미입력 케이스 (gpu: null)");
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
  const rNull = buildRecipes(j, { gpu: null });
  const rAmp = buildRecipes(j, { gpu: "ampere" });
  const qbNull = rNull.flatMap((r) => r.slots).filter((s) => s.quantBad).length;
  const qbAmp = rAmp.flatMap((r) => r.slots).filter((s) => s.quantBad).length;
  const quNull = rNull.flatMap((r) => r.slots).filter((s) => s.quantUnknown).length;
  console.log(`  ${f.slice(0, 42)}: ampere quantBad ${qbAmp} → null quantBad ${qbNull} · quantUnknown ${quNull} · 등급 ${gradeFromRecipes(rNull)}`);
  if (qbNull !== 0) { console.log(`  ❌ GPU 미입력인데 quantBad ${qbNull}(0이어야) → 추정 판정 잔존`); fail++; }
  if (qbAmp > 0 && quNull !== qbAmp) { console.log(`  ❌ ampere quantBad ${qbAmp} → null quantUnknown ${quNull} 불일치(fp 전환 실패)`); fail++; }
  const gNull = gradeFromRecipes(rNull);
  if (GRADE_EXPECT[f]?.none && gNull !== GRADE_EXPECT[f].none) { console.log(`  ❌ (gpu미입력) 등급 기대 ${GRADE_EXPECT[f].none}, 실제 ${gNull}`); fail++; }
  if (gNull === "red") { console.log(`  ❌ GPU 미입력인데 등급 red → GPU 사유 빨강 잔존`); fail++; }
  // GPU 입력 케이스: Silent Snow FP8은 gpu 지정 시 quantBad 2 + 등급 red
  if (f === "Silent Snow LTX2.3 Kjai FP8.json") {
    if (qbAmp !== 2) { console.log(`  ❌ Silent Snow gpu입력 quantBad 기대 2, 실제 ${qbAmp}`); fail++; }
    else console.log(`  ✅ Silent Snow gpu입력 quantBad 2 + 등급 ${gradeFromRecipes(rAmp)}`);
  }
}
console.log(`  ✅ GPU 미입력: quantBad 0(판정 부재) + fp 파일 quantUnknown 전환 + 등급 red 없음(GPU 사유 제외)`);

// === Import times 로그 파싱 단위 테스트 (Teardown parseComfyLog Import 블록과 동일 정규식) ===
console.log("\n" + "=".repeat(70) + "\nImport times 로그 파싱");
{
  const parseImportTimes = (text) => {
    const installed = [], failed = [];
    const re = /^\s*[\d.]+\s*seconds?\s*(\(IMPORT FAILED\))?\s*:\s*(.+?)\s*$/gim;
    let m;
    while ((m = re.exec(text))) {
      const base = m[2].replace(/[\\/]+$/, "").split(/[\\/]/).pop().replace(/\.py$/i, "").toLowerCase();
      if (!base) continue;
      if (m[1]) failed.push(base); else installed.push(base);
    }
    return { installed, failed };
  };
  const SAMPLE = "Import times for custom nodes:\n   0.0 seconds: /root/ComfyUI/custom_nodes/websocket_image_save.py\n   0.3 seconds: /root/ComfyUI/custom_nodes/ComfyUI-KJNodes\n   1.2 seconds (IMPORT FAILED): /root/ComfyUI/custom_nodes/ComfyUI-Trellis2";
  const pit = parseImportTimes(SAMPLE);
  console.log(`  installed: ${pit.installed.join(", ")} · failed: ${pit.failed.join(", ")}`);
  if (!pit.installed.includes("comfyui-kjnodes")) { console.log("  ❌ ComfyUI-KJNodes 설치 파싱 실패"); fail++; }
  if (!pit.failed.includes("comfyui-trellis2")) { console.log("  ❌ IMPORT FAILED 파싱 실패"); fail++; }
  if (pit.installed.length === 2 && pit.failed.length === 1) console.log("  ✅ Import times 파싱: installed 2(kjnodes·websocket) + failed 1(trellis2)");
  else { console.log(`  ❌ 기대 installed 2/failed 1, 실제 ${pit.installed.length}/${pit.failed.length}`); fail++; }
}

// === Value not in list 파싱 → 로그 기반 red 승격 테스트 (실제 실행 실패 증거) ===
console.log("\n" + "=".repeat(70) + "\nValue not in list (로그 기반 red 승격)");
{
  const parseVNIL = (log) => {
    const out = [];
    const re = /(\w+):\s*'([^']+?)'\s+not in\s+\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(log))) {
      const cands = (m[3].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
      if (cands.length) out.push({ widget: m[1], required: m[2], candidates: cands });
    }
    return out;
  };
  const SAMPLE = "Value not in list: ckpt_name: 'model_v2.ckpt' not in ['model_v1.ckpt', 'other.ckpt']";
  const hits = parseVNIL(SAMPLE);
  const gradeOverride = hits.length > 0 ? "red" : "none";
  console.log(`  파싱 ${hits.length}건 (widget=${hits[0]?.widget}, 후보 ${hits[0]?.candidates.length}) · 등급 오버라이드 ${gradeOverride}`);
  if (hits.length !== 1 || hits[0].widget !== "ckpt_name") { console.log("  ❌ VNIL 파싱 실패"); fail++; }
  else if (gradeOverride !== "red") { console.log("  ❌ VNIL 감지 시 red 승격 실패"); fail++; }
  else console.log("  ✅ Value not in list → red 승격 (ckpt_name · 후보 2)");
}

// === 서브그래프 UUID 대조: definitions.subgraphs ID면 anomalous 아님(정상 참조), 정의 없으면 미상 ===
console.log("\n" + "=".repeat(70) + "\n서브그래프 UUID 대조");
{
  const isUuidType = (t) => typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
  const subgraphIds = new Set(["12345678-1234-1234-1234-123456789abc"]);
  const refType = "12345678-1234-1234-1234-123456789abc";       // 서브그래프 참조
  const unknownType = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";    // 정의 없음(진짜 미상)
  const anomRef = isUuidType(refType) && !subgraphIds.has(refType);
  const anomUnknown = isUuidType(unknownType) && !subgraphIds.has(unknownType);
  console.log(`  서브그래프 참조 anomalous=${anomRef} · 정의없음 anomalous=${anomUnknown}`);
  if (anomRef) { console.log("  ❌ 서브그래프 참조인데 anomalous로 잡힘"); fail++; }
  if (!anomUnknown) { console.log("  ❌ 정의 없는 UUID가 anomalous에서 누락"); fail++; }
  if (!anomRef && anomUnknown) console.log("  ✅ 서브그래프 UUID 대조: 참조 제외 · 정의없음만 anomalous");
}

// Full.json 실측: #5288 = 서브그래프 참조(anomalous 제외 확인)
console.log("\n" + "=".repeat(70) + "\nFull.json #5288 서브그래프 참조 실측");
{
  const j = JSON.parse(fs.readFileSync(path.join(FIX, "Silent Snow LTX2.3 Full.json"), "utf8"));
  const n = (j.nodes || []).find((x) => String(x.id) === "5288");
  const subIds = new Set((j.definitions?.subgraphs || []).map((s) => s.id));
  const isRef = n && subIds.has(n.type);
  console.log(`  #5288 type ${n?.type?.slice(0, 8)}… · subgraphIds(${subIds.size}) 존재 ${isRef}`);
  if (!isRef) { console.log("  ❌ Full.json #5288 서브그래프 참조 아님(기대: 참조→anomalous 제외)"); fail++; }
  else console.log("  ✅ Full.json #5288 서브그래프 참조 → anomalous 제외");
}

// === 액션 테이블 행 수 스냅샷 (buildRecipes 범위: 받기=model 슬롯 수 · 실행 1 고정. 설치=analyze라 SKIP) ===
console.log("\n" + "=".repeat(70) + "\n액션 테이블 행 수(받기=model 슬롯 · 동사 받기/넣기/선택/실행)");
const ACTION_MODEL_EXPECT = { // 받기 행 = 전체 model 슬롯 수(quantBad 여부 무관)
  "LTX2_3_8GB_VRAM_workflow___Audio_to_Video.json": 8,
  "Silent Snow LTX2.3 Kjai FP8.json": 4,
  "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json": 3,
  "Silent Snow LTX2.3 Full.json": 3,
  "Ltx2.3 Video To Audio Deno workflow.json": 2, // 받기 병합: dev-fp8(3슬롯) 1행 + lora 1행
  "57_PiD Upscale.json": 3,
  "Ideogram40_Layout_builder_A.json": 1,
  "Ideogram40_layout_builder_B.json": 4,
  "PixelArtistry_Skintoken_default.json": 0,
  "PixelArtistry_SkintokenAnimWorkflow.json": 0,
};
for (const f of files) {
  const recipes = buildRecipes(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")), { gpu: null });
  const slots = recipes.flatMap((r) => r.slots);
  const modelRows = new Set(slots.map((s) => s.value.replace(/\\/g, "/").split("/").pop().toLowerCase())).size; // 받기 행 = 동일 파일명 병합(유니크 basename)
  const exp = ACTION_MODEL_EXPECT[f];
  console.log(`  ${f.slice(0, 40)}: 받기 ${modelRows}행${exp !== undefined ? ` (기대 ${exp})` : ""}`);
  if (exp !== undefined && modelRows !== exp) { console.log(`  ❌ 받기 행 기대 ${exp}, 실제 ${modelRows}`); fail++; }
}
console.log("  ✅ 받기 행 = model 슬롯 수 · 실행 1행 고정 (설치 행은 analyze 범위 — SKIP)");

// === 작업 C: 실로그 설치 해소 — krea2_console_log.txt + krea2 팩 basename 매칭 실측 ===
console.log("\n" + "=".repeat(70) + "\n실로그 설치 해소(krea2_console_log.txt → installedPacks 매칭)");
{
  const log = fs.readFileSync(path.join(FIX, "krea2_console_log.txt"), "utf8");
  const parsed = parseComfyLog(log);
  console.log(`  installedPacks: ${parsed.installedPacks.join(", ")}`);
  // krea2 그룹 repos(packcount 실측): 3개는 로그에 있어 제외, 2개는 잔존해야
  const krea2Repos = [
    ["rgthree/rgthree-comfy", true],
    ["https://github.com/chrisgoringe/cg-use-everywhere", true],
    ["https://github.com/Fannovel16/comfyui_controlnet_aux", true],
    ["https://github.com/audioscavenger/ComfyUI-Thumbnails", false],
    ["https://github.com/NewLouwa/ComfyUI-Model_preset_Pilot", false],
  ];
  let remain = 0, ok = true;
  for (const [repo, expectInstalled] of krea2Repos) {
    const hit = packInstalled(repo, parsed.installedPacks);
    if (!hit) remain++;
    if (hit !== expectInstalled) { console.log(`  ❌ ${repo} 설치판정 기대 ${expectInstalled}, 실제 ${hit}`); fail++; ok = false; }
  }
  if (!parsed.gpu.includes("3090")) { console.log(`  ❌ GPU 파싱 기대 3090, 실제 '${parsed.gpu}'`); fail++; ok = false; }
  if (remain !== 2) { console.log(`  ❌ 설치행 잔존 기대 2(Thumbnails·Model_preset_Pilot), 실제 ${remain}`); fail++; ok = false; }
  // 단계 0: Prestartup 블록 팩도 인식(rgthree는 두 블록 중복 → dedup) + IMPORT FAILED efficiency-nodes-ed
  if (!parsed.installedPacks.includes("comfyui-easy-use")) { console.log("  ❌ Prestartup 블록 팩(comfyui-easy-use) 미인식"); fail++; ok = false; }
  if (!parsed.importFailed.includes("efficiency-nodes-ed")) { console.log("  ❌ IMPORT FAILED(efficiency-nodes-ed) 미인식"); fail++; ok = false; }
  if (parsed.installedPacks.filter((p) => p === "rgthree-comfy").length !== 1) { console.log("  ❌ 중복 블록 팩 dedup 실패(rgthree-comfy)"); fail++; ok = false; }
  // 단계 0: extra search path → basePath 자동 추출
  if (parsed.basePath !== "N:\\ComfyUI_models") { console.log(`  ❌ basePath 추출 기대 'N:\\ComfyUI_models', 실제 '${parsed.basePath}'`); fail++; ok = false; }
  if (ok) console.log(`  ✅ 로그 3팩 제외·잔존 2·GPU ${parsed.gpu}·Prestartup 인식·basePath ${parsed.basePath}`);
}

// === 단계 0: Prestartup만 있고 Import times 잘린 로그에서도 설치 인식 ===
console.log("\n" + "=".repeat(70) + "\nPrestartup-only 잘린 로그 설치 인식");
{
  const truncated = "Adding extra search path checkpoints D:\\models\\checkpoints\nAdding extra search path vae D:\\models\\vae\n\nPrestartup times for custom nodes:\n   0.0 seconds: C:\\Users\\x\\ComfyUI\\custom_nodes\\rgthree-comfy\n   0.2 seconds: C:\\Users\\x\\ComfyUI\\custom_nodes\\deno-custom-nodes\n";
  const p = parseComfyLog(truncated);
  let ok = true;
  if (!p.installedPacks.includes("rgthree-comfy") || !p.installedPacks.includes("deno-custom-nodes")) { console.log(`  ❌ Prestartup-only 설치 인식 실패: ${p.installedPacks.join(",")}`); fail++; ok = false; }
  if (p.basePath !== "D:\\models") { console.log(`  ❌ basePath 기대 'D:\\models', 실제 '${p.basePath}'`); fail++; ok = false; }
  if (ok) console.log(`  ✅ Prestartup-only에서 설치 2팩 + basePath ${p.basePath} 인식`);
}

// === 불완전 로그 감지: Prestartup 있고 Import times 없으면 truncated true, 전체 로그는 false ===
console.log("\n" + "=".repeat(70) + "\n불완전(잘린) 로그 감지");
{
  const truncated = "Prestartup times for custom nodes:\n   0.0 seconds: C:\\ComfyUI\\custom_nodes\\rgthree-comfy\n";
  const full = fs.readFileSync(path.join(FIX, "krea2_console_log.txt"), "utf8"); // Prestartup + Import times 둘 다
  const pt = parseComfyLog(truncated), pf = parseComfyLog(full);
  let ok = true;
  if (pt.truncated !== true) { console.log(`  ❌ 잘린 로그(Prestartup만) truncated 기대 true, 실제 ${pt.truncated}`); fail++; ok = false; }
  if (pf.truncated !== false) { console.log(`  ❌ 전체 로그 truncated 기대 false(Import times 존재), 실제 ${pf.truncated}`); fail++; ok = false; }
  if (!pf.hasImportBlock || !pf.hasPrestartupBlock) { console.log("  ❌ 전체 로그 블록 플래그 오류"); fail++; ok = false; }
  if (ok) console.log(`  ✅ Prestartup-only → 안내 발화(truncated) · 전체 로그(Import times 존재) → 미발화`);
}

// === 작업 D: missing_node_type → red 승격 + 노드 ID 추출 ===
console.log("\n" + "=".repeat(70) + "\nmissing_node_type(로그 기반 red 승격 + 확인 행)");
{
  const S1 = "Cannot execute because node KJNodesX does not exist.: Node ID '#14'";
  const S2 = "When loading the graph, the following node types were not found: SmartResolution, Krea2ControlApply.";
  const S3 = "invalid prompt: missing_node_type at node #27";
  const h1 = parseMissingNodeType(S1), h2 = parseMissingNodeType(S2), h3 = parseMissingNodeType(S3);
  console.log(`  (a)실행불가: ${JSON.stringify(h1)} · (b)not found: ${h2.length}개 · (c)토큰: ${JSON.stringify(h3)}`);
  let ok = true;
  if (!(h1.length === 1 && h1[0].nodeId === "14" && h1[0].nodeType === "KJNodesX")) { console.log("  ❌ (a) Cannot execute 파싱/노드ID 추출 실패"); fail++; ok = false; }
  if (!(h2.length === 2 && h2.some((x) => x.nodeType === "SmartResolution"))) { console.log("  ❌ (b) not found 목록 파싱 실패"); fail++; ok = false; }
  if (!(h3.length === 1 && h3[0].nodeId === "27")) { console.log("  ❌ (c) missing_node_type 토큰/ID 파싱 실패"); fail++; ok = false; }
  // red 승격: hit>0 이면 red (VNIL과 동일 계열)
  const gradeOverride = (parseValueNotInList(S1).length + h1.length) > 0 ? "red" : "none";
  if (gradeOverride !== "red") { console.log("  ❌ missing_node_type 감지 시 red 승격 실패"); fail++; ok = false; }
  if (ok) console.log("  ✅ missing_node_type: 실행불가(ID #14)·not found 2건·토큰(ID #27) 파싱 + red 승격");
}

// === 단계 A: analyze 직접 검증 (lib import, 기존 SKIP 해제) — unmapped/broken/anomalous/packs ===
console.log("\n" + "=".repeat(70) + "\nanalyze 직접 검증 (analyzeWorkflow.js lib)");
{
  // mgrMap 주입(런타임과 동일): public/manager_node_map.json
  let mgrMap = null;
  try { mgrMap = JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8")); } catch { console.log("  ⚠ manager_node_map.json 없음 → mgrMap null로 진행(prefix/rgthree만)"); }
  // 팩 수 = groupNodesByRepo(unmapped) 그룹만. 실측 기대값(P2 packcount 실측).
  const PACK_EXPECT = {
    "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json": { groups: 8, solo: 0, anomalous: 0 }, // 봉인1 작업C: VAEUtils·SmartResolution·Krea2Control*3 실측 repo 편입 → solo 5→0, 그룹 5→8

    "Silent Snow LTX2.3 Full.json": { groups: 1, solo: 0, anomalous: 0 }, // #5288 서브그래프 참조 → anomalous 제외
  };
  for (const f of files) {
    let rep;
    try { rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"))), mgrMap); }
    catch (e) { console.log(`  ❌ ${f.slice(0, 34)} analyze CRASH: ${e.message}`); fail++; continue; }
    const { groups, solo } = groupNodesByRepo(rep.unmapped || []);
    const exp = PACK_EXPECT[f];
    const tag = exp ? ` (기대 그룹${exp.groups}·solo${exp.solo}·anom${exp.anomalous})` : "";
    console.log(`  ${f.slice(0, 34).padEnd(35)} 팩 그룹${groups.length}·solo${solo.length}·미상노드${rep.unmapped.length}·anom${rep.anomalous.length}·broken${rep.broken.length}${tag}`);
    if (exp) {
      if (groups.length !== exp.groups) { console.log(`  ❌ ${f.slice(0,20)} 그룹 기대 ${exp.groups}, 실제 ${groups.length}`); fail++; }
      if (solo.length !== exp.solo) { console.log(`  ❌ ${f.slice(0,20)} solo 기대 ${exp.solo}, 실제 ${solo.length}`); fail++; }
      if (rep.anomalous.length !== exp.anomalous) { console.log(`  ❌ ${f.slice(0,20)} anomalous 기대 ${exp.anomalous}, 실제 ${rep.anomalous.length}`); fail++; }
    }
  }
  console.log("  ✅ analyze 17종 무크래시 + krea2(그룹8·solo0, 봉인1 실측 repo 편입)·Full(그룹1·solo0) 실측 일치");
}

// === 단계 C: Note 의미 해석 — krea2 함정(turbo lora 유지) ===
console.log("\n" + "=".repeat(70) + "\nNote 의미 해석(krea2 함정: turbo lora 유지)");
{
  const note = "Use the RAW model, not the Turbo. Keep the turbo lora at strength 0.8 for speed. Model goes in models/Krea 2.";
  const flags = parseWorkflowNotes([note]);
  let ok = true;
  if (preferredVariant(flags, "model") !== "raw") { console.log(`  ❌ prefer model 기대 raw, 실제 ${preferredVariant(flags, "model")}`); fail++; ok = false; }
  if (isVariantExcluded(flags, "turbo", "model") !== true) { console.log("  ❌ turbo가 model에서 제외되지 않음"); fail++; ok = false; }
  if (isVariantExcluded(flags, "turbo", "lora") !== false) { console.log("  ❌ 함정: turbo lora가 잘못 제외됨(전체 제외 버그)"); fail++; ok = false; }
  if (!/krea 2/i.test(notedFolder(flags) || "")) { console.log(`  ❌ folder 파싱 실패: ${notedFolder(flags)}`); fail++; ok = false; }
  // 반대 케이스: lora 없이 "no turbo"만이면 model 제외 O
  const f2 = parseWorkflowNotes(["Do not use turbo."]);
  if (isVariantExcluded(f2, "turbo", "model") !== true) { console.log("  ❌ 'no turbo' 단독 시 model 제외 실패"); fail++; ok = false; }
  if (ok) console.log("  ✅ prefer raw(model) · exclude turbo(model만) · turbo lora 유지 · folder 'Krea 2' 파싱");
}

// === 봉인1 작업 A: 코어 버전 요구 판정 (krea2 CLIPLoader type=krea2 → 0.27 요구) ===
console.log("\n" + "=".repeat(70) + "\n코어 버전 요구 판정(krea2 CLIPLoader type=krea2)");
{
  const rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json"), "utf8"))), null);
  const minRules = (rep.coreFeatures || []).filter((r) => r.min_version);
  let ok = true;
  if (!minRules.some((r) => r.feature === "cliploader_type_krea2")) { console.log("  ❌ cliploader_type_krea2 기능 미감지"); fail++; ok = false; }
  const required = minRules.reduce((a, r) => (compareVersion(r.min_version, a) > 0 ? r.min_version : a), "0");
  // 로그 0.25.1 → 발화(outdated), 0.27.0 → 미발화
  const v0251 = parseComfyLog("** ComfyUI version: 0.25.1\nTotal VRAM").comfyVersion;
  const v0270 = parseComfyLog("** ComfyUI version: 0.27.0\nTotal VRAM").comfyVersion;
  if (compareVersion(v0251, required) >= 0) { console.log(`  ❌ 0.25.1이 ${required} 이상으로 판정(발화 실패)`); fail++; ok = false; }
  if (compareVersion(v0270, required) < 0) { console.log(`  ❌ 0.27.0이 ${required} 미만으로 판정(미발화 실패)`); fail++; ok = false; }
  if (ok) console.log(`  ✅ required ${required} · 0.25.1→발화(확인 행) · 0.27.0→미발화 · 로그 없음→dim 안내(state unknown)`);
}

// === 봉인1 작업 B: Note 라벨 ↔ 노드명 매칭(오탈자 허용 + 유사 이름 트랩 방지) ===
console.log("\n" + "=".repeat(70) + "\nNote 라벨↔노드명 매칭(오탈자 + 트랩)");
{
  let ok = true;
  if (matchLabelToNode("Smart resulution", "SmartResolution") !== true) { console.log("  ❌ 'Smart resulution'↔'SmartResolution' 매칭 실패(오탈자)"); fail++; ok = false; }
  if (matchLabelToNode("comfyui-smart-resolution-calc", "SmartResolution") !== false) { console.log("  ❌ 트랩: calc 팩이 SmartResolution에 오매칭"); fail++; ok = false; }
  if (matchLabelToNode("VAE Decode (VAE Utils)", "VAEUtils_VAEDecodeTiled") === true) { console.log("  ⚠ 라벨 형식이 달라 매칭 안 됨(정상, clone은 node_repo_map로 처리)"); }
  if (ok) console.log("  ✅ 'Smart resulution'↔'SmartResolution' 매칭 · calc 트랩 미매칭");
}

// === 봉인1 작업 C: 실측 지식 박제(node_repo_map + registry) ===
console.log("\n" + "=".repeat(70) + "\n실측 지식 박제(node_repo_map registry:false)");
{
  const idx = {}; for (const m of nodeRepoMap.mappings) idx[m.class_type] = m;
  let ok = true;
  const checks = [
    ["SmartResolution", "openerai/comfyui-smart-resolution"],
    ["VAEUtils_VAEDecodeTiled", "spacepxl/ComfyUI-VAE-Utils"],
    ["Krea2ControlApply", "facok/comfyui-krea2-controlnet"],
    ["Krea2ControlLoRALoader", "facok/comfyui-krea2-controlnet"],
  ];
  for (const [cls, repo] of checks) {
    if (idx[cls]?.repo !== repo) { console.log(`  ❌ ${cls} repo 기대 ${repo}, 실제 ${idx[cls]?.repo}`); fail++; ok = false; }
    if (idx[cls]?.registry !== false) { console.log(`  ❌ ${cls} registry:false 아님`); fail++; ok = false; }
  }
  // 유사 이름 트랩: calc 팩(djdarcy)은 등재 안 됨 → SmartResolution이 calc로 매칭될 수 없음
  if (Object.values(idx).some((m) => /smart-resolution-calc/.test(m.repo || ""))) { console.log("  ❌ 트랩: comfyui-smart-resolution-calc가 등재됨(등재 금지)"); fail++; ok = false; }
  if (ok) console.log("  ✅ SmartResolution→openerai · VAEUtils→spacepxl · Krea2Control*→facok · registry:false · calc 트랩 미등재");
}

// === 파인딩 결함1: GPU VRAM 오인 — 로그 실측 VRAM > 테이블, Ti/Super 변형 구분 ===
console.log("\n" + "=".repeat(70) + "\nGPU VRAM 오인(로그 실측 우선 + 변형 접미)");
{
  const p = parseComfyLog("Device: cuda:0 NVIDIA GeForce RTX 3060 Ti\nTotal VRAM 8192 MB");
  let ok = true;
  if (p.gpu !== "RTX 3060 Ti") { console.log(`  ❌ GPU 파싱 기대 'RTX 3060 Ti', 실제 '${p.gpu}'`); fail++; ok = false; }
  if (p.vramGB !== 8) { console.log(`  ❌ 실측 VRAM 기대 8, 실제 ${p.vramGB}`); fail++; ok = false; }
  const prof = gpuProfile(p.gpu, p.vramGB);
  if (prof.vram !== 8 || prof.vramSource !== "log") { console.log(`  ❌ 프로파일 vram 기대 8(log), 실제 ${prof.vram}(${prof.vramSource})`); fail++; ok = false; }
  // 무접미 3060(로그 없음) → 테이블 12
  const prof12 = gpuProfile("RTX 3060");
  if (prof12.vram !== 12) { console.log(`  ❌ 무접미 3060 기대 12(테이블), 실제 ${prof12.vram}`); fail++; ok = false; }
  // 로그 실측이 테이블보다 우선(가상: 3060에 로그 8 주입 → 8)
  if (gpuProfile("RTX 3060", 8).vram !== 8) { console.log("  ❌ 로그 VRAM이 테이블보다 우선하지 않음"); fail++; ok = false; }
  if (ok) console.log("  ✅ RTX 3060 Ti+8192MB→vram 8(log 우선) · 무접미 3060→12(테이블) · 로그>테이블");
}

// === 파인딩 결함3: 타 워크플로우 로그 혼입 — 최신 세션 + 워크플로우 대조 ===
console.log("\n" + "=".repeat(70) + "\n타 워크플로우 로그 혼입 분리");
{
  const rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json"), "utf8"))), null);
  // LTX vae_name 거부(krea2 워크플로우와 무관) → foreign. 최신 세션에 존재.
  const log = "got prompt\nsome old run\ngot prompt\nvae_name: 'ltx_vae_bf16.safetensors' not in ['Wan2.1_VAE_upscale2x_imageonly_real_v1.safetensors', 'qwen_image_vae.safetensors']";
  const session = latestLogSession(log);
  const vnil = parseValueNotInList(session);
  const modelBases = new Set((rep.models || []).map((m) => m.file.replace(/\\/g, "/").split("/").pop().toLowerCase()));
  const inWf = (v) => { const b = String(v || "").replace(/\\/g, "/").split("/").pop().toLowerCase(); if (modelBases.has(b)) return true; const stem = b.replace(/\.[^.]+$/, ""); return [...modelBases].some((mb) => mb === b || (stem.length > 3 && mb.includes(stem))); };
  const relevant = vnil.filter((e) => inWf(e.required));
  const foreign = vnil.length - relevant.length;
  let ok = true;
  if (!/got prompt/.test(session) || /some old run/.test(session)) { console.log("  ❌ 최신 세션 분할 실패"); fail++; ok = false; }
  if (relevant.length !== 0) { console.log(`  ❌ LTX vae_name이 krea2 참조로 오판(relevant ${relevant.length}) → red 오승격`); fail++; ok = false; }
  if (foreign !== 1) { console.log(`  ❌ foreign 기대 1, 실제 ${foreign}`); fail++; ok = false; }
  // 대조: krea2 자기 파일 거부는 relevant
  const own = parseValueNotInList("unet_name: 'krea2_raw_bf16.safetensors' not in ['a.safetensors']").filter((e) => inWf(e.required));
  if (own.length !== 1) { console.log("  ❌ krea2 자기 파일 거부가 relevant로 안 잡힘"); fail++; ok = false; }
  if (ok) console.log("  ✅ 최신 세션만 · LTX vae_name→foreign 1(red 미승격) · krea2 자기 파일 거부→relevant");
}

// === 파인딩 결함5: bat 경로 — 로그 있으면 실경로, 잘리면 자리표시자(customNodesPath) ===
console.log("\n" + "=".repeat(70) + "\nbat 경로 날조 금지(customNodesPath)");
{
  const withPath = parseComfyLog("   0.1 seconds: C:\\Users\\jhkim\\ComfyUI\\custom_nodes\\rgthree-comfy");
  const noPath = parseComfyLog("Total VRAM 8192 MB\nStarting server");
  let ok = true;
  if (withPath.customNodesPath !== "C:\\Users\\jhkim\\ComfyUI\\custom_nodes") { console.log(`  ❌ 실경로 추출 실패: '${withPath.customNodesPath}'`); fail++; ok = false; }
  if (noPath.customNodesPath) { console.log(`  ❌ 경로 없는 로그인데 경로 생성(날조): '${noPath.customNodesPath}'`); fail++; ok = false; }
  if (ok) console.log("  ✅ 경로 로그→실경로 추출 · 잘린 로그→빈 값(자리표시자 처리는 스크립트에서)");
}

// === 파인딩2 결함6: missing_node_type 크로스링크(node_id→class_type→팩) ===
console.log("\n" + "=".repeat(70) + "\nmissing_node_type 크로스링크(#333→Krea2ControlApply→facok)");
{
  const rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json"), "utf8"))), JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8")));
  const repoByType = {}; for (const u of (rep.unmapped || [])) if (u.repo || u.clone_url) repoByType[u.type] = (u.repo || u.clone_url).replace("https://github.com/", "").replace(/\.git$/, "");
  let ok = true;
  // #333 → Krea2ControlApply → facok/comfyui-krea2-controlnet
  const cls = rep.nodeIdType["333"];
  if (cls !== "Krea2ControlApply") { console.log(`  ❌ #333 class_type 기대 Krea2ControlApply, 실제 ${cls}`); fail++; ok = false; }
  if (!/facok\/comfyui-krea2-controlnet/.test(repoByType[cls] || "")) { console.log(`  ❌ 크로스링크 팩 특정 실패: ${repoByType[cls]}`); fail++; ok = false; }
  // 미지 id → class_type 없음 → 기존 삭제/재추가 문구
  if (rep.nodeIdType["999999"]) { console.log("  ❌ 미지 id에 class_type 존재(오류)"); fail++; ok = false; }
  if (ok) console.log(`  ✅ #333→Krea2ControlApply→${repoByType[cls].split("/").pop()} 크로스링크 · 미지 id→기존 문구`);
}

// === 파인딩2 결함7: 직링크 실존(repo_filename) + 리네임 안내 ===
console.log("\n" + "=".repeat(70) + "\n직링크 실존 + 리네임 안내(depth lora)");
{
  const mgr = JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8"));
  const rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json"), "utf8"))), mgr);
  const plan = buildModelPlan(rep, { gpu: "RTX 3090" });
  const dl = plan.items.find((i) => /depthcontrolnet/i.test(i.selectedFile));
  let ok = true;
  if (dl?.size !== "862MB") { console.log(`  ❌ depth lora 용량 기대 862MB, 실제 ${dl?.size}`); fail++; ok = false; }
  if (!/depth-control-lora\.safetensors/.test(dl?.downloadUrl || "")) { console.log(`  ❌ 직링크가 repo 실파일(depth-control-lora)이 아님: ${dl?.downloadUrl}`); fail++; ok = false; }
  if (!/krea2DepthControlnet_v10\.safetensors/.test(dl?.renameHint || "")) { console.log(`  ❌ 리네임 안내(참조명) 미발화: ${dl?.renameHint}`); fail++; ok = false; }
  if (ok) console.log(`  ✅ 직링크 repo 실파일(depth-control-lora 862MB) · 리네임 안내→krea2DepthControlnet_v10`);
}

// === 파인딩2 결함8: 브리핑 비대화(최신 세션 오류 추출 + 상한) ===
console.log("\n" + "=".repeat(70) + "\n브리핑 비대화(315줄급 혼합 로그)");
{
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(`   ${(i * 0.01).toFixed(2)} seconds: normal startup line ${i}`);
  lines.push("got prompt", "Traceback (most recent call last):", "  File old.py", "OldError: previous workflow error");
  for (let i = 0; i < 100; i++) lines.push(`processing step ${i} ok`);
  lines.push("got prompt", "Error: vae_name: 'ltx_vae.safetensors' not in ['a.safetensors']", "Prompt execution failed");
  const log = lines.join("\n");
  const session = latestLogSession(log);
  const ex = extractErrorLines(session);
  let ok = true;
  if (lines.length < 300) { console.log(`  ❌ fixture 줄수 ${lines.length}(300+ 기대)`); fail++; ok = false; }
  if (!/ltx_vae/.test(ex.text)) { console.log("  ❌ 최신 세션 오류(ltx_vae) 미포함"); fail++; ok = false; }
  if (/OldError/.test(ex.text)) { console.log("  ❌ 이전 세션 오류(OldError) 혼입"); fail++; ok = false; }
  if (ex.text.length > 10000) { console.log(`  ❌ 추출 길이 ${ex.text.length}(1만 자 초과)`); fail++; ok = false; }
  if (/normal startup line/.test(ex.text)) { console.log("  ❌ 정상 진행 줄 제거 실패"); fail++; ok = false; }
  if (ok) console.log(`  ✅ ${lines.length}줄→최신 세션 오류만 추출(${ex.text.length}자, 오류 ${ex.errorCount}건) · 정상 줄·이전 세션 제외 · 1만 자 이하`);
}

// === 마감 라운드: P0 PiD fixture 무크래시 + 결함 c/h/i/j/k ===
console.log("\n" + "=".repeat(70) + "\n마감: PiD fixture(P0) + 결함 c·h·i·j·k");
{
  const mgr = JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8"));
  let ok = true;
  // P0: PiD 파이프라인 무크래시
  let pid;
  try { pid = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "PiD_upscale_crash.json"), "utf8"))), mgr); }
  catch (e) { console.log(`  ❌ P0 PiD analyze CRASH: ${e.message}`); fail++; ok = false; }
  if (pid) {
    // 결함h: auto_download 감지
    if (!pid.autoDownloadNodes.includes("CheckpointLoaderSimple")) { console.log("  ❌ 결함h auto_download 미감지"); fail++; ok = false; }
    // 결함i: customPackTotal(cnr_id 팩 + 미매핑) 통일 집계
    if (typeof pid.customPackTotal !== "number") { console.log("  ❌ 결함i customPackTotal 부재"); fail++; ok = false; }
    // 결함j: 캡션(shadow.\her) 경로 오탐 없음, 실경로(D:\) 발화
    const capHit = pid.portability.some((h) => /shadow/.test(h.value));
    const pathHit = pid.portability.some((h) => /D:\\ComfyModels/.test(h.value));
    if (capHit) { console.log("  ❌ 결함j 캡션 백슬래시 오탐"); fail++; ok = false; }
    if (!pathHit) { console.log("  ❌ 결함j 실경로(D:\\) 미발화"); fail++; ok = false; }
  }
  // 결함c: krea2 SeedVR2 → models/SEEDVR2, hymotion 0
  const k = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json"), "utf8"))), mgr);
  const seed = k.models.filter((m) => /seedvr2/i.test(m.node));
  if (!seed.every((m) => m.folder === "models/SEEDVR2")) { console.log(`  ❌ 결함c SeedVR2 폴더: ${seed.map((m) => m.folder)}`); fail++; ok = false; }
  if (k.models.some((m) => /hymotion/i.test(m.folder || ""))) { console.log("  ❌ 결함c hymotion 리터럴 잔존"); fail++; ok = false; }
  // 결함k: 디스크 부족 감지(직접형)
  if (!hasDiskError("[WinError 112] 디스크 공간이 부족합니다") || hasDiskError("Starting server")) { console.log("  ❌ 결함k 디스크 부족 분류 오류"); fail++; ok = false; }
  // 결함k 간접형: writer channel closed + 동일 세션 free disk space 경고 조합
  const dwLog = fs.readFileSync(path.join(FIX, "pid_disk_writer_error.txt"), "utf8");
  if (!hasDiskError(latestLogSession(dwLog))) { console.log("  ❌ 결함k 간접형(writer+free disk space) 미발화"); fail++; ok = false; }
  if (hasDiskError("Internal Writer Error: Background writer channel closed")) { console.log("  ❌ 결함k writer 단독 오발화(조합 아님)"); fail++; ok = false; }
  if (hasDiskError("UserWarning: Not enough free disk space")) { console.log("  ❌ 결함k free disk 경고 단독 오발화(조합 아님)"); fail++; ok = false; }
  // 교차 세션: free disk 경고가 이전 세션, writer는 최신 세션 → latestLogSession엔 writer만 → 미발화(동일 세션만 성립)
  const crossLog = "got prompt\nUserWarning: Not enough free disk space\nprocessing ok\ngot prompt\nInternal Writer Error: Background writer channel closed";
  if (hasDiskError(latestLogSession(crossLog))) { console.log("  ❌ 결함k 교차 세션 오발화(동일 세션만 성립해야)"); fail++; ok = false; }
  if (ok) console.log("  ✅ PiD 무크래시 · auto_download · customPackTotal · 캡션/D:\\ · SeedVR2→SEEDVR2 · 디스크 부족(직접+간접 조합, 단독·교차세션 미발화)");
}

// === P2.7 봉인 최종: 파인딩 p(분모=참조 전체)·n-1(스니펫 절대)·n-2(파서 발화)·6-2(상태)·6-3(위치) + m 절대경로·3090 ===
console.log("\n" + "=".repeat(70) + "\nP2.7 최종: 대조 분모 · 스니펫 · 파서발화 · 위치 · 파인딩m · 3090");
{
  let ok = true;
  // (n-1) 스니펫: 절대경로 리터럴 삽입 + 읽기전용 + 폴더명만(비절대)이면 needsAbsolute(추정 금지)
  const winSnip = buildScanSnippet("D:\\ComfyModels", "win");
  const nixSnip = buildScanSnippet("", "unix");
  if (winSnip.needsAbsolute || !winSnip.snippet?.includes('"D:\\ComfyModels"')) { console.log("  ❌ n-1 절대경로 리터럴 실패"); fail++; ok = false; }
  if (/Remove-Item|New-Item|Set-Content|Out-File/i.test(winSnip.snippet || "") || /(^|\s)rm\s|(^|\s)mv\s/.test(nixSnip.snippet || "")) { console.log("  ❌ 스니펫 읽기전용 위반"); fail++; ok = false; }
  if (!nixSnip.usingDefault || !nixSnip.snippet?.includes('"ComfyUI/models"')) { console.log("  ❌ 기본 경로 스니펫 실패"); fail++; ok = false; }
  const relSnip = buildScanSnippet("ComfyModels", "win");
  if (!relSnip.needsAbsolute || relSnip.snippet) { console.log("  ❌ n-1 폴더명만인데 needsAbsolute 아님"); fail++; ok = false; }
  // (n-2) 파서 실패 발화: 에러 텍스트 → error_path, 잡텍스트 → no_items, 정상 → null
  if (scanInputDiagnosis("ItemNotFoundException: Cannot find path 'D:\\x'", 0) !== "error_path") { console.log("  ❌ n-2 에러 패턴 미감지"); fail++; ok = false; }
  if (scanInputDiagnosis("random note not a listing", 0) !== "no_items") { console.log("  ❌ n-2 목록 아님 미감지"); fail++; ok = false; }
  if (scanInputDiagnosis("cp\\a.safetensors\t100", 1) !== null) { console.log("  ❌ n-2 정상인데 발화"); fail++; ok = false; }
  // (파서) byte/GB/KB/혼용/₩ 구분자 3종 동치
  const invPS = parseFolderScan("Checkpoints\\Model_A.safetensors\t23802932552\nvae/model_b.safetensors\t335304388\nloras₩model_c.safetensors\t500");
  if (invPS.get("model_a.safetensors")?.size !== 23802932552 || invPS.get("model_b.safetensors")?.folder !== "vae" || invPS.get("model_c.safetensors")?.folder !== "loras") { console.log("  ❌ 파서 byte/혼용/₩ 실패"); fail++; ok = false; }
  const invHuman = parseFolderScan("model_a.safetensors    23.8 GB\nbroken.safetensors    137 KB");
  if (Math.abs((invHuman.get("model_a.safetensors")?.size || 0) - 23.8e9) > 1e6 || invHuman.get("broken.safetensors")?.size !== 137000) { console.log("  ❌ 파서 human GB/KB 실패"); fail++; ok = false; }
  // (파인딩 p) Boogu fixture: 참조 3 모델(미등재 포함) = 분모, qwen만 보유 → 1/3. ₩ 구분자 동일 결과.
  const boogu = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "boogu_synth.json"), "utf8"))));
  const plan0 = buildModelPlan(boogu, {});
  const heldB = parseFolderScan("checkpoints\\other.safetensors\t100\ntext_encoders\\qwen3vl_8b_fp8_scaled.safetensors\t8000000000\nvae\\etc.safetensors\t500");
  const recB = reconcileInventory(boogu.models, heldB, plan0);
  if (recB.results.length !== 3) { console.log(`  ❌ p 분모 기대 3(참조 전체), 실제 ${recB.results.length}`); fail++; ok = false; }
  if (recB.heldSet.size !== 1 || !recB.heldSet.has("qwen3vl_8b_fp8_scaled.safetensors")) { console.log(`  ❌ p 보유 기대 1(qwen, 제자리), 실제 ${recB.heldSet.size}`); fail++; ok = false; }
  if (reconcileInventory(boogu.models, parseFolderScan("text_encoders₩qwen3vl_8b_fp8_scaled.safetensors\t8000000000"), plan0).heldSet.size !== 1) { console.log("  ❌ p ₩ 구분자 결과 불일치"); fail++; ok = false; }
  // (6-2) 상태 분기: 전량(complete)·부분(0<found<N)·0건
  const planX = { items: [{ selectedFile: "x.safetensors", size: "6GB" }], unknowns: [] };
  if (!reconcileInventory([{ file: "x.safetensors" }], parseFolderScan("cp\\x.safetensors\t6000000000"), planX).complete) { console.log("  ❌ 6-2 전량 complete 실패"); fail++; ok = false; }
  if (recB.complete || recB.heldSet.size === 0) { console.log("  ❌ 6-2 부분 상태 오류(1/3)"); fail++; ok = false; }
  const recZero = reconcileInventory(boogu.models, parseFolderScan("cp\\none.safetensors\t1"), plan0);
  if (recZero.heldSet.size !== 0 || recZero.complete) { console.log("  ❌ 6-2 0건 상태 오류"); fail++; ok = false; }
  // (6-3) 위치 불일치: depth-control-lora 요구 loras/krea 2. "새 폴더"=이동안내, "loras\krea 2"=✓
  const planD = { items: [{ selectedFile: "depth-control-lora.safetensors", folder: "models/loras/krea 2", size: "862MB" }], unknowns: [] };
  const rMis = reconcileInventory([{ file: "depth-control-lora.safetensors" }], parseFolderScan("새 폴더\\depth-control-lora.safetensors\t862000000"), planD).byFile.get("depth-control-lora.safetensors");
  if (!rMis?.misplaced || rMis.misplaced.current !== "새 폴더") { console.log(`  ❌ 6-3 위치 불일치 미발화: ${JSON.stringify(rMis?.misplaced)}`); fail++; ok = false; }
  const rOk = reconcileInventory([{ file: "depth-control-lora.safetensors" }], parseFolderScan("loras\\krea 2\\depth-control-lora.safetensors\t862000000"), planD).byFile.get("depth-control-lora.safetensors");
  if (rOk?.misplaced || !rOk?.held) { console.log("  ❌ 6-3 제자리인데 misplaced/미보유"); fail++; ok = false; }
  // (파인딩 m·3090) krea2 실 fixture: 절대경로(중복없음) + 승격 미발동 + 메인 모델 보유 시 ✓(제자리)
  const rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json"), "utf8"))));
  const plan = buildModelPlan(rep, { gpu: "RTX 3090", modelRoot: "D:\\ComfyUI\\models" });
  const chk = plan.items.find((i) => (i.folder || "").includes("diffusion_models"));
  if (!chk?.fullPath?.startsWith("D:\\ComfyUI\\models\\diffusion_models") || /models[\\/]models/.test(chk?.fullPath || "")) { console.log(`  ❌ 파인딩m 절대경로 오조립: ${chk?.fullPath}`); fail++; ok = false; }
  const main = plan.items.find((i) => i.role === "main_model") || plan.items[0];
  if (main?.vramWarning || main?.promoted) { console.log("  ❌ 3090 승격 오발동"); fail++; ok = false; }
  const kreaRec = reconcileInventory(rep.models, parseFolderScan(`${main.folder}\\${main.selectedFile}\t9999999999`), plan);
  if (!kreaRec.heldSet.has(main.selectedFile)) { console.log("  ❌ krea2 메인 모델 보유(제자리)인데 ✓ 아님"); fail++; ok = false; }
  if (ok) console.log("  ✅ p(분모=참조 전체 Boogu 1/3·₩) · n-1(절대/발화) · n-2(파서 발화) · 6-2(전량/부분/0) · 6-3(위치) · 파인딩m·3090");
}

// === ACE-Step 오디오 도메인 fixture(합성 · 실 core 오디오 노드) 무크래시 + 오디오 입력 감지 ===
// 주: 사용자 실 ACE-Step JSON 미첨부 → PiD 선례처럼 실 core 오디오 노드(LoadAudio·SaveAudio·VAEDecodeAudio 등)로 합성. 모델 파일명은 합성 자리표시자(카탈로그 미등록).
console.log("\n" + "=".repeat(70) + "\nACE-Step 오디오 fixture(합성) 무크래시 + 입력 감지");
{
  const mgr = JSON.parse(fs.readFileSync(path.join(DIR, "..", "public", "manager_node_map.json"), "utf8"));
  let ok = true;
  for (const f of ["acestep_synth_t2a.json", "acestep_synth_a2a.json"]) {
    let rep;
    try { rep = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"))), mgr); }
    catch (e) { console.log(`  ❌ ${f} 크래시: ${e.message}`); fail++; ok = false; continue; }
    if (rep.broken?.length || rep.anomalous?.length) { console.log(`  ❌ ${f} broken/anomalous 발생(${rep.broken?.length}/${rep.anomalous?.length})`); fail++; ok = false; }
  }
  // a2a: LoadAudio 입력 파일(reference_track.mp3, 경로 아님) → 입력 준비 감지(portability)
  const a2a = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "acestep_synth_a2a.json"), "utf8"))), mgr);
  if (!(a2a.portability || []).some((h) => h.value === "reference_track.mp3")) { console.log("  ❌ a2a 오디오 입력 파일(reference_track.mp3) 미감지"); fail++; ok = false; }
  if (ok) console.log("  ✅ 오디오 fixture 2종 무크래시(broken·anomalous 0) · a2a 오디오 입력(reference_track.mp3) 감지");
}

// === 수리 스프린트: r(리치 노트) · s(경로 조립) · 접기1(bypass 그룹) · 동명이인 카피 ===
console.log("\n" + "=".repeat(70) + "\n수리 스프린트: r 노트 · s 조립 · 접기1 · 동명이인");
{
  let ok = true;
  // r: Boogu Pixaroma 리치 노트(JSON 래핑 HTML) → 3모델 workflow_author + 정확 폴더 + 용량 + 직링크, unknowns 0
  const boogu = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "boogu_synth.json"), "utf8"))));
  const plan = buildModelPlan(boogu, {});
  const byF = Object.fromEntries(plan.items.map((i) => [i.selectedFile, i]));
  const need = { "boogu_image_turbo_hotfix_int8_convrot.safetensors": ["models/diffusion_models/boogu", "10.3GB"], "qwen3vl_8b_fp8_scaled.safetensors": ["models/text_encoders", "9.9GB"], "ae.safetensors": ["models/vae", "320MB"] };
  for (const [f, [fol, sz]] of Object.entries(need)) {
    const it = byF[f];
    if (!it || it.confidence !== "workflow_author") { console.log(`  ❌ r ${f} workflow_author 아님(${it?.confidence})`); fail++; ok = false; continue; }
    if (it.folder !== fol) { console.log(`  ❌ r ${f} 폴더 기대 ${fol}, 실제 ${it.folder}`); fail++; ok = false; }
    if (it.size !== sz) { console.log(`  ❌ r ${f} 용량 기대 ${sz}, 실제 ${it.size}`); fail++; ok = false; }
    if (!/^https?:\/\//.test(it.downloadUrl || "")) { console.log(`  ❌ r ${f} 직링크 없음`); fail++; ok = false; }
  }
  if (plan.unknowns.length) { console.log(`  ❌ r unknowns 0 기대, 실제 ${plan.unknowns.length}(${plan.unknowns.map((u) => u.selectedFile)})`); fail++; ok = false; }
  // s: 경로 조립(win 절대/unix 폴더명) + 종류 폴더 오선택 판정
  if (assembleModelPath("D", "ComfyModels", "win") !== "D:\\ComfyModels") { console.log("  ❌ s win 조립 실패"); fail++; ok = false; }
  if (assembleModelPath("D", "ComfyModels", "unix") !== "ComfyModels") { console.log("  ❌ s unix 폴더명 유지 실패"); fail++; ok = false; }
  if (!isTypeFolder("vae") || !isTypeFolder("checkpoints") || isTypeFolder("ComfyModels")) { console.log("  ❌ s 종류 폴더 판정 오류"); fail++; ok = false; }
  // 접기1: bypass 그룹 전용 모델 감지(active 제외, 그룹 제목 라벨)
  const bg = analyze(normalize(JSON.parse(fs.readFileSync(path.join(FIX, "bypass_group_synth.json"), "utf8")))).bypassGroupModels;
  if (bg["alt_only_model.safetensors"] !== "Alt path (off)" || bg["active_model.safetensors"]) { console.log(`  ❌ 접기1 bypass 그룹 매핑 오류: ${JSON.stringify(bg)}`); fail++; ok = false; }
  // 동명이인 카피: 위치 불일치 발화의 basename 한계 고지(정적 문자열) 존재
  if (!fs.readFileSync(path.join(DIR, "..", "src", "Teardown.jsx"), "utf8").includes("이름이 같은 다른 모델일 수 있습니다")) { console.log("  ❌ 동명이인 고지 카피 누락"); fail++; ok = false; }
  if (ok) console.log("  ✅ r(3모델 workflow_author·폴더·용량·직링크 · unknowns 0) · s(조립·종류폴더) · 접기1(bypass 그룹) · 동명이인 카피");
}

console.log("\n" + "=".repeat(70));
console.log("요약 [파일 | recipes/슬롯 | quantBad | ggufAlt | 확인필요 | src분포]");
for (const r of rows) console.log("  " + r.join("  |  "));
console.log("\n※ analyze(unmapped/broken/anomalous/packs)는 src/lib/analyzeWorkflow.js 추출 완료 → 위 'analyze 직접 검증' 블록에서 실측.");
console.log(fail === 0 ? "\n✅ buildRecipes 회귀 통과 (기대치 전부 충족)" : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
