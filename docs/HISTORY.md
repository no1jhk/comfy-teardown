# HISTORY.md — Teardown 작업 이력

> 날짜별 작업 로그(최신이 위). 그날 한 일 / 결정 / 다음 할 일.
> CLAUDE.md(안 변하는 컨텍스트)와 분리해, 변하는 기록만 여기 쌓는다.
> 큰 "왜"는 맨 아래 `## Decisions (ADR)`에 짧게.

---

## 2026-06-21 (실제 워크플로 검증 + 버그 수정)
**한 일**
- 실제 Rig+Anim 워크플로(PixelArtistry, 45노드)로 전체 진단 로직 검증.
- ✅ 출처 추정 14개 전부 repo 매핑 성공(Trellis2 12 + rgthree 1 등), 출처미상 0.
- ✅ comfyui-unirig 5버전(점버전 2 + commit 3) 충돌 정확 탐지, HyMotion 3commit 충돌 탐지.
- ✅ 이식 위험 3종(flash_attn / Windows 경로 / 과거 날짜 fbx) 정확.
- ᴄ 버그 수정: comfy-core가 0.4.0 vs 0.9.2로 "버전 충돌" 오탐 → 내장 코어는 설치 대상이 아니므로 conflict에서 제외(isCore 시 false).
- 비활성 노드 톤 중립화: "단계별로 켜고 끄는 워크플로면 정상" — 이 워크플로는 1·2·3단계 번갈아 실행하는 구조라 bypass가 의도된 설계임.

**다음 할 일**
- Git 푸시(no1jhk) + Vercel 배포. HERO_BG 핫링크 깨지면 로컬화.
- 배포 후 반응형 점검.

**한 일**
- 순번 배지(BlockHead 1·2·3) 완전 원형화(28px, 한자리=원/길면 타원) + 제목과 세로중앙.
- Error Diagnosis fixes를 Solution과 동일 구조로 통일(`>` → 노란 동그라미 숫자 30px, 텍스트 17.5 dim, gap 14).
- 에러로그 버튼: "Error Log 진단하기"로 변경, 아이콘 제거, 가로 calc(50% - 140px) 중앙정렬.
- 점버전 설명 + 한저장소 안내를 한 묶음 `-` 개조식(같은 레벨, 행간 붙임)으로 통합.
- 블록 하단 여백: 닫힘 60→40(펼침 60 유지) — 5블록 일괄.
- 상단 파일·샘플 버튼 간격 20, "샘플로 보기"→"샘플 보기".

**막힌 점**
- sameRepo 안내를 3회에 걸쳐 잘못 분리해 렌더 — 결국 "점버전 츅션 + sameRepo"를 하나의 `-` 리스트 한 컨테이너로 묶어 해결.

**다음 할 일**
- 반응형 점검, 폰트(PP Formula), 배포(GO 사인 후).

**한 일**
- Findings·Inventory 5개 블록 간격을 제목↔내용 60 / 내용↔다음 순번 60으로 통일(이전엔 상단에만 잘못 적용됨). 펼친 내용 div에 paddingBottom으로 하단 명시화.
- CLAUDE.md에 "간격·스타일 일관성 HARD RULE" 세션 추가.
- CLAUDE.md에 "작업 종료 시 기록" HARD RULE 추가(패턴1: task마다 HISTORY 5칸 자동 기록).

**막힌 점**
- 간격 수정 시 Findings만 고쳐 Inventory와 어긋나는 일관성 결함이 있었음 → 5블록 일괄 통일로 해결. 인라인 스타일이라 토큰화가 안 돼 반복 값이 생김 → CLAUDE.md 규칙로 보완.

**다음 할 일**
- 자동 기록 스케줄: Claude Desktop 예약 작업(11:50, git 변화 있을 때만 HISTORY 기록) — 필요 시 설정.
- 반응형 점검, 폰트(PP Formula), 배포(GO 사인 후).

## 2026-06-21 (아침 세션)
**한 일**
- 버전 해시 표기(§3-B): 버전 칩을 release(점 버전) vs commit(16진수 해시) 구분. 해시는 8자+… 축약, commit 라벨 붙임. 해시 존재 시 설명 캐프션 노출.
- 에러 로그 박스: 타이틀 "에러 로그 붙여넣기"로 간결화(·선택 제거), Terminal 아이콘을 Upload와 동일한 44px 라운딩 박스로 통일, placeholder를 "마지막 Traceback 블록" 안내로 교체.
- 심각도 뱃지 영문 대문자(CRITICAL/WARNING/INFO).
- Findings 제목 바로 아래 구분선 제거(블록1 borderTop 제거).
- 색 통일: Inventory 폴더명·Findings1 risk 텍스트를 repo와 같은 색(C.green opacity 0.6)으로.

## 2026-06-21
**한 일**
- 에러 로그 룰 확장(2차): xformers·numpy 2.x ABI·텐서 shape·미등록 노드(report.unmapped 교차)·HF 401/gated·AttributeError 6패턴 추가. analyzeLog 총 11패턴.
- Findings 2: repo 명도 낮춤(opacity 0.6), "버전 충돌" 라벨 좌측 세로중앙 + 버전 칩 우측 줄바꿈, N종 우측 끝 분리.
- Summary 블릿 3.5px. 인벤토리–푸터 간격 120px. 에러 진단 제목 Error Diagnosis(영문).

## 2026-06-21 (이전 세션)
- "Error Diagnosis" 결과 섹션 추가(Summary 위, 실행 실패=최우선). 심각도 뱃지(치명/주의/참고)·해결책 리스트·명령 복사. MD export에도 진단 블록 포함.
- 입력 UX B안 확정: JSON 드롭존(노란 점선 단독, 주인공) → 분석 후에만 에러로그 솔리드 박스 등장(보조 위계). 진단하기 버튼은 아웃라인 CTA(hover 채움).
- 배경 hero 애니메이션: opacity 5↔20%, 위아래 부유 -22px/7.5s.
- Solution 1~4 아코디언(+/−), 1단계 기본 펼침.
- Findings 1(이식위험) `>` prefix·우중단 정렬 / Findings 2(패키지·버전) repo 인라인화, 버전 블록 좌측 이동 + N종 우측 끝(marginLeft auto)로 겹침 해소.
- 결과저장·진단 버튼 hover 노랑 채움(td-outline/td-cta) 통일.
- Summary 이슈 블릿 크기 절반(7→3.5px).
- 푸터: 위 구분선 제거, 안내문 한 줄화, "Built by Joon Hyung Kim · no1jhk.space"를 안내문 바로 아래 붙임(이름 강조 제거).
- docs/AUTOPILOT.md(무인 작업 지시서) 신설.

**결정**
- 에러로그 입력은 분리(B안) — JSON은 필수/드롭, 로그는 선택/텍스트라 성격이 달라 위계로 분리.
- 진단 버튼은 라인 아닌 버튼 유지(트리거 액션), 단 풀폭 노랑채움→아웃라인으로 위계 낮춤.

**다음 할 일**
- 에러 로그 룰 확장(AUTOPILOT §3-A: xformers·numpy 2.x·tensor shape·미등록 노드·HF 401 등)
- 버전 표기 semver vs commit hash 구분 뱃지(§3-B)
- 폰트 PP Formula(파일 받으면), 반응형 점검, 그 후 배포(GO 사인 후)

---

## Decisions (ADR) — 되돌아볼 결정만
- **에러로그를 "진단 영역"으로 본 이유**: flash_attn류는 설치 자동화(개발자 배치)로도 안 풀려 막힘. 설치가 아니라 진단·우회의 문제라서 이 도구의 본령. (PRD 데모 서사와 일치)
- **LLM 안 쓰고 룰 기반 1차 진단**: "컨텍스트 자동 조립 + 알려진 지뢰 사전 경고"가 가치(ChatGPT 래퍼 아님). LLM은 v1.1에서 프록시로.
- **commit hash(40 hex)를 버전 충돌로 잡음**: release 태그가 아닌 git 커밋 설치 = 재현 불안정 신호. 화면엔 release/commit 표기로 사용자가 직접 해석 가능하게 노출(·3-B 완료).
