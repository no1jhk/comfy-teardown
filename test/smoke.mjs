// 렌더 스모크 테스트 — 3부. 빌드 통과가 런타임 정상을 보장하지 않으므로 실제 로드·렌더·상호작용으로 실측한다.
//  A. TDZ 정적 스캔: 모듈 최상위 const가 "뒤에 선언되는" const를 참조하면 실패(모듈 로드 즉시 크래시 = 빈 화면).
//     esbuild bundle은 const→var로 낮춰 TDZ를 소멸시키므로 소스 선언 순서를 직접 검사한다(vite/rollup은 const 유지).
//  B. 랜딩 렌더: 초기 상태(report 없음) renderToStaticMarkup 예외 0.
//  C. 파일 투입 시뮬레이션: jsdom에 마운트 → 파일 input에 워크플로우 JSON 투입 → onFile→run→analyze 경로가
//     예외 없이 결과 상태를 만드는지(제거된 setState 잔존 호출 등 핸들러 크래시 포착). 랜딩 렌더로는 못 잡는 계열.
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..");
let fail = 0;

async function bundleEntry(entry, tmpName) {
  const out = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: "jsx", sourcefile: "smoke-entry.jsx" },
    bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
    define: { "import.meta.env": '{"DEV":false,"PROD":true}' }, loader: { ".json": "json" }, logLevel: "silent",
  });
  const tmp = path.join(ROOT, "node_modules", tmpName);
  fs.writeFileSync(tmp, out.outputFiles[0].text);
  return tmp;
}

// ── A. TDZ 정적 스캔 ──
{
  const src = fs.readFileSync(path.join(ROOT, "src/Teardown.jsx"), "utf8");
  const lines = src.split("\n");
  const firstFn = lines.findIndex((l) => /^(export default function|function |export function )/.test(l));
  const end = firstFn === -1 ? lines.length : firstFn;
  const decls = [];
  for (let i = 0; i < end; i++) { const m = lines[i].match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/); if (m) decls.push({ name: m[1], rhs: m[2], line: i + 1 }); }
  const problems = [];
  for (let i = 0; i < decls.length; i++) for (let j = i + 1; j < decls.length; j++)
    if (new RegExp("\\b" + decls[j].name + "\\b").test(decls[i].rhs)) problems.push(`${decls[i].name}(L${decls[i].line})가 뒤에 선언된 ${decls[j].name}(L${decls[j].line})를 참조 → TDZ`);
  if (problems.length) { for (const p of problems) console.log(`  ❌ TDZ: ${p}`); fail += problems.length; }
  else console.log(`  ✅ TDZ 스캔: 최상위 const ${decls.length}개, 선언-전-참조 0`);
}

// ── B. 랜딩 렌더(renderToStaticMarkup) ──
{
  const noop = () => {};
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  globalThis.localStorage = store();
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  globalThis.window = { location: { search: "", href: "", hostname: "localhost" }, matchMedia: globalThis.matchMedia, addEventListener: noop, removeEventListener: noop, scrollTo: noop, localStorage: globalThis.localStorage, innerHeight: 800, scrollY: 0 };
  globalThis.location = globalThis.window.location;
  globalThis.document = { createElement: () => ({ setAttribute: noop, click: noop, style: {}, appendChild: noop }), getElementById: () => null, querySelector: () => null, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop, removeChild: noop } };
  let tmp;
  try {
    tmp = await bundleEntry(`import Teardown from "./src/Teardown.jsx"; import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server.browser"; export const html = renderToStaticMarkup(createElement(Teardown));`, ".smoke-landing.mjs");
    const { html } = await import("file://" + tmp);
    if (typeof html !== "string" || html.length < 100) { console.log(`  ❌ 랜딩 렌더 마크업 비정상(len=${html && html.length})`); fail++; }
    else console.log(`  ✅ 랜딩 렌더 예외 0 · 마크업 ${html.length}자`);
  } catch (e) { console.log(`  ❌ 랜딩 렌더 크래시: ${e && e.name}: ${e && e.message}`); fail++; }
  finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
}

// ── C. 파일 투입 시뮬레이션(jsdom 마운트 → 파일 input → onFile→run→analyze) ──
{
  const { JSDOM, VirtualConsole } = await import("jsdom");
  let caught = null;
  // jsdomError = jsdom이 실행한 콜백(FileReader.onload 등)에서 던져진 미포착 예외. run()의 크래시가 여기로 온다.
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { caught = (e && e.detail) || e; });
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, { url: "http://localhost/", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // jsdom 전역을 노출(react-dom/client·컴포넌트가 참조). navigator는 getter-only라 재할당 대신 window 것 사용.
  globalThis.window = w; globalThis.document = w.document; globalThis.location = w.location;
  globalThis.localStorage = w.localStorage; globalThis.matchMedia = w.matchMedia;
  globalThis.FileReader = w.FileReader; globalThis.File = w.File; globalThis.Blob = w.Blob;
  globalThis.Event = w.Event; globalThis.Node = w.Node; globalThis.HTMLElement = w.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  const onErr = (e) => { caught = e && (e.error || e.reason || e); };
  process.on("uncaughtException", onErr); process.on("unhandledRejection", onErr);
  w.addEventListener("error", (e) => { caught = e.error || new Error(e.message); });

  // 최소 유효 ComfyUI 워크플로우(자립적 — fixture는 gitignore라 커밋 안 됨). MarkdownNote 3링크로 제작자 링크 표(3) 렌더도 함께 검증.
  const WF = JSON.stringify({
    last_node_id: 5, last_link_id: 1, version: 0.4, groups: [], links: [[1, 1, 0, 2, 0, "LATENT"]],
    nodes: [
      { id: 1, type: "CheckpointLoaderSimple", pos: [0, 0], size: [300, 100], flags: {}, order: 0, mode: 0, widgets_values: ["model.safetensors"], inputs: [], outputs: [{ name: "MODEL", type: "MODEL", links: [] }] },
      { id: 2, type: "KSampler", pos: [400, 0], size: [300, 300], flags: {}, order: 1, mode: 0, widgets_values: [123, "randomize", 20, 8, "euler", "normal", 1], inputs: [], outputs: [] },
      { id: 3, type: "SaveImage", pos: [800, 0], size: [300, 300], flags: {}, order: 2, mode: 0, widgets_values: [], inputs: [], outputs: [] },
      { id: 4, type: "MarkdownNote", pos: [0, 400], size: [400, 200], flags: {}, order: 3, mode: 0, widgets_values: ["## VAE\n[vae_a.safetensors](https://huggingface.co/org/repoA/blob/main/vae.safetensors)\n## Text Encoder\n[clip_b.safetensors](https://huggingface.co/org/repoB/blob/main/clip.safetensors)\n## Extra\n[extension guide](https://github.com/org/ext)"] },
      { id: 5, type: "LoraLoaderModelOnly", pos: [400, 400], size: [300, 100], flags: {}, order: 4, mode: 4, widgets_values: ["lora.safetensors", 1.0], inputs: [], outputs: [] }, // mode 4 = 우회(비활성) → Node Reference #3 섹션 검증
    ],
  });

  let tmp;
  try {
    tmp = await bundleEntry(`import React from "react"; import { createRoot } from "react-dom/client"; import Teardown from "./src/Teardown.jsx"; globalThis.__root = createRoot(document.getElementById("root")); globalThis.__root.render(React.createElement(Teardown)); export const ok = true;`, ".smoke-mount.mjs");
    await import("file://" + tmp); // 마운트(모듈 로드 + 초기 렌더)
    await new Promise((r) => setTimeout(r, 60));
    const input = w.document.querySelector('input[type="file"][accept*="json"]') || w.document.querySelector('input[type="file"]');
    if (!input) { console.log("  ❌ 파일 input 못 찾음(랜딩 미렌더?)"); fail++; }
    else {
      const beforeLen = w.document.getElementById("root").innerHTML.length; // 투입 전(랜딩)
      const file = new w.File([WF], "smoke.json", { type: "application/json" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new w.Event("change", { bubbles: true })); // onFile → FileReader → run(async)
      await new Promise((r) => setTimeout(r, 250)); // FileReader onload + React 재렌더 대기
      const afterHtml = w.document.getElementById("root").innerHTML;
      const afterLen = afterHtml.length;
      // 판정: run()에서 예외(제거된 setState 잔존 호출 등)면 jsdomError 포착. 성공이면 report 세팅 → 결과 존이 렌더돼 root가 유의미하게 커진다(랜딩엔 진단 결과 없음).
      if (caught) { console.log(`  ❌ 파일 투입 크래시: ${(caught.name || "Error")}: ${caught.message || caught}`); fail++; }
      else if (afterLen <= beforeLen + 2000) { console.log(`  ❌ 파일 투입 후 결과 화면 미진입(root ${beforeLen}→${afterLen}자, run/analyze 실패 추정)`); fail++; }
      else {
        console.log(`  ✅ 파일 투입 → analyze → 결과 상태 진입, 예외 0 (root ${beforeLen}→${afterLen}자)`);
        // 3: 제작자 링크 3개 → 3열 표(출처 노드 헤더) 렌더
        if (/출처 노드/.test(afterHtml)) console.log("  ✅ 제작자 링크 3개 → 3열 표 렌더(출처 노드 헤더)");
        else { console.log("  ❌ 제작자 링크 3열 표(출처 노드 헤더) 미렌더"); fail++; }
        // 4: 검색 버튼 URL = 구글 site: 웹 검색(HF models?search 아님)
        if (/google\.com\/search/.test(afterHtml) && !/huggingface\.co\/models\?search/.test(afterHtml)) console.log("  ✅ 검색 버튼 = 구글 site: 웹 검색(HF models?search 0)");
        else { console.log("  ❌ 검색 버튼 URL이 웹 검색 아님(google site: 미검출 또는 HF models?search 잔존)"); fail++; }
        // 소형1: 비활성 노드(mode 4) → Node Reference #3 섹션. Summary·Node Reference는 "자세한 진단"(detailOpen, 기본 닫힘) 안이라 먼저 연다.
        const dt = [...w.document.querySelectorAll("span")].find((s) => s.textContent === "자세한 진단 보기");
        if (dt) { dt.dispatchEvent(new w.Event("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 200)); }
        const detailHtml = w.document.getElementById("root").innerHTML;
        if (/비활성 노드/.test(detailHtml)) console.log("  ✅ 자세한 진단 → 비활성 노드 3번 섹션 렌더");
        else { console.log("  ❌ 비활성 노드 3번 섹션 미렌더(자세한 진단 펼친 뒤)"); fail++; }
      }
    }
  } catch (e) { console.log(`  ❌ 파일 투입 시뮬 크래시: ${e && e.name}: ${e && e.message}`); fail++; }
  finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } process.removeListener("uncaughtException", onErr); process.removeListener("unhandledRejection", onErr); }
}

console.log(fail === 0 ? "✅ 렌더 스모크 통과" : `❌ 렌더 스모크 ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
