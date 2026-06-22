# HISTORY.md — Teardown 작업 이력

> 날짜별 작업 로그(최신이 위). 그날 한 일 / 결정 / 다음 할 일.
> CLAUDE.md(안 변하는 컨텍스트)와 분리해, 변하는 기록만 여기 쌓는다.
> 큰 "왜"는 맨 아래 `## Decisions (ADR)`에 짧게.

---

## 2026-06-22 (UI 마감 + AI/검색 레이어 + 방향 재정립 ★중요 세션)
**한 일 — UI/UX 마감**
- 간격·위계 통일: 섹션 제목(SectionTitle) 32 유지, 블록 제목(BlockHead+Solution) 28→25→**23pt**로 낮춰 섹션 제목과 위계 분리. Solution/Findings/Inventory 섹션 간격 64→44. 블록 펼침 하단 40→36.
- Diagnose 박스: 스트로크 제거 + Summary 작은 박스색(#28222E)으로 통일.
- 로딩 아이콘 ScanSearch(360 회전) → **Loader2**(일반 원형 로딩) 3곳 교체. AI 버튼 idle 아이콘 제거.
- 라벨: "LLM용 브리핑 복사"→"LLM 분석 프롬프트", "에러 로그 붙여넣기(선택)"→"에러 로그". Diagnose 애매한 sub문구 삭제. Summary headline 화면 삭제(.md엔 유지). 헤더 카피 교체+16.5pt.

**한 일 — 비용 가드 (★ 배포 핵심)**
- AI 버튼을 `{AI_KEY && ...}`로 감쌈 → 배포본(키 없음)엔 **DOM에서 아예 사라짐**. 타인이 써도 비용 0. 안내문도 키 유무로 분기.
- 일일 호출 제한(AI_DAILY_LIMIT=20, localStorage) 보험.
- 브리핑 복사 액션 피드백: 처리 중 딤+스피너 → 완료 토스트("구조 분석 + 에러 N줄 · 총 X자 복사됨", 이미지는 텍스트에 안 담긴다고 정직하게 안내).

**한 일 — 한글 폰트 버그**
- 윈도우에서 한글 전부 깨짐 → 원인: @import가 Inter/Space Grotesk만 불러오고 한글 폰트 누락(맥은 시스템 폴백으로 가려졌음). **Noto Sans KR 웹폰트 @import 추가**로 해결. 윈도우에서 정상 확인.

**한 일 — 레벨1: 모르는 노드 자동 조사 (web_search)**
- `researchNode()` 추가: 출처 미상 노드를 web_search 도구(web_search_20250305)로 조사 → {found, repo, installNote, confidence}. 로컬(키 있음)에서만. 배포본 영향 0(비용 가드 동일 원리).
- UI: 출처 미상 노드 옆 "이 노드 검색" 버튼 → 결과 `repo · 검색됨`(보라) + **설치 메모**(비개발자용 주의사항).
- **실증(Bernini Wan2.2 워크플로)**: SetNode/GetNode → kijai/ComfyUI-KJNodes 정확히 찾음 + 설치 메모 출력 ✅. 범용성도 통과(Trellis2 특화 룰 안 튀어나옴).

**결정 (★ 방향 재정립 — 오늘의 핵심)**
- **"노드 찾기·설치"로 Manager와 경쟁하면 진다**(겹침). "단발 에러"는 LLM 캡처가 더 빠르다. → 이 두 곳에서 경쟁 금지.
- **진짜 자리 3개**: ① 좁고 깊은 niche(헤비 5종 파이프라인, LLM도 헤맴) ② LLM을 대체말고 먹여주기(최고의 디버그 브리핑 생성기) ③ 설치 메모(Manager에 없는 비개발자 주의사항).
- **시장가치=약함**(시장 작고 대체재 강함, 유료 비추) / **포트폴리오 가치=강함**(이미 합격선). 목표가 취업이니 포트폴리오 기준으로 **이미 성공**.
- 결론: Teardown은 **포트폴리오로 박제**가 1순위. 더 키울 거면 기능 추가가 아니라 (a)niche 깊이 또는 (b)서사/README.
- 상세: **docs/HEAVY_PIPELINE_RULES.md** 신설(환경/설치/실행/에러 룰 + §7 범용성 + §8 축적원칙 + §9 차별화 + §10 피칭).

**서사(포트폴리오용) — 3막 구조 합의**
- 1막 고통(flash_attn/Trellis2, ChatGPT·Claude·Grok 수십 번) → 2막 통찰("병목은 AI 답이 아니라 컨텍스트 조립") → 3막 제작+냉정한 한계 인정("단발은 캡처가 빠름, 이 도구 자리는 좁고 깊은 곳").
- 핵심 피칭: **"디버깅 병목은 AI의 답이 아니라, AI에게 줄 컨텍스트의 조립이었다. 그래서 그 조립을 자동화했다."**

**다음 할 일 (다음 세션 시작점)**
- ★ **"이걸 객관적으로 더 고도화할 가치가 있는지"부터 고민하고 시작** (오늘 결론: 포트폴리오는 이미 충분 / 실사용 고도화는 niche 깊이로만 의미 있음 / ROI는 잡 직결 프로젝트가 더 높을 수 있음).
- (보류) 레벨1 2번째 조각: 검색 결과를 정적 DB(REPO_BY_CNR)에 저장하는 "DB에 저장" 버튼(큐레이션). 방향 확정 후에만.
- (보류) 폰트 수정분 외 배포: 오늘 한글 폰트 픽스는 push 필요 시 진행.
- (대안) 서사 README 작성 — Teardown 포트폴리오 박제의 마지막 작업.


**한 일**
- Error Diagnosis 박스를 아코디언화: 빨간 박스 전체를 +/− 토글(색 C.red, size 26). 첫 번째 열림·나머지 닫힘, 1개면 열림. 닫힘 시 헤더 위아래 여백 20으로 맞춰 딱지·제목·+ 세로중앙.
- CRITICAL 딱지 상하 패딩 +3 ("3px 9px"→"6px 9px"). fixes 텍스트 Solution과 동일(20/C.text). Solution 펼친 step 하단 여백 60→55.
- **docs/PRD_v1.1.md 작성** — AI 진단 레이어 전체 설계.

**결정 (v1.1 방향)**
- v1.0은 "진단까지" 완성. v1.1 = LLM 레이어로 "실행 가능한 처방까지". 효용 기준선: "개발자 의도처럼 설치 바로 밑까지".
- 세 효용: A(에러→LLM 맥락 진단, 임의 에러), B(추정→확정, 모델·repo 웹검색), C(설치 스크립트 .sh/.bat 생성 ★핵심).
- PRD §7 v4(맞춤 설치 스크립트)가 원래 비전 — v1.1로 당김. 데모 서사 "개발자가 배치까지 줬지만 flash_attn에서 막힘"과 정합.
- 신뢰 설계: web_search 실재 URL만·출처 표기·확신 없으면 "확인 필요" 유지·룰 우선 LLM 보강. ("BUILT, NOT JUST GENERATED")
- 구조: 아티팩트 내 Claude API 직접 호출로 효용 먼저 입증 → 이후 Vercel 프록시로 배포 전환. v1.0 report 객체 그대로 LLM 컨텍스트로 재사용.

**다음 할 일**
- 효용 A부터 아티팩트 버전 프로토타입(report + 에러로그 → 구조화 진단). v1.0 코드 안 건드리고 AI 레이어 별도.
- (대기) 누적 UI 수정분 재배포 — "배포해" 시.
- 컴포넌트 추출 리팩터링(AUTOPILOT §R)이 v1.1 UI 통합 전에 되면 좋음.

## 2026-06-21 (배포 완료 + 박스 일관성 + 리팩터링 계획)
**한 일**
- ✅ 첫 배포 완료: GitHub no1jhk/comfy-teardown 푸시(16파일/3196줄) → Vercel 자동 배포. 라이브 https://comfy-teardown.vercel.app/ 정상 동작.
- ✅ HERO_BG 핫링크가 배포 환경에서도 안 깨짐 확인(로컬화 불필요).
- Error Diagnosis 박스를 Solution 박스와 완전 동일하게: ① fixes 항목에 padding "14px 0" + 2번째부터 borderTop 구분선, ② 박스 자체 padding "18px 20px"→"18px 34px" + radius 14→18 (콘텐츠↔스트로크 여백 확보).
- AUTOPILOT.md 정리: 완료된 A(룰 11패턴)·B(버전표기)·F(배포) 체크 처리. **새 섹션 R(컴포넌트 추출 리팩터링)을 최상단 우선순위로 추가**.

**결정**
- 지금이 리팩터링 적기 — MVP 검증+배포 완료로 디자인이 안정됨. 반복 인라인 스타일(박스·행·불릿·스텝)을 Card/Row/BulletList/StepRow로 추출해 디자인 왕복 제거.
- 리팩터링은 **순수 리팩터링**(화면 1px도 불변)으로 Claude Code에게 위임 — AUTOPILOT.md 섹션 R에 대상·원칙·완료기준 명시.

**다음 할 일**
- (대기) 누적 수정분 재배포 — 사용자 "배포해" 시 git push.
- Claude Code로 섹션 R(컴포넌트 추출) 백그라운드 실행.
- 반응형 점검(360/768/1080).

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
- **v1.1을 "설치 바로 밑까지"로 정의**: v1.0의 "추정·검색링크"는 정직하지만 효용 한계. v1.1 LLM 레이어로 확정·실행가능 처방까지. 단 할루시네이션 방지 위해 web_search 실재 확인·정직한 "확인 필요" 유지가 핵심(억지 확정 금지). 상세 docs/PRD_v1.1.md.
