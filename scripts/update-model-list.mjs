#!/usr/bin/env node
/**
 * update-model-list.mjs
 * ComfyUI-Manager의 model-list.json을 받아서 Teardown용으로 가공 →
 * src/data/manager-model-list.json 으로 저장.
 *
 * 사용법: node scripts/update-model-list.mjs
 * 주기: 월 1회 권장 (HISTORY.md에 갱신일 기록).
 *   - web_search 폴백이 있어 갱신이 늦어도 치명적이지 않음(3층 구조가 메움).
 *
 * 가공: filename → 소문자 stem 키 → { url, folder, size, name, base }
 *   Teardown의 compatModelInfo()가 이 stem 키로 조회.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/model-list.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "manager-model-list.json");

const stemKey = (fn) => fn.toLowerCase().replace(/\.[^.]+$/, "");

async function main() {
  console.log("Fetching Manager model-list.json ...");
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const data = await res.json();
  const list = data.models || [];

  const models = {};
  for (const m of list) {
    const fn = m.filename || "";
    if (!fn) continue;
    models[stemKey(fn)] = {
      url: m.url || "",
      folder: m.save_path || "",
      size: m.size || "",
      name: m.name || "",
      base: m.base || "",
    };
  }

  const out = {
    _meta: {
      source: "ComfyUI-Manager model-list.json (Comfy-Org/ComfyUI-Manager main)",
      fetched: new Date().toISOString().slice(0, 10),
      count: Object.keys(models).length,
      update: "월 1회 node scripts/update-model-list.mjs 로 갱신",
    },
    models,
  };

  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Saved ${Object.keys(models).length} models → ${OUT}`);
  console.log("HISTORY.md에 갱신일 기록 권장.");
}

main().catch((e) => {
  console.error("update-model-list 실패:", e.message);
  process.exit(1);
});
