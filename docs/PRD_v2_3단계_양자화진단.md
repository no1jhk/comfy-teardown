# Teardown v2 — 3단계 작업 지시서 (양자화↔GPU 진단)

> VS Code Claude Code용. 이 문서를 읽고 그대로 구현. 이 채팅(설계)에서 확정.
> 대상: src/Teardown.jsx (단일 파일). 충돌 방지 위해 이 파일은 VS Code에서만 수정.
> ★ v2의 진짜 핵심 단계. "받았는데 왜 안 돼?"를 푸는 곳.

---

## 목표

사용자 환경(GPU 세대) + 모델 양자화 형식(파일명)을 대조해서, **확정 진단**을 내린다.
예: "RTX 3090(Ampere) + fp8_scaled 모델 → 안 돎. GGUF/bf16로 교체하세요."

이게 LTX2.3에서 사용자가 실제로 막힌 핵심 문제(fp8을 3090에서 돌리려다 실패)를 잡는 단계다.

---

## 데이터 (이미 준비됨)

`src/data/compatibility.json`의 `quant_rules`:
- `formats`: fp8_scaled/fp8_e4m3fn/fp4_mixed/mxfp8 → {ampere:false} / gguf/bf16/fp16/fp32 → {ampere:true}
  - 각 형식에 `alt` (대안: "GGUF 또는 bf16" 등)
- `gpu_generations`: ampere(3090/3080/3060/a100...), ada(4090...), blackwell(5090...)
- `detect_hint`: 파일명 소문자화 후 'fp8'→fp8, 'fp4'→fp4_mixed, 'mxfp8'→mxfp8, '.gguf'/'q4'/'q8'→gguf, 'bf16'→bf16
- `verdict`: "Ampere + (fp8/fp4/mxfp8) → 위험. alt로 교체 권장."

코드에서: `import compat from "./data/compatibility.json"` 이미 되어 있음. `compat.quant_rules`로 접근.

---

## 구현 상세

### 1. 양자화 감지 함수 (컴포넌트 밖, parseComfyLog 근처 ~125줄 뒤에 추가)
```js
// 모델 파일명 → 양자화 형식 감지 (compat.quant_rules.detect_hint 규칙)
function detectQuant(filename) {
  const f = filename.toLowerCase();
  if (f.includes("mxfp8")) return "mxfp8";
  if (f.includes("fp8")) return f.includes("scaled") ? "fp8_scaled" : "fp8_e4m3fn";
  if (f.includes("fp4")) return "fp4_mixed";
  if (f.endsWith(".gguf") || /\bq[0-9]_/.test(f) || f.includes("q4_k") || f.includes("q8_0")) return "gguf";
  if (f.includes("bf16")) return "bf16";
  if (f.includes("fp16")) return "fp16";
  if (f.includes("fp32")) return "fp32";
  return null; // 감지 불가 — 지어내지 않음
}

// GPU 문자열 → 세대 판정 (compat.quant_rules.gpu_generations)
function gpuGeneration(gpuStr) {
  if (!gpuStr) return null;
  const g = gpuStr.toLowerCase().replace(/[^0-9a-z]/g, "");
  const gens = compat.quant_rules.gpu_generations;
  for (const [gen, list] of Object.entries(gens)) {
    for (const model of list) {
      if (g.includes(model.toLowerCase().replace(/[^0-9a-z]/g, ""))) return gen; // "ampere" 등
    }
  }
  return null; // 모르는 GPU
}

// 양자화 × GPU세대 대조 → 위험 모델 배열 반환
// env.gpu 없으면 빈 배열(침묵 — env 미입력 시 회귀 없음)
function quantWarnings(models, gpuStr) {
  const gen = gpuGeneration(gpuStr);
  if (!gen) return [];           // GPU 모름 → 진단 안 함(조용히)
  const out = [];
  for (const m of models) {
    const q = detectQuant(m.file);
    if (!q) continue;
    const rule = compat.quant_rules.formats[q];
    if (!rule) continue;
    const support = rule[gen];   // true / false / "partial"
    if (support === false || support === "partial") {
      out.push({
        file: m.file,
        quant: q,
        gen,                      // "ampere"
        support,                  // false | "partial"
        alt: rule.alt || "GGUF",
      });
    }
  }
  return out;
}
```

### 2. analyze() 또는 buildPrescription()에 연결
- `analyze(norm, env)` 시그니처에 env 추가하거나, buildPrescription 단계에서 env를 받도록.
- **권장**: buildPrescription(r, env)에서 `quantWarnings(r.models, env.gpu)` 호출 → 결과를 처방 맨 앞 단계(0번)로 삽입.
- 호출부(893줄 근처) `buildPrescription(report)` → `buildPrescription(report, env)`로 수정.
- analyze 호출부도 필요 시 env 전달.

### 3. 처방 카드로 출력 (severity high)
quantWarnings 결과가 있으면, Solution 맨 위에 경고 단계 추가:
```
⚠ 양자화 비호환 — 이 GPU에서 안 돌아갈 수 있음
- {file}: {quant} 형식은 {gen} 세대 GPU에서 {지원 안 됨/부분 지원}
  → {alt}(으)로 교체하세요
```
- 색: C.red (high severity). 기존 처방 카드 스타일 재사용.
- gen 한글화: ampere→"Ampere(30xx)", ada→"Ada(40xx)", blackwell→"Blackwell(50xx)".
- support===false → "지원 안 됨", "partial" → "부분 지원(불안정)".

### 4. Markdown 출력에도 반영 (buildMarkdown ~642줄)
- 양자화 경고가 있으면 .md 처방 맨 위에 같은 내용 추가.

---

## 핵심 규칙 (회귀 방지)
- **env.gpu 없으면 quantWarnings는 빈 배열** → 화면에 아무것도 안 뜸. 기존 동작 그대로(회귀 0).
- detectQuant/gpuGeneration은 못 잡으면 null. **지어내지 않음.**
- 기존 buildPrescription 로직은 유지. 양자화 경고는 "맨 앞에 추가"만.

---

## 완료 기준
1. env에서 GPU를 RTX 3090으로 선택/입력하고, fp8 모델이 있는 JSON(예: SCAIL, LTX) 분석 시 → Solution 맨 위에 "양자화 비호환" 빨간 경고 카드가 뜬다.
2. 경고에 파일명·양자화형식·GPU세대·대안(GGUF)이 정확히 표시된다.
3. GGUF만 쓰는 JSON(LipSync) + 3090 → 양자화 경고 안 뜸(GGUF는 Ampere OK).
4. env.gpu 비우면 → 양자화 경고 안 뜨고 기존 분석 그대로(회귀 없음).
5. npm run build 에러 없음.

## 테스트 케이스 (집 3090 = Ampere 기준)
- Ideogram4 (fp8_scaled ×5) + 3090 → 5개 경고
- SCAIL (fp8_scaled) + 3090 → 경고
- LTX VRAM (fp8+fp4 혼재) + 3090 → 경고 (단 GGUF 대안 있음 안내)
- LipSync (GGUF만) + 3090 → 경고 없음 ✓
- 아무 JSON + GPU 미선택 → 경고 없음 ✓

## 작업 후
- 변경 요약 보고 (함수/연결지점/UI).
- /end로 기록 + 커밋.
