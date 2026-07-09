// P2.7 — 내 모델 폴더 대조. 순수 함수(브라우저·node 공용).
// 도구는 PC를 직접 못 보므로: 읽기전용 나열 명령(스니펫) → 사용자가 붙여넣은 목록 → modelPlan 요구와 대조 → 완비 판정.
// 불변: 붙여넣지 않으면 대조하지 않는다(입력 없인 판정 금지). 명령은 읽기만(dir/ls 계열), 쓰기·삭제 없음.

const baseName = (v) => (v || "").replace(/\\/g, "/").split("/").pop().toLowerCase();

// "26.3GB"/"484MB"/"137KB" → GB(십진). modelPlan.sizeToGB와 동일 규약(GB as-is, MB/1000).
function sizeToGB(s) {
  if (!s) return null;
  const m = String(s).match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
  if (!m) return null;
  const v = parseFloat(m[1]); const u = m[2].toUpperCase();
  return u === "TB" ? v * 1000 : u === "GB" ? v : u === "MB" ? v / 1000 : v / 1e6;
}

// 폴더 스캔 출력 텍스트 → Map(파일명소문자 → {size:bytes|null, folder}).
// PowerShell(부모\파일<TAB>바이트) · bash(전체경로<TAB>바이트) · 사람이 붙인 KB/MB/GB 혼용 모두 허용.
// 대소문자 무시, 경로 구분자(\ /) 혼용 허용, 크기 단위 정규화.
export function parseFolderScan(text) {
  const inv = new Map();
  if (!text) return inv;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const norm = line.replace(/\\/g, "/");
    // 파일 토큰: 모델 확장자로 끝나는 경로/파일명. 탭·2칸+ 공백으로 열 분리 우선(구조적), 없으면 전체 스캔.
    const cols = norm.split(/\t|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    let fileTok = null;
    for (const c of (cols.length ? cols : [norm])) {
      const mm = c.match(/(\S*\.(?:safetensors|ckpt|pth|pt|gguf|bin|sft|onnx|vae|pte|npz))\b/i);
      if (mm) { fileTok = mm[1]; break; }
    }
    if (!fileTok) continue;
    const segs = fileTok.split("/").filter(Boolean);
    const filename = segs[segs.length - 1].toLowerCase();
    const folder = segs.length > 1 ? segs[segs.length - 2].toLowerCase() : "";
    // 크기: 단위형(TB/GB/MB/KB/B) 우선, 없으면 파일 토큰 제거 후 4자리+ 정수(바이트)의 최댓값.
    let size = null;
    const um = norm.match(/(\d[\d,]*(?:\.\d+)?)\s*(TB|GB|MB|KB|B)\b/i);
    if (um) {
      const v = parseFloat(um[1].replace(/,/g, "")); const u = um[2].toUpperCase();
      const mult = u === "TB" ? 1e12 : u === "GB" ? 1e9 : u === "MB" ? 1e6 : u === "KB" ? 1e3 : 1;
      size = Math.round(v * mult);
    } else {
      const nums = (norm.replace(fileTok, "").match(/\d{4,}/g) || []).map(Number);
      if (nums.length) size = Math.max(...nums);
    }
    const prev = inv.get(filename);
    if (!prev || (size && !prev.size)) inv.set(filename, { size, folder });
  }
  return inv;
}

// modelPlan 요구 항목과 붙여넣은 목록 대조.
// 반환: results[{file, held, corrupt, parsedSize, expected}] · heldSet · complete · scanned.
// complete(구조상 준비 완료 판정 근거) = 스캔됨 + 요구(items)>0 + 전부 보유 + 크기 이상 없음 + 확인필요(unknowns) 0.
// corrupt(137KB 사태 클래스): 크기가 파싱됐고 기대 용량의 10% 미만.
export function reconcileInventory(plan, invMap) {
  const items = plan?.items || [];
  const scanned = invMap.size > 0;
  const results = items.map((it) => {
    const key = it.selectedFile || baseName(it.workflowValue);
    const hit = invMap.get(key) || invMap.get(baseName(it.workflowValue));
    const held = !!hit;
    let corrupt = false;
    if (hit && hit.size && it.size) {
      const expBytes = (sizeToGB(it.size) || 0) * 1e9;
      if (expBytes && hit.size < expBytes * 0.1) corrupt = true;
    }
    return { file: key, held, corrupt, parsedSize: hit ? hit.size : null, expected: it.size || null };
  });
  const heldSet = new Set(results.filter((r) => r.held).map((r) => r.file));
  const complete = scanned && items.length > 0 && results.every((r) => r.held && !r.corrupt) && (plan?.unknowns?.length || 0) === 0;
  return { results, heldSet, complete, scanned };
}

// 환경 수집 스니펫(읽기전용 나열만). os: "win" | "unix". modelRoot 없으면 기본 ComfyUI 모델 폴더 대상.
// 출력 형식: "<폴더 또는 경로>\t<바이트>" 한 줄에 파일 하나 → parseFolderScan이 파싱.
export function buildScanSnippet(modelRoot, os) {
  const root = (modelRoot || "").trim();
  if (os === "win") {
    const target = root || "ComfyUI\\models";
    // Get-ChildItem 읽기 전용 나열(부모폴더\파일명 + 바이트). 경로 따옴표로 공백·한글 방어.
    return 'Get-ChildItem -LiteralPath "' + target + '" -Recurse -File | ForEach-Object { "$($_.Directory.Name)\\$($_.Name)`t$($_.Length)" }';
  }
  const target = root || "ComfyUI/models";
  // find + wc -c 읽기 전용(전체경로 + 바이트). 경로 따옴표로 공백·한글 방어.
  return "find \"" + target + "\" -type f -exec sh -c 'printf \"%s\\t%s\\n\" \"$1\" \"$(wc -c <\"$1\")\"' _ {} \\;";
}
