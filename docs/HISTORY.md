# HISTORY.md — Teardown 작업 이력

> 날짜별 작업 로그(최신이 위). 그날 한 일 / 결정 / 다음 할 일.
> CLAUDE.md(안 변하는 컨텍스트)와 분리해, 변하는 기록만 여기 쌓는다.
> 큰 "왜"는 맨 아래 `## Decisions (ADR)`에 짧게.

---

## 2026-07-06 (처방전 마감부 — 완료 안내 재작성 · 하단 어두운 존)
**한 일**
- 완료 안내: "다 했으면 → …" 화살표 체인 삭제 → 소제목("완료 후 확인", 15px semibold) + 본문(14px: 재시작·재열기·빨간노드 확인).
- 간격: 완료 안내 ↔ divider 110px(하단 존 paddingTop).
- 하단 영역 존: divider부터 페이지 끝(푸터 포함)까지 살짝 어두운 배경. C.bgDeep #1A1420(bg #201926 대비 약 -3%p). full-bleed(width 100vw + left 50% + marginLeft -50vw), 콘텐츠는 maxWidth 1080 컬럼 재정렬(좌우 20 패딩 유지). footer를 detailOpen 밖·존 안으로 빼 접힘 시에도 노출.

**어떻게**
- 표시층만. divider가 두 존 경계. 카드 배경(surface #2A2333, MetricBox #28222E)은 bgDeep보다 밝아 대비 유지 → 조정 불필요.

**검증**
- npm run build OK(432KB/gzip 119.6). node test/regression.mjs 유지.

**다음 할 일**
- 규칙 1: dev 확인 후 커밋. full-bleed 가로 스크롤/모바일 확인.

## 2026-07-06 (UX 정비 5건 — Inventory를 Findings로 · 모델표 정렬 · 무결성 개조식 · 버튼 라인형)
**한 일**
- 전체 현황(Inventory): 독립 아코디언 → Findings 마지막 BlockHead 항목(fnum 4)으로 이동. 번호원+제목+토글 동일 스타일, 기본 접힘.
- 한 번에 실행 모델표: "받을 파일" 좌측 패딩 제거(표 왼쪽 끝), "다운로드" 우측 정렬(오른쪽 끝). 헤더/셀/gguf행 padding 좌우 0.
- 무결성 확인: 문장 3개 → · 불릿 개조식 통일(13px, 줄간격 동일).
- 버튼 라인형 통일: 인라인 채움형(파일선택·샘플·슬롯표다운로드·install.bat/sh·적립복사) 6곳 → td-outline/td-hf(라인+hover). CSS(td-hf/outline/cta)는 기존 라인형.
- hover 전수 점검: 기본형 준수 확인 + 예외 보고(의미색 상태버튼·보조버튼은 미변경).

**어떻게**
- 표시층만. Inventory를 fnum IIFE 안 BlockHead로. 버튼은 공통 클래스로 통일, 인라인 채움 제거.

**막힌 점 / 예외**
- 의미색 상태버튼(있음/취소=green, 이거 맞았어=amber, 이미 있음=회색)·보조버튼(내보내기/비우기/캡처첨부)은 hover 배경채움 없음 — 노란 기본형과 별개(의미 전달용). 미변경, 정책 확인 대기.

**검증**
- npm run build OK(431.7KB/gzip 119.5). node test/regression.mjs 유지.

**다음 할 일**
- 규칙 1: dev 확인 후 커밋.

## 2026-07-05 (UX 정비 6건 — 적립 관리자화 · 푸터 · diagLine · RNF 평면화 · 버튼폭 · 간격)
**한 일**
- 적립 데이터: 기본 화면에서 제거, ?admin=1일 때만 렌더(isAdmin=URLSearchParams). 문구 재작성(내부 은어 제거): "검증 대기 데이터 N건 (관리자 전용)" + LLM 출처 검토·compatibility.json 병합 안내. 저장 로직 미수정(표시만).
- 푸터: pytorch·cuda 문구 → Diagnose 에러로그 아코디언 내부 상단 캡션(13px)으로 이동. 푸터 = 상단 divider 1px + 크레딧 한 줄(13px 중앙).
- diagLine 재작성: 상태 판정만("현재 상태로는 실행되지 않습니다 — …"), 행동 지시는 Solution 부제 담당(중복 제거). 반말 제거. 처방전/자세히 동일 소스(summary.diagLine).
- RNF 내부 노드 카드: 배경·테두리·라운딩 제거 → 노드명 헤딩+개방형 표 평면. 노드 사이 borderTop+여백(paddingTop 16 + gap 16).
- 버튼 폭: td-hf에 min-width 76 + justify-content center(다운로드/찾기/복사/GitHub 통일).
- 섹션 간격: Summary marginTop 64 → 44로 통일(RNF·한 번에 실행·Findings/Inventory와 동일). Diagnose는 borderTop 2px 별도 영역이라 64 유지.

**어떻게**
- 표시층만. diagLine·문구 단일 소스. isAdmin은 URLSearchParams.

**검증**
- npm run build OK(432KB/gzip 119.5). node test/regression.mjs 유지.

**다음 할 일**
- 규칙 1: dev 확인 후 커밋.

## 2026-07-05 (처방전 헤더 개편 + 항목 단일 박스화 + 푸터 순서 버그)
**한 일**
- [버그 수정] Diagnose/적립 데이터가 footer 뒤에 렌더되던 문제: DOM 순서를 [… → Diagnose → 적립(관리자용) → footer]로 정정. 전수 점검 결과 footer가 report 블록 최하단, 이후 렌더 요소 없음 확인.
- 처방전 헤더: "아래 N개만 하면 됩니다" 제거 → 대제목 "Solution"(SectionTitle 타이포) + 부제 "위에서부터 순서대로 하면 정상 작동합니다 · 총 N개". diagLine(빨강) 위 유지. 자세한 진단 내부 기존 "Solution" → "한 번에 실행 (설치 스크립트)" 개명(중복 방지).
- 체크리스트: 개별 카드 → 단일 라운딩 박스 + 항목 사이 가로 구분선. 행 좌측 번호+제목+폴더/부연, [다운로드]/[찾기] 버튼 우측 끝 정렬.
- "받기" → "다운로드" 전역(처방전·슬롯표·모델표 버튼·컬럼명). "찾기" 유지, 설명 문구도 일관 반영.

**어떻게**
- 표시층만. 항목 렌더를 left/right로 분리해 버튼 우측. 버튼/컬럼 "받기"는 sed 일괄, 제목/설명은 개별.

**검증**
- npm run build OK(432KB/gzip 119.5). node test/regression.mjs 유지.

**다음 할 일**
- 규칙 1: dev 확인 후 커밋(시각 변경).

## 2026-07-05 (디자인 정돈 3건 — 토글 divider · 폰트 12px+ · 표 개방형)
**한 일**
- "자세한 진단 보기" 토글 → 가로 분할선(divider): 양쪽 border-top + 가운데 텍스트/아이콘, 클릭 전체 행.
- 폰트 최소 규칙: 하드코딩 fontSize를 3등급(13 부연 · 14 표셀/버튼/라벨 · 15+ 본문/제목)으로 sed 일괄. 12px 미만 0(이전 55개). 반값(13.5·14.5·15.5·16.5·17.5·18.5·18.75) 정리.
- 표 개방형: 슬롯표(Red Node)·Solution 모델표의 바깥 라운딩·좌우 세로 테두리 제거 → 가로 구분선만. 헤더 배경도 제거.

**어떻게**
- 표시층만(엔진·데이터 미수정). 폰트는 경계 정규식 sed(값별 치환), 백업 후 실행.

**막힌 점 / 한계**
- 값 기반 매핑이라 12·13이던 표셀/버튼/라벨도 13으로 몰림(등급 14 미달). 부연(13)/라벨(14) 구분은 문맥 분류 필요 — 다음.
- 폰트 키움으로 고정폭 표 컬럼(슬롯표 80px "받기" · Solution표 132px) wrap 잠재 → dev 확인 필요(수정 다음).

**검증**
- npm run build OK(432KB/gzip 119.4). node test/regression.mjs 유지.

**다음 할 일**
- 규칙 1: dev 확인 후 커밋. wrap 깨진 곳 · 표셀 14등급 정밀화.

## 2026-07-05 (자세한 진단 내부 정돈 — Red Node를 Solution 룩으로 · Diagnose 아코디언)
**한 일**
- Red Node Fix: Solution과 동일 룩(1.5px point 라운딩 박스 + surfaceHi 서브타이틀 상단). STEP 1/2를 Solution 단계 토큰(번호원 30·제목 23·td-acc +/−)으로 아코디언화(기본 펼침 rn1/rn2). 내부 카드·슬롯표 미수정.
- Diagnose: 에러 로그 블록을 아코디언(헤더 "실행했는데 에러가 나면 — 에러 로그 진단", 기본 접힘). 입력창·캡처·버튼 2개(탭 아님) 그대로.
- 적립 데이터: 맨 아래(footer 뒤)로 이동 + 아코디언 기본 접힘 + 헤더 "(관리자용)" 명시.

**어떻게**
- 표시층만(엔진·데이터 미수정). 기존 Solution 박스·단계 헤더 토큰 재사용(새 스타일 0). open state에 rn1/rn2/errAcc/learnedAcc 추가.

**검증**
- npm run build OK(432KB/gzip 119.5). node test/regression.mjs 전부 유지(엔진 무영향).

**다음 할 일**
- 규칙 1: dev 화면 ✅ 확인 후 커밋(시각 변경이라 선커밋 금지).

## 2026-07-05 (처방전 모드 — 첫 화면을 할 일 체크리스트로)
**한 일**
- Teardown.jsx: 분석 직후 첫 화면을 "처방전"(할 일 체크리스트) 하나로. 기존 Summary/Red Node Fix/Solution/Findings/Diagnose 전체는 "자세한 진단 보기" 토글(기본 닫힘) 뒤로 보존 — 감싸기만, 내부 미수정.
- 처방전 항목 = (a) report.unmapped 노드 설치(CORE 제외, git clone 복사+GitHub) + (b) recipesEnriched 슬롯 평탄화. quantBad는 대체 GGUF "받기", 일반은 "준비"(받기/찾기 재사용). ☐번호 클릭 = 체크 토글(로컬 state).
- diagLine 재사용 + "아래 N개만 하면 됩니다" 끝맺음. 결과 저장(.md) 버튼 Summary→처방전 상단으로 이동. 할 일 0개면 "차단 요소 없음".
- (다듬기) 항목 제목 동사 통일: url 있어 [받기] 버튼이면 "받기", [찾기]면 "준비"(불일치 제거). 자세히 안 Summary의 diagLine 제거(처방전 상단과 중복) → 숫자 카드부터.

**어떻게**
- 새 분석 로직 없이 rxTodos useMemo로 기존 데이터만 순회(표시층). buildPrescription(rx·Solution)은 묶음 처방이라 별개 — 자세히 안에 그대로 유지. C 변수·td-hf 버튼 재사용.

**검증**
- npm run build OK(429KB/gzip 119, +6KB). node test/regression.mjs 기존 4+API 전부 유지(엔진 무영향 확인).

**다음 할 일**
- 규칙 1: 사용자 dev 화면 ✅ 확인 후 커밋(시각 변경이라 선커밋 금지). 미커밋에 Teardown.jsx 추가.

## 2026-07-05 (A-1 — buildRecipes API 포맷 지원)
**한 일**
- redNodeRecipe.js: ComfyUI API 포맷(최상위 노드ID 키 + 각 값 class_type) 지원. flatten이 json.nodes 없으면 API 노드로 변환(_apiInputs), alignSlots가 inputs 객체에서 *_name 파일값 직접 추출.
- 사전 실측(A-1): API 포맷 입력 시 기존 buildRecipes는 빈 recipes([]) 반환(크래시 아님) → "빨간 노드 교정" 섹션 조용히 누락. normalize(화면)는 Teardown.jsx L337~343에서 이미 API 대응 확인.
- test/api_sample.json 신설(합성 4노드, nvfp4+fp4). regression.mjs에 API 케이스 추가.

**어떻게**
- API는 properties.models 없음 → folder/url은 rule fallback(src=rule). quantBad/ggufAlt는 파일명 기반이라 변환만으로 동작. 회귀: 기존 4 + API 신규 전부 통과, 빌드 OK.

**다음 할 일**
- 화면(Teardown.jsx)에서 API 포맷 파일 실제 로드 dev 확인.
- 미커밋 누적(redNodeRecipe.js·regression.mjs·api_sample.json·HISTORY) 커밋 지시 대기.

## 2026-07-05 (P9 회귀테스트 — buildRecipes 4 fixtures 통과) · 커밋 0bcebdc (push 대기)
**한 일**
- test/regression.mjs 신설: fixtures 4개(LTX2.3 + Flux2 Edit/Inpaint/T2I) → buildRecipes(gpu=ampere). 크래시 0.
- 기대치 전부 충족: LTX quantBad 2(fp8_scaled+fp4_mixed)·ggufAlt 2, Flux2 3종 quantBad 슬롯 ggufAlt 전부 채움(확인필요 0). src 분포 정상(LTX manifest 6/rule 2, Flux properties.models/rule).

**막힌 점**
- analyze(normalize·repoForUnmapped) unmapped/broken/repoSrc 항목은 Teardown.jsx 내부(JSX+React, node import 불가) → 회귀에서 SKIP. 완전 검증하려면 순수 ESM 모듈 추출 필요(별건).

**다음 할 일**
- (선택) analyze/normalize/repoForUnmapped 추출 → regression 완전판(unmapped/repoSrc 포함).
- 미커밋 누적(regression.mjs·gguf_file_map·CLAUDE.md·HISTORY) 커밋 지시 대기.

## 2026-07-05 (CLAUDE.md 작업 규칙 섹션 신설)
**한 일**
- CLAUDE.md 상단에 "작업 규칙 (불변 — 압축 후에도 유지)" 6개 신설: 빌드≠화면(dev 확인 전 커밋금지) / 커밋은 명시지시만 / 날조금지·미확인 "확인 필요" / 변경요약 표+라인번호 / 기능심사 기준("빨간 워크플로 캡쳐 대신 JSON 한 방") / 작업 단위마다 HISTORY 갱신(커밋 무관, 커밋 시 해시 병기).
- 규칙6은 기존 "작업 종료 시 기록"(task마다)과 통일 — 커밋 여부 무관 갱신하도록 문구 확정.

**다음 할 일**
- 미커밋 누적(gguf_file_map.json · CLAUDE.md · HISTORY) — 커밋 지시 대기.

## 2026-07-02 (Manager 노드맵 역매핑 + 출처 확신도 라벨)
**한 일**
- Comfy Registry API 검증: 역검색(class→repo) 불가 확인, cnr_id 커버리지 79.6%(FRONTEND_ONLY 제외 시 98%)
- ComfyUI-Manager extension-node-map.json 검증: 36,222 class 역매핑 가능, GACLove/Deno2026 등 Registry 미등록 팩도 포함
- scripts/build-nodemap.mjs 신설: 역매핑 생성(repos 인덱스화, minify → 1,120KB, gzip 314KB)
- public/manager_node_map.json: Vite 정적 서빙, useEffect 비동기 로드(번들 미포함)
- 룩업 체인 4단계: curated → manager → prefix → null, CORE(-1) 자동 제외
- 커스텀 노드 카드에 출처 라벨: 검증됨/Manager 등록/추정(확인 권장)
- Deno 계열 curated 데이터 완성(Deno2026/comfyui-deno-custom-nodes)

**어떻게**: extension-node-map { repo: [[classes], meta] } → { repos:[], map:{class:idx} } 역변환, -1=CORE

**다음 할 일**
- dev 화면 검증(체크리스트 5항목)
- P8: Manager model-list + nodemap 월간 갱신 통합
- P9: JSON 10개 회귀테스트

---

## 남은 과제 (컨텍스트 압축 대비 — 다음 세션 참조용)

**완료**
- T1: Findings "출처 추정 노드" 섹션 삭제 (A-4 repo 매핑으로 대체)
- T2: Solution 3번 모델 다운로드 검색떠넘기기 제거 + directDownloadUrl 확정 URL만 표시
- T3: Solution 4번 끊어진 경로 강등 → Findings 이식 위험에 통합
- T4: Findings 1 이식 위험 값 — 절대경로(제작자 PC) 감지 + 초보 친화 문구 + modelRoot 안내
- T5+T6: Solution 2번 "노드 설치 허브" 재구성 (방법A 직접 clone + 방법B 자동 스크립트)
- T7: Findings 2번 버전 충돌 — pack별 다음 행동(커밋 checkout/최신 통일) 추가
- P1: install_note 경고 강화 (Findings+Solution 양쪽)
- P2: bypass/muted 입력 끊김 경고 (detectBypassBreaks, 활성 노드로 가는 끊김만)
- P3: model_aliases.json — 같은 모델 다른 이름 "이미 있을 수 있음" 안내 (확실한 것만)
- P4: model_sizes.json — 정상 용량 사전, 카드/무결성/스크립트 연결 (정확 일치만)
- P5: 모델 다운로드 "받기 전 이미 있는지 확인" 안내 (화면+md)
- P6: 무시 가능 import 경고(ignorable) 노드 회색 처리
- P7: web_search 적립 루프 — "이거 맞았어"→localStorage 후보→내보내기 스니펫→사람 승인 (자동확정 0)

**남은 과제**
- P8: Manager model-list 월간 갱신 (스크립트·루틴 명시 완료, cron 자동화는 미정)
- P9: 어제 JSON 10개 회귀테스트 (오늘 변경으로 깨진 게 없는지)

---

## 2026-06-30 (사용자 동선 재배치 — 진단 한 줄 + STEP + 중복 제거)
**한 일**
- Summary를 "진단 한 줄(diagLine) + 차단 이슈만"으로 축소, 참고(충돌/이식/비활성)는 Findings 일원화
- Red Node Fix에 커스텀 노드 누락 카드 추가 (report.broken+unmapped → 설치 안내)
- FRONTEND_ONLY 버그 수정 (SetNode/GetNode 누락 → 24개 거짓 양성 제거)
- 빨간 노드 교정 ↔ Solution 중복 제거: 버전충돌 제거, TL;DR 제거, authorNotes 아코디언화
- Solution 설치 단계 제목 → 행동 중심("커스텀 노드 한 번에 설치", "모델 한 번에 받기")
- Red Node Fix STEP 1(노드 설치)/STEP 2(모델 맞추기) 번호 부여, 고급 입력칸 숨김

**어떻게**: 진단→STEP 처방→Solution(실행)→Diagnose→Findings(참고) 동선 확립

**다음 할 일**
- 고급 옵션(dir 생성기·입력칸) 재설계 후 복원
- P8: Manager model-list 월간 갱신
- P9: JSON 10개 회귀테스트

---

## 2026-06-29 (빨간 노드 교정 엔진 + UI 연결)
**한 일**
- src/data/redNodeRecipe.js 신설: 워크플로 JSON → 모델노드별 교정 레시피
  · 폴더·URL 우선순위: properties.models > Deno매니페스트 > 슬롯맵 > 타입맵 > 확인필요
  · 서브그래프 재귀, bypass 제외, 양자화 비호환(fp8/fp4/nvfp4) 플래그, author 병기
  · TYPE_SLOT 폴백: inputs[] 빈 core 로더(Flux UNETLoader/CLIPLoader 등) 위치순 슬롯 추론
- src/Teardown.jsx: Solution 위에 "빨간 노드 교정" 섹션 신설, recipes useMemo(rawJson+gpu)
- 실물 검증: test/fixtures 4개(LTX2.3 + Flux2 3종) — 화면 렌더까지 확인
- 커밋: c3f4630(엔진) / 5dd8f72(UI연결)

**남은 일**
- buildBriefing 끝에 캡쳐 동봉 안내(자산17)
- 입력 UI 3구역 재배치 + dir/b·Manager·우측패널·extra_path 칸(자산 11·13·14·16·18)
- 폴리시: 빨간노드 카드 슬롯 컬럼 줄바꿈 정리

---

## 2026-06-28 (redNodeRecipe.js 신설 — 모델 노드 교정 레시피 추출, UI 미연결)
**한 일**
- src/data/redNodeRecipe.js 신설(독립 ESM 모듈, Teardown.jsx 미연결). 워크플로 JSON → 모델 보유 노드별 탭·슬롯·폴더·URL 교정 레시피. red(디스크 상태) 확정 안 함 — 전부 "교정 대상".
- 10개 동작: flatten(서브그래프 재귀+_inSubgraph) / bypass·mute 제외 / 모델노드 판별 / 활성탭(pipeline_mode) / 슬롯-값 정렬(phantom offset 보정) / 폴더·URL 우선순위(properties.models > manifest > SLOT_FOLDER > TYPE_FOLDER > 확인필요) / 위젯값≠author시 currentValue+authorRecommend 병기 / 양자화 quantBad / 출력구조 / NODE_FOLDER_MAP 동일값.
- main 가드(node 콘솔 검증), node 전용 모듈은 동적 import로 브라우저 안전.

**검증**
- 실제 4개 워크플로 JSON이 프로젝트에 없어 명세 기반 합성 픽스처로 콘솔 검증(로직 동작 확인). LTX(서브그래프·매니페스트·offset·bypass제외·탭) / Flux2 Inpaint(properties.models diffusion_models 오버라이드) / Flux2 T2I(nvfp4 규칙폴더+quantBad) / Flux2 Edit(author병기) 전부 의도대로.

**다음 할 일**
- 실제 4개 워크플로 JSON으로 재검증(경로 받으면). UI 연결 여부 결정.

## 2026-06-28 (제작자 주의사항을 상단 "이렇게 하세요" 영역으로 이동)
**한 일**
- authorNotes(제작자 주의사항)를 상단 surfaceHi 영역 밖 → 안으로 이동(rx 요약 다음). amber 박스(테두리/radius) 제거하고 구분선 + amber 라벨로 영역에 녹임(박스 안 박스 방지).

**진단 (미해결, 사용자 보류)**
- 상단 "※ 이렇게 하세요!"의 rx 요약(step.title 나열)이 하단 1,2번 step 제목과 **동일 = 내용 중복**. 이는 TL;DR 원래 설계("step 제목 압축")에서 비롯 — 스타일 수정으로 생긴 게 아니라 원래 구조이며, 영역 분리로 더 부각됨. 사용자가 TL;DR 목적 재검토 후 결정 위해 "일단 둠".

**다음 할 일**
- TL;DR 중복 처리 방향 결정(제거 / 개요 한 줄 / 유형 요약).
- P9 회귀테스트.

## 2026-06-28 (Solution 상단 "※ 이렇게 하세요!" 영역 분리)
**한 일**
- 라벨 "이것만 하면 됨" → "※ 이렇게 하세요!".
- 떠있는 라운딩 박스(borderRadius) 제거 → 상단 영역화: surfaceHi 배경을 음수마진(-18px -34px)으로 바깥 박스 폭에 꽉 채움. 바깥 박스 overflow:hidden으로 상단 모서리는 바깥 radius18을 따라감.
- 하단 1,2번(authorNotes+step) surface 배경 그대로 유지 → 상단(surfaceHi)/하단(surface) 배경색 차이로 영역 분리(라운딩 박스 없이).

**다음 할 일**
- P9 회귀테스트. 음수마진/overflow 시각 점검(dev).

## 2026-06-28 (UI 정리 — Summary·Solution·Findings 구조 변경)
**한 일**
- Summary 숫자 카드에서 "모델/버전 충돌/이식 위험" 3개 제거 — Findings와 중복이라 "전체 노드/커스텀 pack" 2개만 유지
- TL;DR("이것만 하면 됨") + authorNotes("제작자 주의사항")를 Solution 아코디언 박스 안으로 이동 (TL;DR→authorNotes→단계 순)
- Findings 문제 블록(fb/fa/f1/f2)을 기본 닫힘으로 변경 — Solution이 주인공
- Findings 구분선 위아래 여백 각 5px 감소 (paddingTop 32→27, paddingBottom 36→31)

---

## 2026-06-28 (LTX 전용 로더 폴더 매핑 + 통짜 모델 폴더 충돌 진단)
**한 일**
- NODE_FOLDER_MAP에 TextEncoderLoader 패턴 추가 → LTXAVTextEncoderLoader가 text_encoders로 확정(기존 CLIPLoader 패턴에 안 걸려 "확인 필요"였음).
- LTXVAudioVAELoader는 기존 /VAELoader/로 이미 vae 매칭 확인. MelBandRoFormerModelLoader는 표준 폴더 불확실 → 미등록(확인 필요 유지, 추측 금지). node로 4종 매핑 검증.

**막힌 점/진단 (별개, 미수정)**
- LTX 통짜 모델(ltx-2.3-22b-dev-fp8.safetensors)이 CheckpointLoaderSimple + LTXAVTextEncoderLoader + LTXVAudioVAELoader에 동시 연결 → 같은 파일에 폴더 후보 3개(checkpoints/text_encoders/vae). dedup(modelMap)이 첫 노드 folder만 유지 → JSON 노드 순서 의존 오분류. (1)의 TextEncoder 매핑이 통짜엔 text_encoders로 오분류 가능.
- 권장: 통짜 감지(같은 파일 + 다중 로더 type) → 단일 폴더(CheckpointLoader 우선) + "통짜 모델 공유" 안내. 사용자 요청대로 따로 다룰 예정.

**다음 할 일**
- LTX 통짜 모델 폴더 충돌 처리(통짜 감지 + 단일 폴더 우선순위).
- P9 회귀테스트.

## 2026-06-28 전면 감사 — 어긋난 점 4개 + 수정 우선순위

**어긋난 점**
1. **Desktop 경로 하드코딩 vs 범용 지향**: custom_nodes 경로 안내에 `%LOCALAPPDATA%\Comfy-Desktop\...` Desktop 전용 경로를 하드코딩함. PRD "범용 ComfyUI 진단 도구" 지향과 어긋남 — Desktop 외 설치(포터블, WSL, Docker 등)에는 의미 없는 경로.
2. **guessFolder가 부정확 폴더를 확정처럼 노출**: 위젯 이름 기반 추론(ckpt→checkpoints, vae→vae 등)인데 결과를 "확인 필요" 표기 없이 확정 경로로 표시. 실제로는 extra_model_paths.yaml·사용자 커스텀 구조에 따라 다를 수 있어 오해 소지.
3. **analyzeLog 죽은 코드 잔존**: 이전 버전에서 쓰이던 로그 분석 함수/변수가 현재 어디서도 호출되지 않으면서 코드에 남아 있음. 번들 사이즈 + 가독성 저하.
4. **P9 회귀테스트 미검증**: 오늘 대규모 변경(Findings 재구성, 4열 표, GGUF 등) 후 JSON 10개 회귀테스트를 아직 안 돌림. 깨진 게 있을 수 있음.

**수정 우선순위**
1. P9 회귀테스트 — 가장 먼저. 기존 기능이 깨졌는지 확인해야 다른 수정도 안전.
2. guessFolder 부정확 표시 — 사용자 혼란 직결. "추정" 표기 복원 또는 확정/미확정 분기.
3. analyzeLog 죽은 코드 제거 — 빠르고 안전. 번들 경량화.
4. Desktop 경로 하드코딩 — 당장 해롭진 않으나 범용 전환 시 정리 필요. "설치 유형별 경로" 토글 등으로 개선 가능.

---

## 2026-06-28 (Value not in list 파싱 — PC에 있는 후보로 교체 안내 ★실전 빈틈)
**한 일**
- errlog 직접 파싱(troubleshooting_patterns와 별개): `{위젯}: '{요구파일}' not in [{후보목록}]` 정규식 → 배열(여러 노드 동시 처리).
- Diagnose에 "파일 이름 불일치 N건" 박스: 요구 파일이 PC에 없음 + PC에 있는 후보 목록 + "이 중 비슷한 걸로 교체" 안내.
- 토큰 유사도(Jaccard)로 1순위 후보 제시(예: gemma_3_12B_it_fp4_mixed → fp8_scaled, sim 0.5). 확신(sim≥0.4 & 2순위와 0.2+ 차이)일 때만 "유력" 표기, 아니면 후보만 나열(단정 금지).

**어떻게**
- parseValueNotInList() + tokenSim(). 정규식 g flag exec 루프로 여러 줄. best는 confident일 때만 강조. node로 예시 검증 완료.

**다음 할 일**
- P9 회귀테스트.

## 2026-06-28 (Findings 행동 기준 재구성 — 문제 1,2,3 vs 참고 접힌 토글)
**한 일**
- 문제 블록(이상 노드/이식 위험/패키지·버전) 기본 펼침 + 번호 1,2,3(이상 없으면 이식위험=1로 동적). 깨진 노드는 "!"(치명, 번호 밖) 유지.
- 참고(모델·자산 인벤토리/비활성 노드/ignorable)를 하나의 접힌 토글 "전체 현황 보기 (모델 N · 비활성 M)"로. 기본 닫힘, 안의 항목은 번호 없는 소제목.
- 번호 1,2 / 1,2 꼬임 해결: 화면 열면 문제만 또렷, 참고는 개수 적힌 토글 하나로 인지.

**어떻게**
- open 초기값에 문제 블록(fb/fa/f1/f2) 기본 펼침 지정. 참고는 open.inv 단일 토글로 모델/비활성/ignorable 묶음(기존 i1/i2 BlockHead→번호 없는 소제목). 번호는 anomalous 유무로 동적.

**다음 할 일**
- P9 회귀테스트. 통합/토글 간격 시각 점검(dev).

## 2026-06-28 (GGUF 대체를 브리핑·md에도 — LLM 왕복 감소)
**한 일**
- ggufLines() 공용 헬퍼: GGUF 대체 세트(역할→폴더→파일별 직링크 + 노드)를 마크다운 들여쓰기 텍스트로.
- buildBriefing(복사): 양자화 문제 블록에 GGUF 대체 직링크 추가(fp8+Ampere 시) → LLM에 물어볼 때 같이 복사.
- buildMarkdown(.md): step.items 처리에 quant(file/desc/gguf) 케이스 추가 → GGUF 직링크 포함. 부수: quant step이 `- undefined`로 깨지던 버그 수정(기존 it.action만 처리).
- 이제 화면 quant 박스 + 브리핑 + .md 3곳 모두 GGUF 세트 노출.

**다음 할 일**
- P9 회귀테스트.

## 2026-06-28 (gguf_alternatives 검증값 보강 — LTX 2.3 전체 GGUF 세트)
**한 일**
- compatibility.json gguf_alternatives.ltx-2.3를 단일 파일 → **컴포넌트별 세트**로 확장(web_search 확정): diffusion(Q4_K_M 14.3GB / Q6_K 17.8GB → models/unet), 텍스트 인코더(gemma-3-12b-it-qat-UD-Q4_K_XL + mmproj-BF16 → models/text_encoders), VAE(video/audio → models/vae).
- 각 파일에 huggingface resolve 직링크(/resolve/main/…?download=true). VAE는 저장소 vae/ 하위. 노드 city96/ComfyUI-GGUF.
- quant 경고 GGUF 박스 렌더를 components 순회(역할→폴더→파일별 직링크)로 교체.

**다음 할 일**
- P9 회귀테스트.

## 2026-06-28 (추정 제거 · GGUF 자동대체 · Findings+Inventory 통합)
**한 일**
- (1) "추정" 전면 제거: guessFolder "· 추정" 라벨 삭제(폴더명은 ComfyUI 표준이라 유지), Inventory 색분기·node_repo_map notes 정리. 화면 노출 "추정" 0건. (코드/데이터의 "추측 금지" 가이드 주석은 추측 방지 의도라 유지.)
- (2) GGUF 자동 대체: compatibility.json gguf_alternatives 신설(LTX 2.3 → unsloth/LTX-2.3-GGUF Q6_K · unet 폴더 · city96/ComfyUI-GGUF 노드, web_search 확정). ggufAlternative() → quant 경고에 직링크 박스(fp8+Ampere 시).
- (3) Findings+Inventory 통합: Inventory SectionTitle/wrapper 제거 → Findings 한 영역. 문제(깨진/이상/이식위험/패키지) 위, "— 전체 현황 —" 굵은 구분선 아래 현황(모델/비활성/ignorable).

**어떻게**
- (1) 폴더 추측은 라벨만 삭제, 진짜 모름은 "확인 필요" 유지. (2) 데이터 json·하드코딩 0. (3) 2개 섹션 div→1개 병합, 굵은 구분선+소제목으로 문제/현황 구획.

**다음 할 일**
- P9 회귀테스트. 통합 후 간격 시각 점검(dev).

## 2026-06-28 (다운로드 표 vs Inventory 역할 분리 — 할 일 vs 현황)
**한 일**
- 다운로드 표(Solution)를 "받아야 할 후보"로 재프레이밍 + 각 행 "이미 있음" 토글. 도구는 PC를 못 보므로 "없는 모델"을 단정하지 않고 사용자가 체크 → 후보에서 제외(행 흐림 + 받기 숨김 + "✓ 있음(취소)").
- 상단 요약 "받아야 할 후보 N개 · 이미 있음 M개", 전부 표시 시 "✓ 필요한 모델이 다 있습니다".
- Inventory role을 "전체 현황(VRAM·출처 포함, 참고용) · 받기는 Solution에서"로 → 할 일(받기) vs 현황(전체) 구분 명확.
- 합치지 않음: 다운로드 표=가중치+받기 액션, Inventory=전체 모델+VRAM+비활성/이상 노드 그대로 유지.

**어떻게**
- haveModels(Set) state + toggleHave. PC 미확인이라 자동 필터 불가 → 사용자 체크 기반(휘발, 세션). 무결성 박스는 공통이라 유지.

**다음 할 일**
- P9 회귀테스트(어제 JSON 10개로 오늘 변경 검증).

## 2026-06-28 (Q8·P15·P16·P12·UUID·Q11: 용량표기·런타임진단·제작자메모·이상노드)
**한 일**
- Q8: fmtSize() — 용량 1GB 미만은 MB, 이상은 GB 자동(348MB·1.45GB·18GB). 화면 표·Inventory·브리핑·설치스크립트 4곳 통일.
- P15(★): troubleshooting_patterns.json에 런타임 패턴 3종(CUDA OOM, 텐서 shape, 해상도 규칙) + quantization에 float8(dtype) + 전 패턴 category(로드/설치/경로/런타임). 매칭 렌더에 category 배지(런타임 강조). errlog 입력칸 그대로 재사용.
- P16: MarkdownNote/Note 텍스트 → report.authorNotes → Solution 상단 "제작자 주의사항" 박스(원문 그대로, 실행 전 확인).
- P12: MarkdownNote URL 추출(extractNoteLinks) → 파일명 정확 일치 시 m.noteUrl → directDownloadUrl 최우선(web_search·compat보다). 미매칭 URL은 제작자 메모 원문에 노출(메모-파일명 다름은 사용자가 직접 인지).
- UUID: type이 UUID 형태 → report.anomalous("이상 노드") 별도 감지. broken(type=null)과 분리. Findings 블록 + Summary issue.
- Q11: buildMarkdown(.md)에 정상 용량(fmtSize) 추가 — 화면 표와 통일.

**어떻게**
- 추측 0: 런타임 패턴은 확실한 에러 메시지만, noteUrl·용량은 정확 일치만. normalizeNode에 noteText 필드를 widgets와 분리(노트 텍스트가 모델/portability로 오탐되지 않게).

**다음 할 일**
- P9 회귀테스트(어제 JSON 10개로 오늘 변경 검증).

## 2026-06-28 (브리핑에 받을 모델 표 추가 — LLM 왕복 감소)
**한 일**
- buildBriefing(복사 텍스트)에 "받을 모델" 마크다운 표 추가: 받을 파일 / 어디에 둘지(modelRoot 시 내 경로) / 정상 용량 / 직링크. 화면 4열 표와 동일 정보.
- 이전엔 reportToContext의 "파일명 → 폴더"만 있고 용량·직링크·내 경로 없었음 → 사용자가 LLM에 또 묻던 왕복 제거.
- 무결성 비교 + "직링크가 '확인 필요'면 출처도 같이 찾아달라" 한 줄 동봉.

**어떻게**
- 가중치(WEIGHT_EXTS)만 필터. 정적 compat/Manager(m.compat) 기준 — 실시간 fetch·개인 적립(learned)은 모듈 함수라 미반영(buildMarkdown과 일관). size=size_gb/size_label/knownModelSize, url=directDownloadUrl.

**다음 할 일**
- (선택) buildMarkdown(.md 저장)에도 정상 용량 추가 — 현재 VRAM+링크만.
- P9 회귀테스트.

## 2026-06-28 (모델 다운로드 4열 표 정돈)
**한 일**
- Solution 모델 다운로드를 세로 카드 → 4열 grid 표: **받을 파일 / 어디에 둘지(modelRoot 시 내 경로) / 정상 용량 / 받기**. 한 줄에 정렬.
- 받기 칸: 확정 직링크면 "받기", 없으면 "확인 필요" (AI_KEY 있을 때 web_search "찾기" + P7 적립 보조 유지).
- 용량: 정확값(예 18 GB · 1.45 GB)만 표기, 모르면 "확인 필요"(지어내기 0). 각 행 용량 아래 "받은 뒤 이 용량과 비교 — 수 KB/MB로 작으면 깨진 것이니 삭제 후 재다운".
- VRAM은 표에서 제외(Inventory 카드에 유지). rename·alias·src 배지·P7 적립은 보조정보로 보존.

**다음 할 일**
- P9 회귀테스트(어제 JSON 10개로 오늘 변경 검증).

## 2026-06-28 (P7: web_search 결과 적립 루프 — pending→내보내기→사람 승인)
**한 일**
- "이거 맞았어 (적립)" 버튼: web_search로 찾은 모델 직링크를 localStorage(td-learned-v1) 후보로 적립. 모델 카드(Solution·Inventory) 양쪽.
- 쓸수록 똑똑: 적립 항목을 런타임 조회(eff)에 합류 → 이 브라우저에서 즉시 "다운로드" 제공. 출처는 "내 적립(미확정)" amber 배지로 curated/Manager와 구분.
- 오염 방지 3단 분리: 적립=localStorage만 / json 파일은 도구가 절대 자동수정 안 함 / 확정=사람이 내보내기 스니펫 병합·커밋.
- 내보내기 패널(Diagnose 하단): 적립 N건 → 대상 파일별 JSON 스니펫(복사+콘솔 / .json 다운로드 / 개별삭제 / 비우기). 각 항목에 "_note: 미검증·확인 필요".

**어떻게**
- learned state(localStorage 미러) + learnedModel()을 eff 우선순위 끝(compat→manager→learned→검색폴백)에 삽입. buildLearnedSnippet이 model_link→compatibility.json models 형식, node_repo→node_repo_map 형식으로 분류(노드 적립은 검색 UI 부활 시 동일 메커니즘으로 확장).
- 추측 자동확정 0: 적립은 사용자 클릭만, 확정은 사람 승인만.

**다음 할 일**
- (선택) 노드 repo 적립 트리거 UI(출처 미상 노드 검색 부활).
- 남은: P8(월간 갱신·사실상 충족), P9(회귀테스트).

## 2026-06-28 (Manager model-list 갱신 + 월간 루틴 명시)
**한 일**
- Manager model-list 갱신: `node scripts/update-model-list.mjs` 실행 → manager-model-list.json **498개**. **갱신: 2026-06-27, 다음 갱신 권장 2026-07-27.**
- 월 1회 갱신 루틴을 README "실행" 섹션에 1줄 명시(갱신 이력은 HISTORY로 안내).

**다음 할 일**
- 2026-07-27 즈음 model-list 재갱신.

## 2026-06-28 (model_sizes 승격 + 남은 과제 목록 정돈)
**한 일**
- model_sizes.json _meta.pending → sizes 승격: ltx23_audio_vae_bf16=0.348GB, ltx-2.3-22b-distilled-1.1-q4_k_m=16.5GB (사용자 실측 정확 파일명). 정확 일치 규칙·키 소문자 유지, pending 제거.
- HISTORY "남은 과제" 목록을 실제 상태와 동기화: T2/T3/T4/T7/P2/P3/P4/P5/P6 완료로 이동, P7/P8/P9만 남김.

## 2026-06-28 (T4·P3·P4: 이식위험 친화화 + 모델 별칭/용량 사전)
**한 일**
- T4: Findings 1 "이식 위험 값" — 절대경로(제작자 PC 경로)를 isAbsPath로 별도 감지 → "당신 PC엔 없으니 무시하고 같은 파일을 당신 폴더에" 초보 문구. modelRoot 미입력 시 "환경설정에 적으면 내 경로로 보여줌(안 적어도 됨)" 안내. 헤더 role 친화화.
- P3: model_aliases.json 신설 + modelAliasInfo() → 모델 카드(Solution·Inventory)에 "다른 이름으로 이미 있을 수 있음" 안내. 확실한 그룹만(LTX 2.3 video VAE 별칭 2개). 정확 일치.
- P4: model_sizes.json 신설 + knownModelSize() → 카드 "정상 N GB"·무결성 박스·설치스크립트 주석 연결. 정확 일치만(오판 방지). 확인된 파일명만(LTX video VAE 1.35GB); audio(348MB)/distilled_gguf(16.5GB)는 정확한 파일명 미확정이라 _meta.pending 보류.

**어떻게**
- 세 작업 모두 추측 데이터 0. stem 정확 일치 매칭 → false positive 없음(틀린 키는 매칭 안 되고 기존 폴백 유지). 데이터는 src/data 별도 json(하드코딩 0).

**다음 할 일**
- audio/distilled_gguf 정확한 파일명 확인되면 model_sizes.json sizes로 이동.
- 정답지 5단계 테스트(T1~T9) 성공률 실측.

## 2026-06-27 (진단 정밀화 5종: 충돌액션·bypass끊김·ignorable·입력파일·중복확인)
**한 일**
- (1) Findings 2 충돌 pack마다 다음 행동 1줄: commit 섞임→"커밋 checkout 또는 최신 통일", 점버전만→"최신 통일".
- (2) bypass/muted 노드가 활성 노드 입력을 끊는 경우 감지(detectBypassBreaks) → 비활성 노드에 "뒤 노드 입력 끊길 수 있음" 경고. normalize가 wf.links 보존하도록 확장(이전엔 버림). bypass+상류연결은 passthrough 가능성으로 오탐 제외.
- (3) troubleshooting_patterns.ignorable_import_warnings 힌트로 노드 판정(isIgnorableNode) → 비활성 목록에서 회색+"안 써도 됨", Inventory에 "import 경고 무시 가능" 안내.
- (4) portabilityScan 확대: 경로 구분자 없는 단순 입력 파일명(png/mp4/wav 등) 감지 → "내 입력 파일을 input 폴더에 다시 넣으세요".
- (5) 모델 다운로드 안내에 "받기 전 같은/비슷한 파일 이미 있는지 확인" 1줄(화면+md).

**어떻게**
- (2) UI 포맷 wf.links([id,src,srcSlot,dst,dstSlot,type])로 src=off·dst=active 링크 탐지. API 포맷은 links 없어 경고 미발생(안전).

**다음 할 일**
- 실제 워크플로(T2 bypass, LTX triton 등)로 (2)(3) 오탐/누락 확인.
- 정답지 5단계 테스트(T1~T9) 성공률 실측.

## 2026-06-27 (Solution 4번 강등: 끊어진 경로 → 이식 위험에 통합)
**한 일**
- Solution "끊어진 경로·입력 파일 정리"(paths step) 제거 — 내용(portability)이 Findings "이식 위험 값"과 100% 중복이라 단독 처방 강등=통합. 정보 손실 0.
- 산출물 경로 안내 문구를 직관화: "내 입력 파일을 다시 넣거나 해당 단계를 다시 실행하면 됩니다 (다른 PC엔 이 경로가 없습니다)". Findings·md export 공용(단일 소스).
- Findings 1 헤더 role도 갱신(없어진 step 언급 제거 + "내 파일 다시 넣으면 됨" 반영).

**어떻게**
- buildPrescription에서 stale/sep 필터 + paths step 삭제, portabilityScan의 산출물 risk 문구만 개선 → 한 곳 수정으로 화면·md 동시 반영.

**다음 할 일**
- 정답지 5단계 테스트(T1~T9) 성공률 실측.

## 2026-06-27 (모델 다운로드: 검색 떠넘기기 제거 + web_search 직링크)
**한 일**
- Solution 3번·Inventory 카드의 "HuggingFace 검색/Google 검색" 떠넘기기 링크 전면 제거 → 확정 직링크만 "다운로드" 버튼, 못 구하면 "확인 필요"(추측 URL 금지).
- 죽어있던 researchModel(web_search)을 "다운로드 링크 찾기" 버튼으로 연결(AI_KEY 있을 때만, 비용가드 유지). 찾으면 직링크가 "다운로드"로 승격.
- 버튼명 "HF에서 받기/검색"·"Manager 링크" → "다운로드" 통일, 끝 ExternalLink 아이콘 삭제. md export도 동일(검색링크 제거).

**어떻게**
- directDownloadUrl(eff, file, research) 헬퍼 신설: compat/Manager → web_search 확정 → HF_EXACT 화이트리스트 순, 검색 URL 폴백은 버림.

**다음 할 일**
- 로컬(AI_KEY)에서 출처 미상 모델로 "다운로드 링크 찾기" 실제 동작·정확도 확인.

## 2026-06-27 (Solution "노드 설치 허브" 재구성)
**한 일**
- Solution 2번 "커스텀 노드 설치"를 방법 A(직접 clone) + 방법 B(자동 스크립트) 2트랙으로 재구성
- 방법 A: custom_nodes에서 Git Bash Here → clone 명령 블록 + 복사 버튼
- 방법 B: .bat/.sh 다운로드 버튼 2개 + "초보자는 이 방법 권장"
- 기존 Solution 바깥 떠있던 .sh/.bat 스크립트 섹션 제거 → 2번 안으로 흡수
- scriptOs 상태 삭제 (더 이상 토글 불필요, 직접 다운로드)
- 두 방법 모두 "반드시 custom_nodes 폴더 안에서 실행" 명시

## 2026-06-27 (Findings "출처 추정 노드" 섹션 삭제)
**한 일**
- Findings "3 출처 추정 노드" 렌더 블록 통째로 삭제 (A-4 repo 매핑으로 대체)
- nodeResearch 상태 + researchUnknownNode 함수 삭제 (이 섹션에서만 사용)
- ScanSearch import 제거
- Summary "출처 미상 N개" issue 항목 삭제
- buildMarkdown "출처 추정 노드" 섹션 삭제
- AI 진단 컨텍스트: "출처 미상" → clone_url/repo 직접 안내로 교체
- unmapped 데이터 수집은 유지 (buildPrescription/buildInstallScript의 clone URL 소스)
- 번들 -5.6KB (381→375KB)

## 2026-06-27 (install_note 경고: 노드 설치 후 주의 표시)
**한 일**
- Findings 출처 추정 노드: install_note 있으면 빨간 테두리 "설치 후 주의" 박스로 강화 (기존 dim 텍스트→경고 스타일)
- Solution install 단계: installNotes 배열로 주의사항 있는 노드 수집 → clone 명령 아래 "설치 후 주의" 블록 표시
- install_note 없으면 미표시 (회귀 없음)

## 2026-06-27 (노이즈정리: 미확인 모델 접힘 + 검색 링크)
**한 일**
- Inventory 모델 목록을 confirmed/unconfirmed로 분리
- unconfirmed는 기본 접힘 "확인 필요 N개" 토글, 펼치면 카드 표시
- 모든 미확인 모델에 HuggingFace 검색 + Google 검색 링크 (추측 URL 생성 금지)
- renderCard 추출로 confirmed/unconfirmed 동일 카드 구조 공유

## 2026-06-27 (경로 재작성: 절대경로를 내 PC 경로로 치환 표시)
**한 일**
- env에 modelRoot 상태 추가 + 환경 입력에 "내 모델 루트 경로(선택)" 입력칸
- rewritePath(): 절대경로(Windows X:\, Unix /) 감지 → models/custom_nodes/input/output 세그먼트 기준 분할 → 사용자 루트로 치환
- 코드에 특정 드라이브명/경로 하드코딩 없음 (placeholder도 일반 예시만)
- Solution/Inventory 모델 카드 + Findings 이식 위험 값에 "내 경로: ..." 병기
- 원본 경로 + 이식 위험 경고 유지, 미입력 시 기존 동작 그대로

## 2026-06-27 (설치위치 안전장치: .bat/.sh 실행 위치 검증)
**한 일**
- buildInstallScript 상단 주석에 "반드시 custom_nodes 폴더 안에서 실행" 강조
- 현재 디렉토리명이 custom_nodes인지 검사 (.bat=`%CD%` basename, .sh=`basename $(pwd)`)
- 아니면 에러 메시지("ComfyUI custom_nodes 폴더에서 실행하세요") 출력 후 중단
- clone 명령에서 불필요한 `cd custom_nodes`/`cd ..` 제거 (이미 custom_nodes 안)
- 모델 다운로드 전 `cd ..`로 루트 이동 (models/ 경로 기준)

## 2026-06-27 (패턴사전: 에러 로그 → 알려진 문제 자동 감지)
**한 일**
- troubleshooting_patterns.json import + matchTroubleshootingPatterns() 함수 (키워드 OR 매칭)
- Diagnose 섹션 textarea 아래 "감지된 알려진 문제 N건" 블록: 매칭된 패턴의 증상/원인/해결/자가확인 표시
- 매칭 없으면 섹션 미표시 (회귀 없음)

## 2026-06-27 (B-무결성: 모델 다운로드 무결성 체크 안내)
**한 일**
- Solution 모델 카드: 예상 정상 용량 표시 (curated=size_gb, Manager=size_label, 없으면 "용량 확인 필요")
- Solution 모델 목록 하단: 무결성 확인 경고 박스 (용량 확인 + 재부팅 금지 + JSONDecodeError 안내)
- Inventory 모델 카드: 동일한 용량 표시 + 가중치 파일에 "용량 확인 필요" 폴백
- buildInstallScript: 모델 섹션 상단에 재부팅 금지 + 용량 확인 경고, 각 모델에 정상 용량 주석

## 2026-06-27 (맥작업패키지 v2 진행 현황)
**완료 (9/9)**
- A-4 노드→repo 매핑: node_repo_map.json 통합, class_type exact match, manager_searchable 경고, clone_url 우선
- A-3 서브그래프 모델 추출: definitions.subgraphs[].nodes 순회, origin 태깅, 중복 병합
- B-무결성: 모델 예상 용량 표기 + 재부팅 금지 경고 + JSONDecodeError 안내
- 패턴사전: troubleshooting_patterns.json 매칭 → "감지된 알려진 문제" 자동 표시
- 경로재작성: 절대경로 감지 → 사용자 루트로 치환 병기 (하드코딩 0)
- 설치위치 안전장치: .bat/.sh에서 custom_nodes 디렉토리 검증
- 노이즈정리: 미확인 모델 기본 접힘 + HF/Google 검색 링크
- 깨진 노드 감지: type=null 노드 빨간 경고
- 출력구조: buildBriefing 형식 강제 + TL;DR 박스
- C효용: 설치 스크립트 .sh/.bat 생성 + 경로 중복 버그 수정

**남은 작업**
- B-2 양자화 룰 확장: int4/nf4/awq/gptq/Q4_K_M·Q5_K_M·Q6_K/fp8 + GPU세대별 (다음 세션)

## 2026-06-27 (node_repo_map 통합: 노드→repo 정밀 매핑)
**한 일**
- node_repo_map.json import + NODE_REPO_INDEX 인덱스 빌드 (class_type exact match)
- repoForUnmapped()에 node_repo_map 최우선 조회 추가
- analyze()에서 unmapped에 clone_url/manager_searchable/install_note 부착
- buildPrescription/buildInstallScript: clone_url 우선 + pack_repo_index 활용
- Findings 출처 추정 노드: manager_searchable=false → 빨간 "수동 clone 필요", repo=null → "web_search 확인 필요"

## 2026-06-27 (서브그래프 모델 스캔 + 깨진 노드 감지)
**한 일**
- normalize()에서 definitions.subgraphs[].nodes 순회 → normalizeNode()로 통일, subgraph 인덱스 태깅
- analyze()에서 서브그래프 모델에 origin "서브그래프 #N에서 발견" 부착
- 동일 파일 중복 모델 병합 (Map by lowercase filepath, origin 합침)
- Inventory 모델 카드에 origin 표시 (C.dim, 서브그래프 출처)

## 2026-06-27 (깨진 노드 감지: type=null 노드 빨간 경고)
**한 일**
- normalize()에서 API 포맷 null type 노드 유지(기존은 필터링됨)
- analyze()에서 broken[] 수집 (type이 null/undefined/빈값)
- Summary issues에 "깨진 노드 N개" 빨간(#EF5350) 경고 추가
- Findings 최상단 "깨진 노드" 블록: 노드별 경고문 + CircleAlert 아이콘

## 2026-06-27 (출력구조: buildBriefing 형식 강제 + TL;DR 박스)
**한 일**
- buildBriefing: LLM 출력 형식 지시 추가 (해결요약→단계표→환경설정→원인 짧게)
- Solution 맨 위 "이것만 하면 됨" TL;DR 박스: rx 단계 제목을 순번으로 압축 표시

## 2026-06-27 (버그수정: 설치 스크립트 models/ 경로 중복)
**한 일**
- buildInstallScript에서 models/ 접두사 제거 (folder가 이미 models/ 포함)
- Windows용 folderWin 역슬래시 변환 추가

## 2026-06-27 (C효용: 설치 스크립트 .sh/.bat 생성)
**한 일**
- buildInstallScript(report, envGpu, os) 함수: 처방→OS별 스크립트 문자열 생성
- Solution 하단 ".sh (Mac/Linux)" / ".bat (Windows)" 토글 버튼 + 코드블록 표시
- 확정 URL만 curl 실행문, 미확인은 주석 처리 (가짜 URL 0)
- flash_attn 우회는 주석 안내만 (자동 실행 안 함)
- 복사(Copy) + 다운로드(install.sh/install.bat) 동작
- 미확인 모델 있으면 상단 경고 "URL 미확인 N개는 주석 처리됨"
- npm run build 통과

**어떻게**: buildPrescription 결과(report.packs/models/portability) 재사용. 새 데이터 수집 0.

## 2026-06-27 (UI: 양자화 경고 카드 위계 분리)
**한 일**
- 양자화 경고 items에서 file/desc 분리 + 렌더에서 파일명(600) / 설명(400) 두 줄 표시
- 색·크기·폰트 변경 없음. 기존 action 항목은 그대로 폴백.

## 2026-06-27 (v2 5단계 — 데이터 소스 4층 통합)
**한 일**
- 4층 모델 조회 완성: curated(57) → Manager내장(498) → Manager실시간fetch → web_search
- fetchLiveManager(): raw.githubusercontent.com에서 세션 1회 fetch, 캐시, 실패 시 조용히 폴백
- liveModelInfo(): 1·2층 미매칭 모델을 3층(실시간)에서 비동기 보강
- useEffect로 report 변경 시 unmatched 모델 자동 실시간 조회 → liveCompat 상태 갱신
- 출처 뱃지 3종: "큐레이션"(C.point) / "Manager"(C.green dim) / "Manager(실시간)"(C.green)
- researchModel() web_search + "이 모델 검색" 버튼(AI_KEY only, 4층)
- Inventory·Solution 양쪽에서 liveCompat 교차 적용
- npm run build 통과, 회귀 없음

**어떻게**: fetchLiveManager 모듈스코프 캐시 + useEffect 비동기 트리거 + eff(=m.compat||live) 패턴으로 UI 통합.

**다음 할 일**: git 커밋 + 실제 워크플로 JSON으로 실시간 매칭 확인 / C효용(설치 스크립트) 착수

## 2026-06-27 (v2 5단계 — 테스트 세트 양자화 진단 성공률 측정)
**한 일**
- 테스트 JSON 10개 전체로 양자화↔GPU 진단 정확도 측정 (env=RTX 3090 Ampere 기준)
- detectQuant/gpuGeneration/quantWarnings 로직 그대로 재현해 채점

**결과: 양자화 진단 정확도 10/10 = 100%**
- 1차 채점 8/10이었으나, "오답" 2건(Ideogram4, Silent_Snow)은 도구가 맞고 정답지가 틀렸음을 교차 확인:
  - Ideogram4: 실제 fp8 모델 4개(flux2-vae는 양자화 표기 없음) → 도구 4개가 정답 (정답지 5 오류)
  - Silent_Snow: 실제 fp4/fp8 1개(gemma fp4뿐, dev/distilled/upscaler는 표기 없음) → 도구 1개가 정답 (정답지 2 오류)
- 케이스별 검증:
  - Bernini(Wan2.2): mxfp8×2 + fp8 = 경고 3 ✅
  - LTX VRAM / Audio: fp8 + fp4 = 경고 2 ✅
  - SCAIL: fp8_scaled×2 = 경고 2 ✅
  - LipSync(GGUF만) / PixelArtistry / Skintoken(gguf·ckpt): 경고 0 ✅ (Ampere 호환)

**핵심**: 양자화 표기가 명시된 모델만 정확히 잡고, 표기 없는 건 지어내지 않음 = "BUILT, NOT JUST GENERATED". 추론으로 때려맞히지 않고 확정 판정만.

**결론**: v2 작업계획 5단계 전부 완료. "처음 실행 지옥"의 핵심(받기→환경입력→양자화진단→완성브리핑)이 작동·검증됨.

**다음 할 일(선택)**: 실제 집 3090 ComfyUI 로그로 parseComfyLog 실증 / 재배포(git push) / 포트폴리오 README 서사

## 2026-06-27 (v2 4단계 — LLM 폴백 완성 브리핑)
**한 일**
- `reportToContext(report, env)` — env 파라미터 추가, 환경 블록 출력
- `buildBriefing(report, errlog, env)` — 양자화 진단(quantWarnings) + 룰 처방 요약(buildPrescription) 섹션 추가
- `runAiDiagnosis(errlog, report, env)` — AI 진단 프롬프트에도 환경 컨텍스트 반영
- 호출부 3곳(copyBriefing, doAiDiagnosis, reportToContext) env 전달

**어떻게**: 3단계 함수(quantWarnings, buildPrescription) 재사용. env 없으면 환경/양자화 블록 미출력(회귀 0). API 호출 없이 클립보드 복사만.

**다음 할 일**: 5단계(테스트 세트 성공률 측정 T1~T9) 또는 실제 워크플로 E2E 검증

## 2026-06-27 (v2 3단계 — 양자화↔GPU 진단)
**한 일**
- `detectQuant()` / `gpuGeneration()` / `quantWarnings()` 함수 3개 추가 — 모델 파일명에서 양자화 형식 감지, GPU 문자열→세대 판정, 대조 후 위험 목록 반환
- `buildPrescription(r, envGpu)` 시그니처 확장 — quantWarnings 결과를 Solution 맨 앞 단계로 삽입 (severity: high, 빨간색)
- Solution 렌더: severity=high 일 때 번호 배지·제목 빨간색
- Markdown 내보내기에도 ⚠ 표식 반영

**어떻게**: env.gpu 없으면 quantWarnings()가 빈 배열 → 화면에 아무것도 안 뜸(회귀 0). compat.quant_rules.formats 테이블로 Ampere+fp8/fp4/mxfp8 → false 판정.

**다음 할 일**: 4단계(LLM 폴백 개조 — 완성 브리핑 프롬프트) 또는 실제 워크플로 E2E 검증

## 2026-06-27 (v2 1단계 — 데이터 층 구현)
**한 일**
- compatibility.json 탑재: `import compat` → `compatNodeRepo()` (cnr_id 소문자화+aliases→repo) + `compatModelInfo()` (파일명→직링크+폴더+VRAM) 신설
- analyze() 에서 pack repo를 `compatNodeRepo()`로, 모델에 compat 정보 주입 (folder 확정·VRAM·size)
- Solution/Inventory/Markdown 렌더에서 compat 매칭 모델은 "HuggingFace에서 검색"→"HuggingFace에서 받기" 직링크 + VRAM 표시
- 모델 폴더: compat 매칭 시 "추정" 없이 확정색(C.point) 표시

**어떻게**: hfLink()를 폴백으로 유지하고 compatModelInfo()가 compat.models 직접매칭 + path segment 매칭 우선. 노드는 compat.nodes → aliases → REPO_BY_CNR 폴백 체인.

**다음 할 일**: 실제 워크플로 JSON으로 End-to-End 검증 (T1~T9 테스트 세트) → 2단계(환경 입력 UI) 착수

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
