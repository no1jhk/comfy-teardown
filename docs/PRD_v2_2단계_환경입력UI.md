# Teardown v2 — 2단계 작업 지시서 (환경 입력 UI)

> VS Code Claude Code용. 이 문서를 읽고 그대로 구현. 이 채팅(설계)에서 확정한 내용.
> 대상 파일: src/Teardown.jsx (단일 파일). 충돌 방지 위해 이 파일은 VS Code에서만 수정.

---

## 목표

워크플로 JSON만 받던 것에 더해, **사용자 환경 정보(GPU/torch/CUDA)를 입력받는 UI**를 추가한다.
이 환경 정보는 3단계(양자화↔GPU 대조 진단)에서 쓰인다. **2단계는 "입력받아 상태에 저장"까지만.** 진단 로직(3단계)은 이번에 만들지 않는다.

---

## UI 구조 (확정)

JSON 입력 영역(드롭존) **아래**에, 접이식 "환경 정보" 영역을 추가한다.

```
[ JSON 드롭존 ] (기존, 그대로)

[ 🖥 내 환경 정보 (선택) ]  ← +/− 토글, 기본 접힘
 └ 펼치면:
    ① ComfyUI 로그 붙여넣기  ← 메인
       - 큰 textarea (4~6줄)
       - placeholder: "ComfyUI 시작 시 콘솔에 뜨는 로그를 붙여넣으세요. GPU·torch·CUDA를 자동으로 읽습니다."
       - 작은 안내: "콘솔에서 복사가 안 되면 ↓ 아래에서 직접 선택하세요"
       - 붙여넣으면 자동 파싱 → 아래 ②칸을 자동으로 채움 + "RTX 3090 · torch 2.8.0 · CUDA 12.8 감지됨" 같은 확인 표시

    ② 또는 직접 선택  ← 보조 (로그 복사 안 되는 사람용 우회로)
       - GPU: 드롭다운 또는 입력 (3090/3080/3060/4090/4080/5090 등 + 직접입력)
       - torch 버전: 입력칸 (예: 2.8.0)
       - CUDA 버전: 입력칸 (예: 12.8)

    [ⓘ 명령어로 확인하는 법] ← 누르면 작은 팝업/펼침
       - python -c "import torch; print(torch.__version__, torch.version.cuda)"
       - nvidia-smi
       - (각 줄 복사 버튼)
```

핵심 원칙:
- 로그 붙여넣기(①)와 직접 선택(②)은 **같은 환경 상태를 공유**. 로그 파싱 성공하면 ②칸이 자동으로 채워짐. 실패/미입력이면 사용자가 ②를 직접 채움.
- 둘을 **위아래로 분리**(같은 줄에 욱여넣지 말 것). 위계: ①이 주, ②가 보조.
- 전체는 기본 접힘(+/− 토글). JSON이 주인공이므로 환경은 "선택" 라벨.

---

## 구현 상세

### 1. 상태 추가 (다른 useState 근처, 770번 줄 nodeResearch 아래)
```js
const [envOpen, setEnvOpen] = useState(false);   // 환경 영역 펼침
const [envLog, setEnvLog] = useState("");         // ComfyUI 로그 원문
const [env, setEnv] = useState({ gpu: "", torch: "", cuda: "" }); // 파싱/입력된 환경
const [cmdOpen, setCmdOpen] = useState(false);    // 명령어 안내 팝업
```

### 2. 로그 파싱 함수 (컴포넌트 밖, 일반 함수로)
ComfyUI 시작 로그에서 정규식으로 추출:
- **torch + cuda**: `pytorch version: 2.8.0+cu128` 패턴 → torch="2.8.0", cuda="12.8" (cu128 → 12.8 변환)
- **GPU**: `Device: cuda:0 NVIDIA GeForce RTX 3090` 또는 `NVIDIA GeForce RTX 3090` 패턴 → "3090" 또는 "RTX 3090"
- 못 찾으면 해당 필드는 빈 문자열 유지 (지어내지 말 것)
```js
function parseComfyLog(text) {
  const out = { gpu: "", torch: "", cuda: "" };
  const t = text.match(/pytorch version[:\s]+([\d.]+)\+cu(\d+)/i);
  if (t) { out.torch = t[1]; const c = t[2]; out.cuda = c.length>=3 ? c.slice(0,-1)+"."+c.slice(-1) : c; }
  const g = text.match(/(RTX\s*\d{3,4}\s*(Ti|Super)?|[AB]\d{2,3}|GeForce[\w\s]*\d{3,4})/i);
  if (g) out.gpu = g[0].replace(/GeForce|NVIDIA/gi,"").trim();
  return out;
}
```
(정규식은 시작점일 뿐 — 실제 로그 샘플로 검증·보정할 것. 사용자에게 "로그 샘플 있으면 붙여달라" 요청해도 좋음.)

### 3. 로그 textarea onChange
- 입력 시 setEnvLog + parseComfyLog 호출 → 결과가 비어있지 않은 필드만 setEnv로 채움(직접입력 값 덮어쓰지 않게 주의: 파싱 성공한 필드만 갱신)
- 파싱 결과 요약 표시: "감지됨: RTX 3090 · torch 2.8.0 · CUDA 12.8" (초록), 일부만 잡히면 잡힌 것만.

### 4. 직접 선택 ②
- GPU: 드롭다운(주요 모델 목록) + "직접 입력" 옵션. 목록은 compatibility.json의 quant_rules.gpu_generations 참고(3090/3080/3060/4090/4080/4070/5090 등).
- torch/cuda: 일반 text input.
- 변경 시 setEnv.

### 5. 디자인 토큰 (기존 C 객체 그대로 사용)
- 배경 C.surface, 보더 C.line, 텍스트 C.text/C.dim, 포인트 C.point(노랑), 감지성공 초록은 기존 green 톤.
- 토글 +/− 아이콘은 기존 패턴(Solution 아코디언) 재사용. textarea는 기존 errlog 칸 스타일 참고(라인 762 errlog 관련).
- 폰트: 라벨 SANS, 로그칸 MONO.

---

## 안 하는 것 (이번 단계 범위 밖)
- ❌ 3단계 진단 로직 (양자화↔GPU 대조, "fp8인데 Ampere → GGUF" 판정) — 다음 단계
- ❌ quant_rules 실제 사용 — env 상태에 저장만, 대조는 3단계
- ❌ LLM 폴백 — 4단계
- env 입력은 전부 "선택사항". 안 채워도 기존 JSON 진단은 그대로 동작해야 함(깨지지 않게).

---

## 완료 기준
1. JSON 드롭존 아래 "내 환경 정보(선택)" 접이식 영역이 보인다.
2. ComfyUI 로그를 붙여넣으면 GPU/torch/CUDA가 자동으로 채워지고 "감지됨" 표시가 뜬다.
3. 로그 없이도 GPU 드롭다운/torch/CUDA를 직접 입력할 수 있다.
4. 명령어 안내(ⓘ)가 펼쳐지고 복사된다.
5. 환경을 아무것도 안 채워도 기존 JSON 분석/직링크는 그대로 작동한다(회귀 없음).
6. npm run dev에서 에러 없음.

## 작업 후
- 변경 요약을 보고할 것 (어떤 함수/상태 추가, 어디에 UI 넣었는지).
- 커밋은 사용자 확인 후. (또는 /end 사용)
