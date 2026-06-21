# AUTOPILOT.md — Teardown 무인 작업 지시서

> 이 문서는 **Claude Code(CLI)가 사람 개입 최소화로 작업을 이어가기 위한 실행 지시서**다.
> 사용법(트리거): 터미널에서 프로젝트 루트로 이동 후
> `claude` 실행 → "docs/AUTOPILOT.md를 읽고 위에서부터 미완료 작업을 순서대로 진행해.
> 각 작업 단위로 커밋하고, 막히면 멈추고 질문해." 라고 지시.
>
> 원칙: **PRD(docs/PRD.md)와 CLAUDE.md를 먼저 읽는다.** 스코프 밖이면 손대지 말고 백로그로 남긴다.

---

## 0. 작업 전 필수 체크 (매번)
- [ ] `docs/PRD.md` §6(안 하는 것), §7(로드맵) 확인 — 스코프 위반 금지
- [ ] `CLAUDE.md` 작업 원칙 확인 (두괄식/개조식, 코드·커밋 영어, "추정" 표기 의무)
- [ ] `npm run dev`로 로컬 기동 확인 (localhost:5173)
- [ ] 작업 시작 전 현재 `src/Teardown.jsx` 전체 1회 통독

## 1. 작업 규칙 (HARD RULES)
- **한 작업 = 한 커밋.** 커밋 메시지 영어, 형식: `feat: …` / `fix: …` / `refactor: …` / `style: …` / `docs: …`
- **빌드 검증 필수.** 각 작업 후 `npm run build` (esbuild/vite)로 신택스·번들 에러 없는지 확인. 깨지면 **그 작업 롤백 후 멈춤**.
- **디자인 토큰 고정.** 색은 `C` 객체만 사용(하드코딩 금지). 폰트 최소 12px(푸터 예외). `wordBreak:"break-all"` 절대 금지, 토큰만 `overflowWrap:"anywhere"`.
- **"추정"은 화면·코드·MD에서 추정으로 표기.** 자동 해결 약속 금지.
- **IP 분리.** GitHub `no1jhk` 개인 자산. 회사 계정·자원과 섞지 않음.
- **불확실하면 멈추고 질문.** 추측으로 큰 구조 변경 금지.

## 2. 완료 정의 (Definition of Done)
한 작업이 "done"이려면: ① 기능 동작 ② `npm run build` 통과 ③ 디자인 토큰·폰트 규칙 준수
④ 커밋 완료 ⑤ `docs/HISTORY.md` 최상단에 1줄 기록.

---

## 3. 백로그 (위에서부터 우선순위 순. 완료 시 [x] 체크 + HISTORY 기록)

### R. 컴포넌트 추출 리팩터링  ← 다음 우선순위 (디자인 안정 후 착수)
> **목적:** 현재 `Teardown.jsx`(900줄 단일 파일)는 같은 시각 요소가 여러 곳에 인라인 스타일로 중복돼 있다.
> 그래서 한 곳(예: Solution 박스 padding)을 고치면 닮은 다른 곳(Error 박스)을 사람이 손으로 따라 맞춰야 한다.
> 이 왕복을 없애기 위해 **반복되는 시각 패턴을 재사용 컴포넌트로 추출**한다.
>
> **⚠ 절대 원칙 — 이건 순수 리팩터링이다. 화면 결과가 1px도 바뀌면 안 된다.**
> - 추출 전후로 `npm run dev` 화면(샘플 워크플로 기준)이 픽셀 단위로 동일해야 함.
> - 색·간격·폰트 크기 등 모든 수치는 **현재 값 그대로** 컴포넌트 props 기본값으로 옮긴다. 개선·정리 욕심 금지.
> - 의심되면 멈추고 질문. 한 컴포넌트 추출 = 한 커밋 = `npm run build` 통과 확인.

추출 대상 (위에서부터 하나씩, 각각 별도 커밋):

- [ ] **`<Card>`** — 굵은 컬러 스트로크 + 라운드 + 안쪽 여백 + 글로우 박스.
  - 현재 중복처: Solution 박스(`border 1.5px C.point`, `borderRadius 18`, `padding "18px 34px"`, `boxShadow 0 0 0 4px rgba(244,255,117,0.06)`), Error Diagnosis 박스(동일 구조에 색만 `C.red`).
  - props: `accent`(스트로크·글로우 색, 기본 `C.point`), `children`. padding/radius/글로우는 두 박스가 **이미 동일**하므로 고정값으로 내재화.
  - 완료 기준: Solution=`<Card accent={C.point}>`, Error=`<Card accent={C.red}>`로 치환했는데 화면 동일.

- [ ] **`<StepRow>`** — 노란 동그라미 숫자(30px) + 텍스트, 위아래 `padding "14px 0"` 또는 `"20px 0"`, 2번째부터 `borderTop` 구분선.
  - 현재 중복처: Solution step 헤더, Error Diagnosis fixes 항목. 둘 다 "동그라미 번호 + 내용 + 항목 구분선" 구조.
  - props: `num`, `children`, `first`(첫 항목이면 borderTop 없음), `pad`(기본 "14px 0").
  - 주의: Solution step은 아코디언 토글이 붙고 StepRow는 단순 나열 — **공통은 '번호원 + 구분선 행'까지만** 추출. 토글 로직은 Solution에 남겨둔다. 무리하게 합치지 말 것.

- [ ] **`<BulletList>` / `<Bullet>`** — `-` 마커(green) + 텍스트, `gap:0` + `lineHeight 1.6`으로 행간만 붙인 개조식 리스트.
  - 현재 중복처: Findings 2의 점버전 설명 + 한저장소 안내 묶음(`paddingLeft 24` 들여쓰기, `display:flex gap:7`, `- ` 마커 `C.green`).
  - props: `<Bullet>`은 `children`. 컨테이너 `<BulletList indent>` 옵션으로 `paddingLeft` 제어.
  - 완료 기준: 마커·행간·들여쓰기 그대로. **gap은 0 유지**(문단 간격 생기면 실패).

- [ ] **`<Row>`** — 좌(아이콘+식별자) / 우(메타) 양쪽정렬 + 2번째부터 `borderTop` 구분선의 목록 행.
  - 현재 중복처: Findings 1(이식위험), Findings 2(패키지), Findings 3(출처추정), Inventory 2(비활성노드) — 4곳이 거의 같은 "ChevronRight + MONO 식별자 … 우측 메타" 구조.
  - props: `left`, `right`, `first`, `gapTop`(블록마다 14/16/18로 다름 — 현재 값 그대로 props로).
  - 주의: 각 블록의 `gapTop`·`maxWidth` 등 미세 차이를 **임의로 통일하지 말 것.** 현재 값을 props로 보존. 통일은 별도 작업(사용자 승인 후).

공통 완료 기준(모든 추출):
- 추출 후에도 `analyze()`·`analyzeLog()`·`buildPrescription()` 등 **로직 함수는 일절 안 건드린다.** UI 조각만.
- 컴포넌트는 파일 상단 `/* ---------- UI 조각 ---------- */` 구역(기존 SectionTitle·BlockHead·MetricBox 옆)에 둔다. 새 파일 분리는 이번 스코프 아님(원하면 백로그로).
- 각 추출 커밋 후 `npm run build` 통과 + 샘플 화면 육안 동일 확인. 하나라도 어긋나면 그 커밋 롤백하고 멈춤.

---

### A. 에러 로그 진단 룰 확장  ← 완료
현재 `analyzeLog()`가 11패턴 처리(ModuleNotFound·flash_attn·CUDA OOM·torch/cuda·가중치·xformers·numpy2.x·AttributeError·tensor shape·노드 미등록·HF 권한). **이 섹션 완료됨.**
- [x] `xformers` 미설치/버전불일치 (flash_attn과 유사, sdpa 대체 안내)
- [x] `numpy` 2.x ABI 충돌 (`numpy.dtype size changed` / `_ARRAY_API not found`) → `pip install "numpy<2"` 안내
- [x] `AttributeError` + 노드명 패턴 → 노드팩 버전 불일치 가능성 안내
- [x] `Sizes of tensors must match` / `mat1 and mat2 shapes` → 모델·입력 해상도 불일치
- [x] `Cannot find reference` / 노드 미등록 (`When loading the graph … was not found`) → 미설치 pack 연결, report.packs와 교차
- [x] HTTP/HF 다운로드 실패(`401`/`403`/`Repository Not Found`) → HF 토큰·gated repo 안내

### B. 버전 표기 구분 (semver vs commit hash)  ← 완료
- [x] `Findings 2 패키지·버전`에서 `ver`가 hex면 "commit", `\d+\.\d+` 패턴이면 "release"로 작은 뱃지 구분.
- [x] 같은 pack에 release+commit 섞이면 "재현 시 해당 커밋 checkout 필요" 힌트 1줄.
- 의도: 버전 충돌의 "정체"를 사용자가 해석 가능하게. (a6645…=git 커밋임을 설명)

### C. 폰트 — PP Formula 적용
- [ ] 사용자가 `src/assets/fonts/`에 woff2/otf 제공하면 `@font-face` 추가, DISPLAY 스택 최상단 연결.
- 폰트 파일 없으면 **이 작업 건너뛰고** Space Grotesk 폴백 유지(현 상태). 임의 폰트 다운로드 금지.

### D. 반응형 점검 (모바일/태블릿)
- [ ] Inventory 모델 그리드 `repeat(3,1fr)` → 좁은 화면에서 `auto-fit minmax` 또는 2/1열로.
- [ ] Summary 이슈 행, Findings 패키지 행이 360px 폭에서 깨지지 않는지(겹침·넘침) 확인.
- [ ] 입력 박스 버튼들 wrap 정상 동작 확인.
- 완료 기준: 360 / 768 / 1080px에서 가로 스크롤·요소 겹침 없음.

### E. 결과 저장 확장 (선택)
- [ ] MD 외 JSON 리포트(`report` 객체 그대로) 저장 옵션 — v2 스냅샷의 씨앗.
- PRD §6 위반 아닌지 확인(스냅샷 "저장"은 v2). 단순 export면 OK, "불러오기"는 금지(=v2).

### F. 배포  ← 1차 완료 (2026-06-21). 이후 재배포는 사용자 GO 사인 시.
> ⚠ 재배포(git push → Vercel 자동)는 **사용자가 명시적으로 "배포해"라고 할 때만**. AUTOPILOT 자동 진행 대상 아님.
- [x] `git init` + `.gitignore`(node_modules 제외) + GitHub `no1jhk/comfy-teardown` 푸시 완료.
- [x] Vercel 연결·배포 완료. 라이브: https://comfy-teardown.vercel.app/
- [x] HERO_BG 핫링크 배포 환경에서 정상 렌더 확인(로컬화 불필요).
- [ ] (대기) 누적 수정분 재배포 — 사용자가 "배포해" 할 때 `git add -A && git commit && git push`, Vercel 자동 빌드.

---

## 4. 막혔을 때
- 빌드 에러: 마지막 작업 롤백 → HISTORY에 "blocked: …" 기록 → 멈춤.
- 스코프 모호: PRD 기준 판단, 그래도 모호하면 멈추고 질문.
- 외부 의존(폰트·API 키·배포 권한): 사용자 입력 필요 → 멈추고 명시적으로 요청.

## 5. 세션 종료 시
- [ ] `docs/HISTORY.md` 최상단에 그날 작업 요약(한 일 / 결정 / 다음 할 일) 추가
- [ ] 커밋되지 않은 변경 없는지 `git status` 확인
