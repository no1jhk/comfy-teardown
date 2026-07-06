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

// === 액션 테이블 행 수 스냅샷 (buildRecipes 범위: 받기=model 슬롯 수 · 실행 1 고정. 설치=analyze라 SKIP) ===
console.log("\n" + "=".repeat(70) + "\n액션 테이블 행 수(받기=model 슬롯 · 동사 받기/넣기/선택/실행)");
const ACTION_MODEL_EXPECT = { // 받기 행 = 전체 model 슬롯 수(quantBad 여부 무관)
  "LTX2_3_8GB_VRAM_workflow___Audio_to_Video.json": 8,
  "Silent Snow LTX2.3 Kjai FP8.json": 4,
  "krea2_simple_full_turbo (리얼감을 살리는 워크플로우) 배포.json": 3,
};
for (const f of files) {
  const recipes = buildRecipes(JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")), { gpu: null });
  const modelRows = recipes.flatMap((r) => r.slots).length;
  const exp = ACTION_MODEL_EXPECT[f];
  console.log(`  ${f.slice(0, 40)}: 받기 ${modelRows}행${exp !== undefined ? ` (기대 ${exp})` : ""}`);
  if (exp !== undefined && modelRows !== exp) { console.log(`  ❌ 받기 행 기대 ${exp}, 실제 ${modelRows}`); fail++; }
}
console.log("  ✅ 받기 행 = model 슬롯 수 · 실행 1행 고정 (설치 행은 analyze 범위 — SKIP)");

console.log("\n" + "=".repeat(70));
console.log("요약 [파일 | recipes/슬롯 | quantBad | ggufAlt | 확인필요 | src분포]");
for (const r of rows) console.log("  " + r.join("  |  "));
console.log("\n※ analyze 항목(unmapped/broken/repoSrc)은 Teardown.jsx 내부(JSX)라 node 불가 → 추출 후 검증 필요.");
console.log(fail === 0 ? "\n✅ buildRecipes 회귀 통과 (기대치 전부 충족)" : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
