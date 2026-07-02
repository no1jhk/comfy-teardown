// scripts/build-nodemap.mjs
// ComfyUI-Manager extension-node-map.json → class_type→repo 역매핑 생성 (compact).
// Usage: node scripts/build-nodemap.mjs

import { writeFileSync } from "node:fs";

const SRC_URL = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/extension-node-map.json";
const OUT_PATH = "public/manager_node_map.json";
const CORE_URL = "https://github.com/comfyanonymous/ComfyUI";
const FRONTEND_ONLY = new Set(["Reroute", "Note", "PrimitiveNode", "MarkdownNote", "SetNode", "GetNode"]);
const GH_PREFIX = "https://github.com/";

async function main() {
  console.log(`Fetching ${SRC_URL} ...`);
  const res = await fetch(SRC_URL);
  if (!res.ok) { console.error(`Fetch failed: ${res.status}`); process.exit(1); }
  const raw = await res.json();

  const repos = [];
  const repoIndex = new Map(); // full URL → index
  const map = {};
  let skippedFrontend = 0, skippedDupe = 0, coreCount = 0;

  function getRepoIdx(url) {
    const short = url.startsWith(GH_PREFIX) ? url.slice(GH_PREFIX.length) : url;
    let idx = repoIndex.get(short);
    if (idx === undefined) { idx = repos.length; repos.push(short); repoIndex.set(short, idx); }
    return idx;
  }

  for (const [repoUrl, val] of Object.entries(raw)) {
    if (!Array.isArray(val) || !Array.isArray(val[0])) continue;
    const classes = val[0];
    const isCore = repoUrl === CORE_URL;

    for (const cls of classes) {
      if (typeof cls !== "string") continue;
      if (FRONTEND_ONLY.has(cls)) { skippedFrontend++; continue; }
      if (map[cls] !== undefined) { skippedDupe++; continue; }
      if (isCore) { map[cls] = -1; coreCount++; }
      else { map[cls] = getRepoIdx(repoUrl); }
    }
  }

  const out = { generated: new Date().toISOString(), source: "extension-node-map@main", repos, map };
  const json = JSON.stringify(out);
  writeFileSync(OUT_PATH, json + "\n");

  const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(0);
  const totalClasses = Object.keys(map).length;
  console.log(`\nWritten: ${OUT_PATH}`);
  console.log(`Size: ${sizeKB} KB`);
  console.log(`Repos: ${repos.length}`);
  console.log(`Entries: ${totalClasses} (CORE: ${coreCount}, custom: ${totalClasses - coreCount})`);
  console.log(`Skipped: frontend_only=${skippedFrontend}, duplicate=${skippedDupe}`);
}

main();
