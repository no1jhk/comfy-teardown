# Teardown — C효용: 설치 스크립트 .sh/.bat 생성 (PRD v1.1 마지막 퍼즐)

> VS Code Claude Code용. 대상: src/Teardown.jsx
> 배경: PRD_v1.1의 효용 C(★핵심)인데 유일하게 미구현. 이번에 완성.
> 핵심: buildPrescription에 이미 모인 정보(노드 repo + 모델 직링크 + 폴더 + 환경우회)를
>      OS별 스크립트 한 덩어리로 조립. 새 데이터 수집 불필요.

---

## 목표

분석된 워크플로를 **복사→한 번 실행**으로 설치되는 스크립트로 출력.
- 노드 N개 git clone (custom_nodes에)
- 모델 M개 다운로드 (확정 URL → 지정 폴더에, 폴더 자동 생성)
- 환경 우회 안내 (flash_attn→sdpa는 코드 수정이라 주석으로 안내)
- OS별 `.sh`(Mac/Linux) / `.bat`(Windows) 두 버전.

## 정직성 (PRD_v1.1 §2 — 매우 중요)
- **확정된 URL만 스크립트에 넣는다.** exact:false(검색폴백·미확인)는 스크립트에서 제외하고 주석으로 "수동 확인 필요" 표기.
- 가짜 URL 절대 안 만듦. 모르면 주석 처리.
- flash_attn 우회는 자동 실행 위험 → 실행 명령이 아니라 **주석 안내**로.

---

## 구현

### 1. 스크립트 생성 함수 (buildPrescription 근처, 컴포넌트 밖)
```js
// 처방 정보 → OS별 설치 스크립트 문자열 생성.
// 확정 URL만 포함, 미확인은 주석 처리. (PRD_v1.1 §2 정직성)
function buildInstallScript(report, envGpu, os /* "sh" | "bat" */) {
  const isWin = os === "bat";
  const L = [];
  const cmt = isWin ? "REM" : "#";

  // 헤더
  L.push(isWin ? "@echo off" : "#!/bin/bash");
  L.push(`${cmt} Teardown 설치 스크립트 — ${report.source}`);
  L.push(`${cmt} 생성: ${new Date().toISOString().slice(0,10)}`);
  L.push(`${cmt} 주의: ComfyUI 루트에서 실행. 한 줄씩 확인 권장.`);
  L.push("");

  // 1) 커스텀 노드 clone
  const repos = new Set();
  for (const p of report.packs) if (!p.isCore && p.repo) repos.add(p.repo);
  for (const u of report.unmapped) if (u.repo) repos.add(u.repo);
  if (repos.size) {
    L.push(`${cmt} === 커스텀 노드 ${repos.size}개 ===`);
    L.push(isWin ? "cd custom_nodes" : "cd custom_nodes || exit 1");
    for (const rp of repos) L.push(`git clone https://github.com/${rp}`);
    L.push(isWin ? "cd .." : "cd ..");
    L.push("");
  }
  const unknownNodes = report.unmapped.filter((u) => !u.repo).length;
  if (unknownNodes) {
    L.push(`${cmt} 출처 미상 노드 ${unknownNodes}개: Manager의 "Install Missing Custom Nodes"로 설치.`);
    L.push("");
  }

  // 2) 모델 다운로드 (확정 URL만)
  const dl = report.models.filter((m) => WEIGHT_EXTS.some((e) => m.file.toLowerCase().endsWith(e)));
  if (dl.length) {
    L.push(`${cmt} === 모델 ${dl.length}개 ===`);
    for (const m of dl) {
      const info = m.compat; // {url, exact, folder, source} — compatModelInfo 결과
      const folder = (info && info.folder) || m.folder || "models";
      const fname = m.file.replace(/\\/g, "/").split("/").pop();
      if (info && info.exact && info.url) {
        // 폴더 생성 + 다운로드 (curl/wget)
        L.push(isWin ? `if not exist "models\\${folder}" mkdir "models\\${folder}"` : `mkdir -p "models/${folder}"`);
        L.push(isWin
          ? `curl -L -o "models\\${folder}\\${fname}" "${info.url}"`
          : `curl -L -o "models/${folder}/${fname}" "${info.url}"`);
      } else {
        // 미확인 → 주석 (정직성: 가짜 URL 금지)
        L.push(`${cmt} [수동] ${fname} → models/${folder} (URL 미확인. "이 모델 검색"으로 찾으세요)`);
      }
    }
    L.push("");
  }

  // 3) 환경 우회 (실행 아닌 안내 주석)
  const flash = report.portability.filter((h) => h.value === "flash_attn");
  if (flash.length) {
    L.push(`${cmt} === 환경 우회 (수동) ===`);
    for (const h of flash) L.push(`${cmt} ${h.node}: attention을 flash_attn → sdpa 로 변경 (노드 설정 또는 코드).`);
    L.push("");
  }

  L.push(`${cmt} 완료. ComfyUI 재시작 후 워크플로 로드.`);
  return L.join(isWin ? "\r\n" : "\n");
}
```

### 2. UI — Solution 하단에 "설치 스크립트 생성" 버튼
- 위치: Solution 섹션 맨 아래 (처방 단계들 뒤).
- 버튼 2개: ".sh (Mac/Linux)" / ".bat (Windows)" — 또는 토글.
- 누르면 코드블록으로 스크립트 표시 + "복사" 버튼 + "다운로드"(.sh/.bat 파일로).
- 스타일: 기존 command 코드블록(C.bg, MONO 12px) 재사용.
- 미확인 모델 있으면 상단에 작은 경고: "URL 미확인 N개는 주석 처리됨 — 직접 확인 필요."

### 3. 다운로드 기능
```js
function downloadScript(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
// .sh는 filename "install.sh", .bat은 "install.bat"
```

---

## 핵심 규칙
- **확정 URL만 실행문**. 미확인은 `#`/`REM` 주석 + "수동 확인" 표기. 가짜 URL 0.
- flash_attn 우회는 자동 실행 안 함(주석 안내만) — 코드 수정이라 위험.
- 기존 buildPrescription·compatModelInfo 결과 재사용. 새 데이터·새 네트워크 호출 0.
- 배포본에서도 작동(스크립트 생성은 순수 문자열, API 불필요).

## 완료 기준
1. 분석 후 Solution 하단 "설치 스크립트 생성" 버튼 → .sh/.bat 코드블록 출력.
2. 확정 URL 모델은 `curl -L -o` 실행문, 미확인은 주석 처리(가짜 URL 없음).
3. 노드는 git clone, 폴더는 mkdir -p(또는 if not exist mkdir)로 자동 생성.
4. flash_attn은 주석 안내(실행문 아님).
5. 복사 + 다운로드(install.sh/install.bat) 동작.
6. npm run build 에러 없음.

## 작업 후
- 변경 요약 → /end
- 실제 워크플로(LTX 등)로 스크립트 생성해보고, curl 문이 말이 되는지 육안 검토.
