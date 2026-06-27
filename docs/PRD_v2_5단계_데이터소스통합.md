# Teardown v2 — 5단계 데이터 소스 통합 (Manager 내장 + 실시간 fetch + web_search 폴백 + 4층 교차)

> VS Code Claude Code용. docs/점검_기획누락_데이터소스재설계.md 와 함께 읽을 것.
> 대상: src/Teardown.jsx. 충돌 방지 위해 VS Code에서만 수정.
> 배경: PRD_v1.1 B효용("추정→확정, web_search로 실제 URL")이 누락됐었음. 이번에 반영.

---

## 목표

모델 직링크를 **4층 교차**로 조회해서, 정적 DB에 없는 최신 모델(LTX2.3/Ideogram4 등)도 커버.
사용자 핵심 의도: "A안(내장)과 B안(실시간 fetch) 둘 다 써서 교차검증." 단순 중복이 아니라 서로 약점 보완.

```
1. 내 compatibility.json (57개)        ← 정밀 큐레이션(양자화·VRAM). 오프라인. 최우선
2. Manager 내장본 (498개, src/data)    ← 광범위 직링크. 오프라인. [A안]
3. Manager 실시간 fetch (raw URL)      ← 항상 최신. 온라인. [B안] ★추가
4. web_search 폴백                      ← 그래도 없으면 "이 모델 검색" 버튼(B효용)
```

### A안↔B안 교차검증의 의미 (왜 둘 다)
- 내장본(2)=오프라인에서도 빠름 / 실시간(3)=내장본보다 최신.
- 둘을 비교하면 **내장본이 낡았는지 자동 감지** 가능 (실시간에 있는데 내장본에 없으면 갱신 신호).
- 네트워크 있으면 실시간이 내장본 보강, 없으면 내장본으로 폴백 → 항상 작동.
- 결론: 단순 중복 아님. 오프라인 안정성 + 온라인 최신성을 동시에.

---

## 사전 준비 (이미 됨 / 해야 할 것)

- ✅ `scripts/update-model-list.mjs` 생성됨 (Manager 받아 가공)
- **먼저 실행**: `node scripts/update-model-list.mjs` → `src/data/manager-model-list.json` 생성됨(498개). 이게 있어야 2층이 작동.
- package.json에 스크립트 추가: `"update-models": "node scripts/update-model-list.mjs"`

---

## 구현 상세

### 1. Manager 데이터 import (Teardown.jsx 상단, compat import 근처)
```js
import compat from "./data/compatibility.json";
import mgrList from "./data/manager-model-list.json";  // 추가
```

### 2. compatModelInfo() 확장 — 2층(Manager) 추가
현재 compatModelInfo는 내 compat.models만 본다. Manager를 2순위로:
```js
function compatModelInfo(file) {
  const parts = file.replace(/\\/g, "/").split("/");
  const base = parts[parts.length - 1];
  const stem = base.toLowerCase().replace(/\.[^.]+$/, "");
  // 1층: 내 compat (최우선 — 양자화·VRAM·대안 큐레이션)
  if (compat.models[stem]) {
    const m = compat.models[stem];
    return { url: m.url, exact: true, source: "curated", folder: m.folder, vram_gb: m.vram_gb, size_gb: m.size_gb, alternatives: m.alternatives, name: m.name };
  }
  // path segment 매칭 (기존 유지, 1층 범위)
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i].toLowerCase();
    if (compat.models[seg]) {
      const m = compat.models[seg];
      return { url: m.url, exact: true, source: "curated", folder: m.folder, vram_gb: m.vram_gb, size_gb: m.size_gb, alternatives: m.alternatives, name: m.name };
    }
  }
  // 2층: Manager 내장본 (광범위 직링크, 오프라인)
  if (mgrList.models && mgrList.models[stem]) {
    const m = mgrList.models[stem];
    return { url: m.url, exact: true, source: "manager", folder: m.folder, size_label: m.size, name: m.name };
  }
  // 3층(실시간 Manager fetch)은 비동기라 여기서 못함 → UI에서 fetchLiveManager() 결과로 source 갱신
  // 4층: 없음 → hfLink 검색 폴백 (web_search 버튼은 UI에서)
  return hfLink(file);  // {exact:false, ...}
}

// 비동기 교차: 1·2층에 없는 모델을 3층(실시간)에서 찾기 (UI에서 await)
async function liveModelInfo(file) {
  const stem = file.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.[^.]+$/, "");
  const live = await fetchLiveManager();
  if (live[stem]) {
    const m = live[stem];
    return { url: m.url, exact: true, source: "manager_live", folder: m.folder, size_label: m.size, name: m.name };
  }
  return null; // 3층에도 없음 → 4층(web_search) 차례
}
```

### 3. 출처(source) 뱃지 표시 — 교차검증 정직성
모델 카드/Inventory 렌더에서 `m.compat.source`에 따라 작은 라벨:
- `curated` → "큐레이션" (C.point, 가장 신뢰)
- `manager` → "Manager" (C.green dim, 내장본)
- `manager_live` → "Manager(실시간)" (C.green, 3층 fetch)
- 검색폴백(exact:false) → 기존 "검색"
- → 사용자가 출처를 알고 판단(PRD_v1.1 §2 정직성).

### 4. ★ B안: Manager 실시간 fetch (3층) — 내장본과 교차
앱에서 raw URL을 직접 fetch해서, 내장본(2층)에 없는 모델을 실시간으로 보강. 내장본과 교차검증.
```js
// 모듈 스코프: 실시간 Manager 데이터 캐시 (세션 1회 fetch)
let liveMgrCache = null;       // null=아직안받음, {}=받았으나비어있음, {...}=데이터
let liveMgrPromise = null;     // 중복 fetch 방지
const MGR_RAW_URL = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/model-list.json";

async function fetchLiveManager() {
  if (liveMgrCache) return liveMgrCache;
  if (liveMgrPromise) return liveMgrPromise;
  liveMgrPromise = (async () => {
    try {
      const res = await fetch(MGR_RAW_URL);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const map = {};
      for (const m of (data.models || [])) {
        const fn = m.filename || "";
        if (!fn) continue;
        const stem = fn.toLowerCase().replace(/\.[^.]+$/, "");
        map[stem] = { url: m.url || "", folder: m.save_path || "", size: m.size || "", name: m.name || "" };
      }
      liveMgrCache = map;
      return map;
    } catch (e) {
      liveMgrCache = {};   // 실패해도 캐시(재시도 안 함). 내장본으로 폴백.
      return {};
    }
  })();
  return liveMgrPromise;
}
```
- **교차검증 동작**: 모델 조회 시, 내장본(2층)에 있으면 그걸 쓰되, **실시간(3층)에도 조회해서 내장본에 없는 건 실시간으로 보강.** 실시간에 있는데 내장본에 없으면 → 콘솔/뱃지에 "내장본 갱신 필요" 신호(옵션).
- **언제 fetch**: JSON 분석 시 1회 백그라운드 fetch(비동기). 결과 오면 모델 카드 source 갱신. 네트워크 없으면 조용히 내장본만(폴백). 로딩 표시는 가볍게.
- **출처 뱃지**: 실시간으로 찾은 건 "Manager(실시간)"(C.green) / 내장본은 "Manager"(C.green dim). 둘 다 없으면 4층(web_search).
- 배포본에서도 작동(이건 공개 raw URL이라 키 불필요). 단 CORS — raw.githubusercontent.com은 CORS 허용됨(확인됨).

### 5. ★ B효용: 모델 web_search 폴백 (4층, researchNode 패턴을 모델로)
1·2·3층 다 없을 때만. `researchUnknownNode()` / web_search 흐름을 **모델에도** 적용:
- compatModelInfo가 exact:false(=어디에도 없음)인 모델 옆에 **"이 모델 검색"** 버튼 (AI_KEY 있을 때만, 노드와 동일 조건)
- 누르면 web_search로 "{파일명} huggingface download" 검색 → 실제 HF URL 찾기
- 결과: `URL · 검색됨`(violet) + 출처 표기. 못 찾으면 "검색해도 못 찾음 — 직접 확인"(정직)
- 상태 관리: 노드의 nodeResearch와 같은 패턴으로 modelResearch{} 추가
- **지어내지 않음**: 검색 결과에 실재하는 URL만. 확신 없으면 "확인 필요" 유지.
- 로컬(키 있음) 전용, 배포본 영향 0 (비용 가드 동일 원리).

### 6. reportToContext / buildBriefing — 출처 반영 (선택)
브리핑에 모델 출처가 들어가면 LLM이 "이건 Manager 출처, 이건 미확인" 구분 가능. 여유되면.

---

## 핵심 규칙 (회귀 방지)
- 1층(내 compat) 결과는 기존과 100% 동일 — source 필드만 추가. 회귀 0.
- Manager 내장본 없으면(파일 없음) 2층 건너뜀 — import 실패 안 나게 try 혹은 옵셔널 체이닝.
- 실시간 fetch(3층) 실패해도 내장본(2층)으로 폴백 — 네트워크 없어도 작동.
- web_search 폴백은 AI_KEY 있을 때만. 배포본에 버튼 안 보임.
- 교차검증: 1층과 2·3층 URL이 달라도 1층 우선(큐레이션 신뢰). 둘 다 보여주는 건 차후.

## 완료 기준
1. LTX/Wan 모델 중 Manager 내장본에 있는 것(umt5 등)이 "Manager" 출처로 직링크 뜸.
2. 내장본에 없고 실시간 Manager에만 있는 최신 모델 → "Manager(실시간)" 출처(네트워크 있을 때).
3. 1·2·3층 다 없는 모델(Ideogram4 등) + 키 있으면 "이 모델 검색" 버튼 → web_search로 URL 찾음.
4. 내 compat 57개는 "큐레이션" 출처로 기존과 동일(회귀 없음).
5. 네트워크 없어도(실시간 fetch 실패) 내장본으로 폴백, 안 깨짐.
6. Manager 파일 없어도 빌드/실행 안 깨짐.
7. npm run build 에러 없음.

## 갱신 대비책 (문서화 완료)
- 월 1회 `node scripts/update-model-list.mjs` → manager-model-list.json 갱신.
- 실시간 fetch(3층)가 내장본보다 최신이라, 갱신 늦어도 온라인이면 자동 보강.
- web_search 폴백 있어 갱신 늦어도 최신 모델은 검색이 메움.
- HISTORY.md에 갱신일 기록.

## 작업 후
- 변경 요약 보고 → /end (기록 + 커밋)
