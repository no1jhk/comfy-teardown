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
    last_node_id: 6, last_link_id: 2, version: 0.4, groups: [], links: [[1, 1, 0, 2, 0, "LATENT"], [2, 5, 0, 3, 0, "MODEL"]], // 링크2: bypass 노드5 → 활성 노드3 = 끊김 경고(⚠) 유발
    nodes: [
      { id: 1, type: "CheckpointLoaderSimple", pos: [0, 0], size: [300, 100], flags: {}, order: 0, mode: 0, widgets_values: ["model.safetensors"], inputs: [], outputs: [{ name: "MODEL", type: "MODEL", links: [] }] },
      { id: 2, type: "KSampler", pos: [400, 0], size: [300, 300], flags: {}, order: 1, mode: 0, widgets_values: [123, "randomize", 20, 8, "euler", "normal", 1], inputs: [], outputs: [] },
      { id: 3, type: "SaveImage", pos: [800, 0], size: [300, 300], flags: {}, order: 2, mode: 0, widgets_values: [], inputs: [], outputs: [] },
      { id: 4, type: "MarkdownNote", pos: [0, 400], size: [400, 200], flags: {}, order: 3, mode: 0, widgets_values: ["## VAE\n[vae_a.safetensors](https://huggingface.co/org/repoA/blob/main/vae.safetensors)\n## Text Encoder\n[clip_b.safetensors](https://huggingface.co/org/repoB/blob/main/clip.safetensors)\n## Extra\n[extension guide](https://github.com/org/ext)"] },
      { id: 5, type: "LoraLoaderModelOnly", pos: [400, 400], size: [300, 100], flags: {}, order: 4, mode: 4, widgets_values: ["lora.safetensors", 1.0], inputs: [], outputs: [] }, // mode 4 = 우회(비활성) → 4 비활성 노드 섹션 검증
      { id: 6, type: "FakeCustomNodeForSmoke", pos: [800, 400], size: [300, 100], flags: {}, order: 5, mode: 0, widgets_values: [], properties: { cnr_id: "comfyui-fake-smoke-pack" }, inputs: [], outputs: [] }, // 미매핑 커스텀 노드 → 2 노드 상세 섹션 검증
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
        // IA 재편(정정 문법): "자세한 진단"을 열면 Nodes/Models/Bypassed 세 섹션이 "고정 헤더(SectionTitle·토글 없음) + 라운드박스 안 번호 행(+/- 토글)"으로 렌더되고, 옛 섹션명("Node Reference"·"Install Script")은 사라졌는지 확인.
        const root = w.document.getElementById("root");
        const dt = [...w.document.querySelectorAll("span")].find((s) => s.textContent === "자세한 진단 보기");
        if (dt) { dt.dispatchEvent(new w.Event("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 200)); }
        const detailHtml = root.innerHTML;
        for (const [label, present] of [["Node Reference", false], ["Install Script", false]]) {
          const has = detailHtml.includes(label);
          if (has === present) console.log(`  ✅ 자세한 진단 · ${label} 부재`);
          else { console.log(`  ❌ 자세한 진단 · ${label} 잔존(부재해야 함)`); fail++; }
        }
        for (const t of ["Nodes", "Models", "Bypassed"]) {
          const h = [...root.querySelectorAll("h2")].find((x) => x.textContent === t);
          if (!h) { console.log(`  ❌ 자세한 진단 · ${t} 섹션 헤더(h2) 미렌더`); fail++; continue; }
          const headerToggle = h.parentElement?.querySelector('button[aria-label="펼치기/접기"]'); // 헤더 컨테이너엔 토글이 없어야(고정 헤더)
          const box = h.parentElement?.nextElementSibling;                                          // 헤더 다음 형제 = 라운드박스
          const rowToggle = box?.querySelector('button[aria-label="펼치기/접기"]');                  // 박스 안 번호 행엔 토글이 있어야
          if (!headerToggle && rowToggle) console.log(`  ✅ ${t} · 고정 헤더(토글 0) + 박스 안 번호 행 +/- 토글`);
          else { console.log(`  ❌ ${t} · headerToggle=${!!headerToggle} boxRowToggle=${!!rowToggle}(고정 헤더+행 토글이어야)`); fail++; }
        }
        // 4(4차): 비활성 단일화 — Bypassed 행 펼침 시 끊김 경고(⚠), 전체 현황 펼침 시 집계 1줄(상세는 Bypassed)만·2열 목록(td-col2) 부재.
        const clickToggleNear = (text) => { const el = [...root.querySelectorAll("div,span")].find((d) => d.textContent === text); let h = el; for (let i = 0; i < 6 && h; i++) { if (h.querySelector?.('button[aria-label="펼치기/접기"]')) break; h = h.parentElement; } const b = h?.querySelector?.('button[aria-label="펼치기/접기"]'); if (b) b.dispatchEvent(new w.Event("click", { bubbles: true })); };
        clickToggleNear("비활성 노드 목록"); await new Promise((r) => setTimeout(r, 150));
        clickToggleNear("전체 현황"); await new Promise((r) => setTimeout(r, 150));
        const invHtml = root.innerHTML;
        if (/연결 경로 중간에 있습니다/.test(invHtml)) console.log("  ✅ Bypassed 행 끊김 경고(⚠) 존재");
        else { console.log("  ❌ Bypassed 끊김 경고 미렌더(bypass→활성 링크 케이스)"); fail++; }
        if (invHtml.includes("상세는") && /비활성 노드 \d+개/.test(invHtml)) console.log("  ✅ 전체 현황 집계 1줄(비활성 N개 · 상세는 Bypassed 링크)");
        else { console.log("  ❌ 전체 현황 집계 1줄 미렌더(상세는/비활성 N개)"); fail++; }
        if (!/td-col2/.test(invHtml)) console.log("  ✅ 전체 현황 2열 목록(td-col2) 부재 — 상세 목록 Bypassed 단일화");
        else { console.log("  ❌ td-col2 잔존(상세 목록 미단일화)"); fail++; }
      }
    }
  } catch (e) { console.log(`  ❌ 파일 투입 시뮬 크래시: ${e && e.name}: ${e && e.message}`); fail++; }
  finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } process.removeListener("uncaughtException", onErr); process.removeListener("unhandledRejection", onErr); }
}

// ── D. 감사 대응 렌더 경로: promoted+대체보유(altHeld) 재선택 안내·배너 금지 + Log path 대안 (커밋 dbd6a2f) ──
{
  const { JSDOM, VirtualConsole } = await import("jsdom");
  let caught = null;
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => { caught = (e && e.detail) || e; });
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, { url: "http://localhost/", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () {};
  try { Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }); } catch { /* noop */ }
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.window = w; globalThis.document = w.document; globalThis.location = w.location;
  globalThis.localStorage = w.localStorage; globalThis.matchMedia = w.matchMedia;
  globalThis.FileReader = w.FileReader; globalThis.File = w.File; globalThis.Blob = w.Blob;
  globalThis.Event = w.Event; globalThis.Node = w.Node; globalThis.HTMLElement = w.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const onErr = (e) => { caught = e && (e.error || e.reason || e); };
  process.on("uncaughtException", onErr); process.on("unhandledRejection", onErr);
  const setTA = (el, v) => { const s = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const nd = (id, type, file) => ({ id, type, pos: [0, 0], size: [1, 1], flags: {}, order: id, mode: 0, widgets_values: file != null ? [file, "default"] : [], properties: {}, inputs: [], outputs: [] });
  const WF = JSON.stringify({ last_node_id: 9, last_link_id: 0, version: 0.4, groups: [], links: [], nodes: [nd(1, "UNETLoader", "z_image_turbo_fp8_e4m3fn.safetensors"), nd(9, "SaveImage", null)] });
  let tmp;
  try {
    tmp = await bundleEntry(`import React from "react"; import { createRoot } from "react-dom/client"; import Teardown from "./src/Teardown.jsx"; createRoot(document.getElementById("root")).render(React.createElement(Teardown)); export const ok = true;`, ".smoke-audit.mjs");
    await import("file://" + tmp);
    await new Promise((r) => setTimeout(r, 60));
    const root = w.document.getElementById("root");
    const input = w.document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [new w.File([WF], "z.json", { type: "application/json" })], configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    if (caught) throw caught;
    const envT = [...root.querySelectorAll('button[aria-label="펼치기/접기"]')].find((b) => { let p = b; for (let i = 0; i < 5 && p; i++) { if (/내 환경 정보/.test(p.textContent)) return true; p = p.parentElement; } return false; });
    if (envT) envT.dispatchEvent(new w.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    const logTA = [...root.querySelectorAll("textarea")].find((t) => /ComfyUI 시작 콘솔 로그/.test(t.placeholder || ""));
    if (logTA) setTA(logTA, "** Log path: C:\\Users\\me\\ComfyUI\\user\\comfyui.log\nStarting server");
    await new Promise((r) => setTimeout(r, 120));
    if (/로그 파일로 대신하기/.test(root.textContent) && /comfyui\.log/.test(root.textContent)) console.log("  ✅ Log path 로그 → '로그 파일로 대신하기' 실경로 렌더");
    else { console.log("  ❌ Log path 대안 블록 미렌더"); fail++; }
    const altBtn = [...root.querySelectorAll("button")].find((b) => /다른 방법으로 입력/.test(b.textContent));
    if (altBtn) altBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    const scanTA = [...root.querySelectorAll("textarea")].find((t) => /실행 결과 전체를 여기에 붙여넣어/.test(t.placeholder || ""));
    if (scanTA) setTA(scanTA, "diffusion_models\\z_image_turbo_bf16.safetensors\t12000000000");
    await new Promise((r) => setTimeout(r, 150));
    if (caught) throw caught;
    const txt = root.textContent.replace(/\s+/g, " ");
    if (/이미 있음 · 선택: UNETLoader에서 z_image_turbo_bf16\.safetensors으로 바꿔 주세요/.test(txt)) console.log("  ✅ altHeld 재선택 안내(활성) 렌더");
    else { console.log("  ❌ altHeld 재선택 안내 미렌더"); fail++; }
    if (!/구조상 실행 준비 완료/.test(txt) && !/필요한 모델을 모두 가지고 있습니다/.test(txt)) console.log("  ✅ 대체 보유 시 '실행 준비 완료' 오배너 금지");
    else { console.log("  ❌ 재선택 대기인데 실행 준비 완료 오배너"); fail++; }
    if (![...root.querySelectorAll("a")].some((a) => /z_image_turbo_bf16/.test(a.href))) console.log("  ✅ altHeld → 처방 다운로드 억제(Solution 행)");
    else { console.log("  ❌ altHeld인데 처방 다운로드 링크 잔존"); fail++; }
    // 수리2(재감사) 렌더: altHeld 행 verb "선택"(받기 아님) + "넣기:" 억제
    const gridRow = [...root.querySelectorAll("div")].find((d) => d.style.display === "grid" && /z_image_turbo_bf16\.safetensors/.test(d.textContent) && /이미 있음 · 선택/.test(d.textContent));
    if (gridRow?.children?.[1]?.textContent === "선택") console.log("  ✅ altHeld 행 verb '선택'(받기 아님)");
    else { console.log(`  ❌ altHeld 행 verb 기대 '선택', 실제 '${gridRow?.children?.[1]?.textContent}'`); fail++; }
    if (!/넣기:/.test(txt)) console.log("  ✅ altHeld 행 '넣기:' 억제");
    else { console.log("  ❌ altHeld 행 '넣기:' 잔존(받으라 언어 충돌)"); fail++; }
  } catch (e) { console.log(`  ❌ 감사 대응 렌더 크래시: ${e && e.name}: ${e && e.message}`); fail++; }
  finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } process.removeListener("uncaughtException", onErr); process.removeListener("unhandledRejection", onErr); }
}

// ── E. Models '한 번에 받기' 표 noDownloadSet 필터 — confirmed+altHeld(자리표시자 alias) 실경로(수리#2 재재감사). fp8=inferred는 confidence 필터가 먼저 배제하므로 confirmed 픽스처로 표 필터를 직접 밟는다. ──
{
  const { JSDOM, VirtualConsole } = await import("jsdom");
  let caught = null;
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => { caught = (e && e.detail) || e; });
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, { url: "http://localhost/", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () {};
  try { Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }); } catch { /* noop */ }
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.window = w; globalThis.document = w.document; globalThis.location = w.location;
  globalThis.localStorage = w.localStorage; globalThis.matchMedia = w.matchMedia;
  globalThis.FileReader = w.FileReader; globalThis.File = w.File; globalThis.Blob = w.Blob;
  globalThis.Event = w.Event; globalThis.Node = w.Node; globalThis.HTMLElement = w.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const onErr = (e) => { caught = e && (e.error || e.reason || e); };
  process.on("uncaughtException", onErr); process.on("unhandledRejection", onErr);
  const setTA = (el, v) => { const s = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const nd = (id, type, file) => ({ id, type, pos: [0, 0], size: [1, 1], flags: {}, order: id, mode: 0, widgets_values: file != null ? [file] : [], properties: {}, inputs: [], outputs: [] });
  // text_실사모델(alias→RV, 보유=altHeld) + qwen_3_4b(confirmed, 미보유=받기). 표는 qwen으로 렌더되고 RV(altHeld)만 noDownloadSet로 제외돼야.
  const WF = JSON.stringify({ last_node_id: 9, last_link_id: 0, version: 0.4, groups: [], links: [], nodes: [nd(1, "CheckpointLoaderSimple", "text_실사모델.safetensors"), { id: 2, type: "CLIPLoader", pos: [0, 0], size: [1, 1], flags: {}, order: 2, mode: 0, widgets_values: ["qwen_3_4b.safetensors"], properties: {}, inputs: [], outputs: [] }, nd(9, "SaveImage", null)] });
  let tmp;
  try {
    tmp = await bundleEntry(`import React from "react"; import { createRoot } from "react-dom/client"; import Teardown from "./src/Teardown.jsx"; createRoot(document.getElementById("root")).render(React.createElement(Teardown)); export const ok = true;`, ".smoke-audit-e.mjs");
    await import("file://" + tmp);
    await new Promise((r) => setTimeout(r, 60));
    const root = w.document.getElementById("root");
    const input = w.document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [new w.File([WF], "ph.json", { type: "application/json" })], configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    if (caught) throw caught;
    const envT = [...root.querySelectorAll('button[aria-label="펼치기/접기"]')].find((b) => { let p = b; for (let i = 0; i < 5 && p; i++) { if (/내 환경 정보/.test(p.textContent)) return true; p = p.parentElement; } return false; });
    if (envT) envT.dispatchEvent(new w.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    const altBtn = [...root.querySelectorAll("button")].find((b) => /다른 방법으로 입력/.test(b.textContent));
    if (altBtn) altBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    const scanTA = [...root.querySelectorAll("textarea")].find((t) => /실행 결과 전체를 여기에 붙여넣어/.test(t.placeholder || ""));
    if (scanTA) setTA(scanTA, "checkpoints\\Realistic_Vision_V5.1_fp16-no-ema.safetensors\t2130000000");
    await new Promise((r) => setTimeout(r, 150));
    // Models '한 번에 받기' 표는 자세한 진단(detailOpen) → 표 NumRow(open.md2) 2단 접이 안. 둘 다 펼쳐야 표 필터를 실제로 밟는다.
    const dt = w.document.getElementById("detail-toggle");
    if (dt) dt.dispatchEvent(new w.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    let title = [...root.querySelectorAll("div")].find((d) => d.textContent === "한 번에 받기");
    for (let cont = title, i = 0; i < 4 && cont; i++, cont = cont.parentElement) { const b = cont.querySelector?.('button[aria-label="펼치기/접기"]'); if (b) { b.dispatchEvent(new w.Event("click", { bubbles: true })); break; } }
    await new Promise((r) => setTimeout(r, 150));
    if (caught) throw caught;
    const txt = root.textContent.replace(/\s+/g, " ");
    if (/받을 파일/.test(txt) && [...root.querySelectorAll("a")].some((a) => /Comfy-Org\/z_image_turbo.*qwen_3_4b/.test(a.href))) console.log("  ✅ Models '한 번에 받기' 표 렌더(미보유 qwen 행 노출)");
    else { console.log("  ❌ Models 표 미렌더/qwen 부재(변이 검증 성립 안 함)"); fail++; }
    // 자리표시자 alias=confidence confirmed → 표 dlEligible의 confidence 필터 통과. altHeld면 noDownloadSet 필터가 표에서 RV 제거. 필터 삭제 시 표에 RV 앵커 재출현(변이 검증됨).
    if (![...root.querySelectorAll("a")].some((a) => /Realistic_Vision_V5\.1_fp16-no-ema/.test(a.href))) console.log("  ✅ confirmed+altHeld → Models 표에서 RV 다운로드 링크 제외(noDownloadSet 필터 실경로)");
    else { console.log("  ❌ confirmed+altHeld인데 Models 표에 RV 링크 잔존(표 필터 누락)"); fail++; }
    if (/이미 있음 · 선택: CheckpointLoaderSimple에서/.test(txt)) console.log("  ✅ confirmed alias altHeld 처방 재선택 안내(활성)");
    else { console.log("  ❌ confirmed alias altHeld 재선택 안내 미렌더"); fail++; }
  } catch (e) { console.log(`  ❌ Models 표 필터 렌더 크래시: ${e && e.name}: ${e && e.message}`); fail++; }
  finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } process.removeListener("uncaughtException", onErr); process.removeListener("unhandledRejection", onErr); }
}

console.log(fail === 0 ? "✅ 렌더 스모크 통과" : `❌ 렌더 스모크 ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
