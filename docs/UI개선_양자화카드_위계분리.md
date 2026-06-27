# Teardown — 양자화 경고 카드 UX 개선 (최소 변경: 줄바꿈 + 굵기 한 단계)

> VS Code Claude Code용. 대상: src/Teardown.jsx
> ⚠ B안(실시간 fetch) 작업 끝나고 커밋된 뒤에 착수. 같은 파일 동시수정 금지.
> ★ 원칙: 전체 룩 밸런스 위해 최소 변경. 색·크기·폰트 전환 금지. 줄바꿈 + 설명 굵기 한 단계만.

---

## 문제
양자화 경고 카드는 `it.action`이 `"파일명: 설명 → 처방"` 통문자열 한 줄.
→ 파일명이 길어 콜론 뒤 설명이 밀려 읽기 어려움. 위계도 없음.

## 목표 (과하지 않게)
1. **파일명 다음 줄바꿈** — 파일명 / 설명 두 줄로.
2. **설명 굵기만 한 단계 낮춤** — 색·크기·폰트는 그대로. 굵기로만 위계.
→ 다른 변화(색 분리·MONO 전환·크기 변경) 일절 안 함. 전체 룩에서 안 튀게.

---

## 구현

### 1. 데이터: action을 file/desc로 분리 (약 648줄)
현재:
```js
items: qw.map((w) => ({
  action: `${w.file}: ${w.quant}은 ${GEN_LABEL[w.gen] || w.gen} GPU에서 ${w.support === false ? "지원 안 됨" : "부분 지원(불안정)"} → ${w.alt}(으)로 교체하세요`,
})),
```
변경:
```js
items: qw.map((w) => ({
  file: w.file,
  desc: `${w.quant}은 ${GEN_LABEL[w.gen] || w.gen} GPU에서 ${w.support === false ? "지원 안 됨" : "부분 지원(불안정)"} → ${w.alt}(으)로 교체하세요`,
})),
```

### 2. 렌더: step.items (약 1353~1356줄)
현재:
```jsx
{step.items.map((it, k) => (
  <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.surfaceHi, borderRadius: 10, padding: "12px 14px" }}>
    <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 3 }} />
    <span style={{ fontSize: 20, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.action}</span></div>))}
```
변경 (file/desc면 2줄, 아니면 기존 action):
```jsx
{step.items.map((it, k) => (
  <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.surfaceHi, borderRadius: 10, padding: "12px 14px" }}>
    <ChevronRight size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 3 }} />
    {it.file ? (
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 20, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.file}</div>
        <div style={{ fontSize: 20, fontWeight: 400, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere", marginTop: 4 }}>{it.desc}</div>
      </div>
    ) : (
      <span style={{ fontSize: 20, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{it.action}</span>
    )}
  </div>))}
```

### 핵심 — 최소 변경 확인
- 파일명·설명 **둘 다 fontSize 20, color C.text 그대로** (기존과 동일).
- 유일한 차이: 설명에 `fontWeight: 400` (파일명은 기존 굵기 유지 → 설명만 한 단계 가늘게).
- 만약 기본 폰트가 이미 400이면 → 파일명을 `fontWeight: 600`으로 올리는 방식으로 한 단계 차이. (둘 중 자연스러운 쪽. 기존 span에 fontWeight 없으면 브라우저 기본=400이므로, 파일명 600 / 설명 400이 한 단계 차이 만듦.)
- 색 분리 금지. MONO 전환 금지. 크기 변경 금지.

## 완료 기준
1. 파일명과 설명이 두 줄로 분리됨(줄바꿈).
2. 설명이 파일명보다 한 단계 가는 굵기. 색·크기는 동일.
3. 다른 step.items는 기존 그대로(회귀 없음).
4. npm run build 에러 없음.

## 작업 후
- 변경 요약 → /end
