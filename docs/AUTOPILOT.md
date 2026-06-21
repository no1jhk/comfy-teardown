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

### A. 에러 로그 진단 룰 확장  ← 다음 우선순위
현재 `analyzeLog()`가 5패턴(ModuleNotFound·flash_attn·CUDA OOM·torch/cuda·가중치)만 처리.
아래 패턴 추가 (각 패턴은 {key, sev, title, cause, fixes[], command?} 객체로):
- [ ] `xformers` 미설치/버전불일치 (flash_attn과 유사, sdpa 대체 안내)
- [ ] `numpy` 2.x ABI 충돌 (`numpy.dtype size changed` / `_ARRAY_API not found`) → `pip install "numpy<2"` 안내
- [ ] `AttributeError` + 노드명 패턴 → 노드팩 버전 불일치 가능성 안내
- [ ] `Sizes of tensors must match` / `mat1 and mat2 shapes` → 모델·입력 해상도 불일치
- [ ] `Cannot find reference` / 노드 미등록 (`When loading the graph … was not found`) → 미설치 pack 연결, report.packs와 교차
- [ ] HTTP/HF 다운로드 실패(`401`/`403`/`Repository Not Found`) → HF 토큰·gated repo 안내
- 완료 기준: 각 패턴별 샘플 로그로 진단 카드가 떠야 함. report 컨텍스트(노드명·pack) 결합 우선.

### B. 버전 표기 구분 (semver vs commit hash)
- [ ] `Findings 2 패키지·버전`에서 `ver`가 40자 hex면 "commit", `\d+\.\d+` 패턴이면 "release"로 작은 뱃지 구분.
- [ ] 같은 pack에 release+commit 섞이면 "재현 시 해당 커밋 checkout 필요" 힌트 1줄.
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

### F. 배포 (사용자 GO 사인 필요 — 무인 실행 금지)
> ⚠ 이 섹션은 **사용자가 명시적으로 "배포해"라고 할 때만**. AUTOPILOT 자동 진행 대상 아님.
- [ ] `git init` (이미 됐으면 skip) → `.gitignore` 확인(node_modules 제외)
- [ ] GitHub `no1jhk/comfy-teardown` 푸시
- [ ] Vercel 연결 (teamId: team_4cG5stwLzvnuWKCq6D0e7q8P), 빌드 `vite build`, 배포
- [ ] HERO_BG 핫링크가 배포 환경에서 뜨는지 확인. 깨지면 `src/assets/`로 로컬화.

---

## 4. 막혔을 때
- 빌드 에러: 마지막 작업 롤백 → HISTORY에 "blocked: …" 기록 → 멈춤.
- 스코프 모호: PRD 기준 판단, 그래도 모호하면 멈추고 질문.
- 외부 의존(폰트·API 키·배포 권한): 사용자 입력 필요 → 멈추고 명시적으로 요청.

## 5. 세션 종료 시
- [ ] `docs/HISTORY.md` 최상단에 그날 작업 요약(한 일 / 결정 / 다음 할 일) 추가
- [ ] 커밋되지 않은 변경 없는지 `git status` 확인
