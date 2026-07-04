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

  // 기대치 (buildRecipes 범위)
  if (isLTX) {
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

console.log("\n" + "=".repeat(70));
console.log("요약 [파일 | recipes/슬롯 | quantBad | ggufAlt | 확인필요 | src분포]");
for (const r of rows) console.log("  " + r.join("  |  "));
console.log("\n※ analyze 항목(unmapped/broken/repoSrc)은 Teardown.jsx 내부(JSX)라 node 불가 → 추출 후 검증 필요.");
console.log(fail === 0 ? "\n✅ buildRecipes 회귀 통과 (기대치 전부 충족)" : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
