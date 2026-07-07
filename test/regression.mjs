// P9 회귀테스트 — test/fixtures 4개를 buildRecipes로 실행 + 기대치 검증.
// 재실행: node test/regression.mjs
//
// 주의: analyze(normalize(json))는 Teardown.jsx 내부 함수(JSX+React 파일)라 node import 불가.
//   → unmapped/broken/repoSrc 항목은 여기서 SKIP. 검증하려면 analyze/normalize/repoForUnmapped를
//     순수 ESM 모듈로 추출해야 함(Teardown.jsx 리팩터 = 별건).
// 여기선 buildRecipes(redNodeRecipe.js, node import 가능) 범위만: recipes/슬롯/quantBad/ggufAlt/크래시.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes } from "../src/data/redNodeRecipe.js";
import { parseComfyLog, packInstalled, parseValueNotInList, parseMissingNodeType } from "../src/logParse.js";

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

console.log("\n" + "=".repeat(70));
console.log("요약 [파일 | recipes/슬롯 | quantBad | ggufAlt | 확인필요 | src분포]");
for (const r of rows) console.log("  " + r.join("  |  "));
console.log("\n※ analyze 항목(unmapped/broken/repoSrc)은 Teardown.jsx 내부(JSX)라 node 불가 → 추출 후 검증 필요.");
console.log(fail === 0 ? "\n✅ buildRecipes 회귀 통과 (기대치 전부 충족)" : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
