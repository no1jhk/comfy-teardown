// 렌더 스모크 테스트 — 2부.
//  A. TDZ 정적 스캔: 모듈 최상위 const가 "뒤에 선언되는" const를 참조하면 실패(이번 크래시의 정확한 원인 클래스).
//     esbuild bundle은 const→var로 낮춰 TDZ를 소멸시키므로 번들 렌더로는 못 잡는다. 프로덕션 vite(rollup)는 const를 유지해
//     브라우저에서 "Cannot access 'X' before initialization"으로 죽는다. 그래서 소스 선언 순서를 직접 검사한다.
//  B. 번들 렌더: 메인 컴포넌트를 실제 마운트(renderToStaticMarkup) — 렌더 시 예외(undefined 접근 등) 0 확인.
import esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..");
let fail = 0;

// ── A. TDZ 정적 스캔 (모듈 최상위 const 선언 순서) ──
{
  const src = fs.readFileSync(path.join(ROOT, "src/Teardown.jsx"), "utf8");
  const lines = src.split("\n");
  // 첫 함수/컴포넌트 전까지의 최상위(들여쓰기 없는) const만 = 토큰/상수 구역. 단일 라인 선언 기준(파생 토큰은 전부 한 줄).
  const firstFn = lines.findIndex((l) => /^(export default function|function |export function )/.test(l));
  const end = firstFn === -1 ? lines.length : firstFn;
  const decls = [];
  for (let i = 0; i < end; i++) {
    const m = lines[i].match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/);
    if (m) decls.push({ name: m[1], rhs: m[2], line: i + 1 });
  }
  const problems = [];
  for (let i = 0; i < decls.length; i++) {
    for (let j = i + 1; j < decls.length; j++) {
      if (new RegExp("\\b" + decls[j].name + "\\b").test(decls[i].rhs)) {
        problems.push(`${decls[i].name}(L${decls[i].line})가 뒤에 선언된 ${decls[j].name}(L${decls[j].line})를 참조 → TDZ`);
      }
    }
  }
  if (problems.length) { for (const p of problems) console.log(`  ❌ TDZ: ${p}`); fail += problems.length; }
  else console.log(`  ✅ TDZ 스캔: 최상위 const ${decls.length}개, 선언-전-참조 0`);
}

// ── B. 번들 렌더 (렌더 예외 0) ──
const noop = () => {};
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = mkStore();
globalThis.matchMedia = () => ({ matches: false, media: "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
globalThis.window = globalThis.window || { location: { search: "", href: "", hostname: "localhost" }, matchMedia: globalThis.matchMedia, addEventListener: noop, removeEventListener: noop, scrollTo: noop, localStorage: globalThis.localStorage, innerHeight: 800, scrollY: 0 };
globalThis.location = globalThis.location || globalThis.window.location;
globalThis.document = globalThis.document || { createElement: () => ({ setAttribute: noop, click: noop, style: {}, appendChild: noop, remove: noop }), getElementById: () => null, querySelector: () => null, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop, removeChild: noop } };
// navigator: Node getter-only 전역. 렌더 시 clipboard는 핸들러(옵셔널 체이닝)에서만 접근 → override 불필요.

const ENTRY = `
import Teardown from "./src/Teardown.jsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
export const html = renderToStaticMarkup(createElement(Teardown));
`;
const tmp = path.join(ROOT, "node_modules", ".smoke-bundle.mjs");
try {
  const out = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "jsx", sourcefile: "smoke-entry.jsx" },
    bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
    define: { "import.meta.env": '{"DEV":false,"PROD":true}' },
    loader: { ".json": "json" }, logLevel: "silent",
  });
  fs.writeFileSync(tmp, out.outputFiles[0].text);
  const mod = await import("file://" + tmp);
  const html = mod.html;
  if (typeof html !== "string" || html.length < 100) { console.log(`  ❌ 렌더 마크업 비정상(len=${html && html.length})`); fail++; }
  else console.log(`  ✅ 번들 렌더 예외 0 · 마크업 ${html.length}자`);
} catch (e) {
  console.log(`  ❌ 번들 렌더 크래시: ${e && e.name}: ${e && e.message}`);
  fail++;
} finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }

console.log(fail === 0 ? "✅ 렌더 스모크 통과" : `❌ 렌더 스모크 ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
