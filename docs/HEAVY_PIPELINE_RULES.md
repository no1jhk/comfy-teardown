# comfy-teardown 헤비 파이프라인 룰 설계서

> 작성 목적: Trellis2 / UniRig / HY-Motion 같은 "환경을 많이 타는" 헤비 파이프라인을, Teardown이 JSON만 보고도 "이건 이런 환경·설치·실행 순서가 필요하다"고 미리 경고·안내하게 만들기 위한 룰 설계서.
> 핵심 가치(moat): 이 정보는 JSON 안에 없다. 사용자가 ChatGPT/Claude/Grok에서 수십 번 삽질하며 알아낸 노하우를 룰로 박아넣는 것. 단순 JSON 파서가 절대 못 하는 영역.
> 출처: ChatGPT 트러블슈팅 md + Claude 대화 기록 3건(2026-04-15 Trellis2 설치, 2026-06-06 미싱노드 설치) 교차 확인.

---

## 0. 한눈에 — 사용자가 실제로 고생한 "3개 층"

헤비 파이프라인의 실패는 한 종류가 아니라 3개 층에서 따로 터진다. Teardown은 이 3개를 구분해서 안내해야 한다.

| 층 | 무엇 | 증상 | JSON으로 푸나? |
|---|---|---|---|
| ① 환경층 | PyTorch/CUDA/FlashAttention 버전 | 실행 시 빨간 traceback (ModuleNotFound 등) | ✗ JSON 무관, 환경 확인 필요 |
| ② 설치층 | 커스텀 노드 설치·위치·빌드 | 노드 빨간색(Missing), UNKNOWN 배지 | △ JSON으로 "뭐 필요한지"는 앎 |
| ③ 실행층 | 그룹 ON/OFF, 파일 경로·이름 | string is not a file, 드롭다운 누락 | △ 순서 안내 가능 |

---

## 1. 환경층 룰 (가장 중요 — 기존 Teardown에 없던 것)

### 1-1. Trellis2 환경 요구사항 (확정 사실)
- **PyTorch 2.8.0 + cu128** (CUDA 12.8) — Trellis2 공식 요구 버전
- **FlashAttention v2.8.3** 설치 필수
- 기본값(PyTorch 2.9.1 + cu130)은 호환 미보장 → 충돌
- 결론: **Trellis2는 기존 ComfyUI에 섞지 말고 별도 설치 권장** (사용자는 ComfyUI_Trellis 별도 폴더로 분리함)
- 실행 파일도 전용: `Start ComfyUI FlashAttention.bat`

### 1-2. Teardown 동작 (제안)
JSON에서 다음 class_type/노드 prefix 감지 시 → 환경 경고 카드 출력:
- `Trellis2`, `TRELLIS2`, `ComfyUI-TRELLIS2`
- `UniRig`, `MIA`, `HY-Motion`, `HyMotion`

### 1-3. 주의 — "추정" 원칙 유지
- 위 버전은 "Trellis2 기준 확정"이지만, 다른 헤비 노드(UniRig/HY-Motion 단독)는 요구사항이 다를 수 있음 → "추정" 라벨 붙여 정직하게.

---

## 2. 에러 로그 진단 룰 (analyzeLog 되살리기)

> 기존 Teardown의 analyzeLog(11패턴)는 정의만 되고 화면에 안 쓰임. 아래 실전 데이터로 다시 살린다.

| 로그 키워드 | 흔한 오해 | 실제 원인 | 바로 할 조치 |
|---|---|---|---|
| `Node ID '#N' has no class_type` | "JSON 손상" (ComfyUI가 그렇게 안내함) | 커스텀 노드 미설치/미로딩 | 해당 노드 설치 후 ComfyUI 재시작 |
| `No module named 'flash_attn'` | — | FlashAttention 미설치/버전 불일치 | FlashAttention.bat 또는 환경에 맞는 flash_attn 설치 |
| `No module named 'comfy_env'` | "파이썬 오류" | install.py를 일반 python으로 실행함 | ComfyUI 재시작으로 comfy-env/pixi 빌드 흐름 타게 함 |
| `string is not a file` | — | Load Mesh/Load 계열 파일 경로 오류 | 파일을 input 폴더에 복사 후 노드에서 선택 |
| `Repository not found` | — | git clone 주소 오타/대소문자 | 정확한 저장소 주소 사용 (아래 3-2 참고) |
| `only custom nodes from default channel` | — | Manager 보안 레벨 제한 | 수동 git clone 설치로 전환 |
| `CUDA out of memory` | — | VRAM 부족 | 해상도/배치 축소, Lite 모델, num_samples=1 |

원칙: 추정하지 말고 근거로 진단 / 없는 URL·모델명·경로 지어내지 않기 / `Node ID has no class_type`는 JSON 손상보다 노드 미설치를 먼저 의심.

---

## 3. 설치 가이드 룰 (헤비 노드 감지 시 출력)

### 3-1. 설치 위치 규칙
- 커스텀 노드는 반드시 `custom_nodes` 루트 바로 아래
- ❌ 다른 노드 폴더 안에 중첩되면 안 됨 (예: Make-It-Animatable 안에 ComfyUI-UniRig 넣으면 UniRig 계속 빨간색)

### 3-2. 정확한 저장소 주소 (오타로 고생함 — Repository not found)
- `git clone https://github.com/PozzettiAndrea/ComfyUI-UniRig.git`
- `git clone https://github.com/jasongzy/Make-It-Animatable.git` (submodule: auto_rig_pro, 3dgs-render-blender-addon)
- 대소문자·저장소명 정확히: `PozzettiAndrea/ComfyUI-UniRig`

### 3-3. UniRig 설치 흐름 (comfy_env/pixi)
- `python install.py` 직접 실행 → `No module named 'comfy_env'` 에러
- 해결: ComfyUI 재시작 시 comfy-env(pixi) 빌드가 돌게 함
- **Windows Developer Mode 활성화**가 숨은 전제 (심볼릭 링크 권한)

### 3-4. Manager 보안 우회
- HyMotion 등은 Manager V3.40 보안 레벨에 막힘 → 수동 git clone + `pip install -r requirements.txt`
- 설치 시 ComfyUI 시작 로그에 뜨는 python 실행 경로(격리 환경) 사용

---

## 4. 실행층 룰 (단계별 파이프라인 — 원클릭 아님)

- 파이프라인: 이미지 → (Trellis) 3D GLB → (UniRig/MIA) 리깅 FBX → (HY-Motion) 애니메이션 FBX
- 단계별 그룹 ON/OFF로 수동 실행 (1단계 GLB → 2단계 리깅 → 3단계 애니메이션)
- 파일명 우회: rigged_mia.fbx가 드롭다운에 안 보이면 mixamo.fbx로 덮어쓰기
- MIA Auto Rig: no_fingers=true, use_normal=false, reset_to_rest=true

---

## 5. 검증된 노드 출처 (실측 — Bernini Wan2.2 워크플로 테스트 2026-06-22)

web_search로 확인됨. 정적 DB(REPO_BY_CNR)에 박을 후보:
- `SetNode`, `GetNode` → `kijai/ComfyUI-KJNodes` (confidence high)
  - 설치 메모: custom_nodes에 클론 후 requirements.txt 설치. 포터블은 python_embeded\python.exe로 별도 명령.

---

## 6. 데이터 출처 메모
- ChatGPT md: ComfyRigAnimate 설치·시행착오 (리깅/실행층)
- Claude 2026-04-15: Trellis2 환경 (Torch 2.8.0+cu128 + FlashAttention v2.8.3 확정)
- Claude 2026-06-06: 미싱노드 설치 (Manager 보안, pixi, comfy_env, Developer Mode)
- 미확보: flash_attn 실제 traceback 원문 (ChatGPT/Grok 다른 창 가능성)
- 워크플로 파일: PixelArtistry_Rig_AnimWorkflow.json (YouTube qjcNLLbtIEs), Bernini_workflow_Deno_0604.json (Wan2.2 영상)

---

## 7. 범용성 원칙 (★ 2026-06-22 추가 — 오버피팅 방지)

- **범용 코어**는 절대 특정 워크플로에 의존하지 않는다 (노드 수/pack/모델/버전충돌/이식위험/비활성/범용 에러 진단). 모든 JSON에 작동.
- **특화 룰**은 해당 노드가 감지될 때만 발동 (Trellis2/UniRig 등). 감지 안 되면 침묵.
- 새 파이프라인은 특화 룰 추가로만 확장 (코어 안 건드림).
- 검증 기준: 최소 3종류 이상 서로 다른 JSON으로 테스트 통과해야 "작동"으로 인정.
- **실증(2026-06-22): Bernini(Wan2.2 영상) JSON 테스트 → 범용 분석 정상, Trellis2 특화 룰 안 튀어나옴 → 범용성 통과.**

---

## 8. 축적 원칙 — "파인튜닝 아님" (★ 2026-06-22 추가 — 도구 정체성)

- 이 도구는 모델 가중치를 학습시키는 "파인튜닝"이 아니다. 모델 바깥에 **전문가 지식을 룰로 축적**하는 것 (= 컨텍스트 조립).
- 강점: 1건씩 쌓여도 즉시 가치 / 비개발자가 도메인 전문성으로 직접 가능 / 룰이 보여 투명함 / 틀리면 한 줄 수정.
- 핵심은 자동 학습이 아니라 **큐레이션(전문가 판단)** — web_search가 후보를 제안하면, 사람이 "이건 맞다" 확인 후 DB에 저장.

---

## 9. 차별화 포지셔닝 (★ 2026-06-22 추가 — 면접·방향 기준)

### 9-1. 냉정한 현실
- "노드 찾기·설치"는 ComfyUI Manager가 더 잘함 → **여기서 경쟁하면 진다.** (web_search 노드 검색도 Manager의 Install Missing과 겹침)
- "단발 에러 빠른 해결"은 LLM에 캡처가 더 빠름 → **여기서도 LLM을 못 이긴다.**

### 9-2. LLM/Manager가 지는 자리 (= Teardown의 진짜 자리)
1. **좁고 깊은 niche** — 헤비 5종 파이프라인(Trellis2/UniRig/HY-Motion 등)은 정보가 적고 빨리 바뀌어 LLM도 헤맴. 검증된 가이드가 이김.
2. **LLM을 대체하지 말고 먹여주기** — "최고의 디버그 브리핑 생성기". 워크플로 구조+에러+알려진 함정을 한 컨텍스트로 조립 → LLM 답 질 향상. 캡처와 경쟁 안 함.
3. **설치 메모** — 비개발자가 막히는 지점(포터블 python_embeded, requirements.txt 등). Manager는 안 알려줌.

### 9-3. 결론
- **시장가치(유료 제품): 약함** — 시장 너무 작고 대체재 강함. 추천 안 함.
- **포트폴리오 가치: 강함** — 역량 증명(React 배포, 목적 있는 API 사용, 비용 설계, 문제 정의, 비개발자 UX). 이미 합격선.
- 목표가 취업(웹툰·엔터 AI Builder)이면 → **포트폴리오 기준으로 이미 성공.** "제품" 잣대로 보면 약한 게 당연.
- 더 키울 거면 기능 추가가 아니라 (a) niche 깊이 또는 (b) 서사/README. 단발 진단기 경쟁은 버린다.

---

## 10. 핵심 피칭 한 줄

> "디버깅의 병목은 AI의 답이 아니라, AI에게 줄 컨텍스트의 조립이었다. 그래서 그 조립을 자동화했다."

→ "LLM 래퍼 아니냐" 공격을 막는 방어선. 2026-06-22 Bernini 테스트로 실증됨.
