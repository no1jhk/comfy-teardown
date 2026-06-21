import React, { useState, useRef } from "react";

/* ──────────────────────────────────────────────────────────────
   Teardown v1.1 — 효용 A 프로토타입: 에러 로그 → LLM 맥락 진단
   목적: "룰이 못 잡는 임의 에러를, 이 워크플로 노드 구조와 결합해 진단"이
         실제로 쓸만한지 눈으로 확인.
   v1.0과 분리된 별도 프로토타입. report 간이 분석 + Claude API 직접 호출.
   ⚠ 아티팩트 환경 전용(api.anthropic.com 직접 호출). 배포는 프록시 필요.
   ────────────────────────────────────────────────────────────── */

const C = {
  bg: "#201926", surface: "#2A2333", surfaceHi: "#342C3F", line: "#3A3248",
  divider: "rgba(255,255,255,0.09)",
  text: "#C2BFB9", dim: "#A39BAE", faint: "#76707F",
  point: "#F4FF75", green: "#C1BFBA", amber: "#C1BFBA", red: "#EF5350",
};
const INK = "#1A1505";
const MONO = "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,Menlo,monospace";
const SANS = "Inter,ui-sans-serif,system-ui,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif";

const FRONTEND_ONLY = new Set(["Note", "MarkdownNote", "Reroute", "PrimitiveNode"]);
const MODEL_EXTS = [".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".onnx", ".glb", ".fbx", ".obj"];

function normalize(wf) {
  if (wf && Array.isArray(wf.nodes)) {
    return wf.nodes.map((n) => ({
      id: n.id, type: n.type, cnr_id: n.properties?.cnr_id ?? null,
      ver: n.properties?.ver ?? null, mode: n.mode ?? 0,
      widgets: Array.isArray(n.widgets_values) ? n.widgets_values : [],
    }));
  }
  if (wf && typeof wf === "object") {
    const e = Object.entries(wf).filter(([, v]) => v && v.class_type);
    if (e.length) return e.map(([id, v]) => ({
      id, type: v.class_type, cnr_id: null, ver: null, mode: 0,
      widgets: Object.values(v.inputs || {}).filter((x) => typeof x === "string"),
    }));
  }
  return null;
}

function buildContext(nodes) {
  const packs = {}, models = [], muted = [];
  const nodeTypes = new Set();
  for (const n of nodes) {
    nodeTypes.add(n.type);
    if (n.cnr_id) (packs[n.cnr_id] ||= new Set()).add(n.ver);
    if (n.mode === 2 || n.mode === 4) muted.push(`${n.type}(${n.mode === 4 ? "bypass" : "muted"})`);
    for (const w of n.widgets)
      if (typeof w === "string" && MODEL_EXTS.some((e) => w.toLowerCase().endsWith(e)))
        models.push(`${n.type}: ${w.replace(/\\/g, "/")}`);
  }
  return {
    totalNodes: nodes.length,
    nodeTypes: [...nodeTypes],
    packs: Object.entries(packs).map(([id, vs]) => `${id} [${[...vs].filter(Boolean).join(", ") || "ver?"}]`),
    models, muted,
  };
}

const SAMPLE_WF = JSON.stringify({
  nodes: [
    { id: 1, type: "Trellis2LoadModel", mode: 0, properties: { cnr_id: "comfyui-trellis2", ver: "a1b2c3d" }, widgets_values: ["flash_attn", "cuda"] },
    { id: 2, type: "HYMotionDiTLoader", mode: 0, properties: { cnr_id: "ComfyUI-HyMotion", ver: "b19a9ff" }, widgets_values: ["HY-Motion-1.0-Lite\\hyMotionLite.ckpt"] },
    { id: 3, type: "UniRigLoadRiggedMesh", mode: 0, properties: { cnr_id: "comfyui-unirig", ver: "1.3.2" }, widgets_values: ["Animated\\Spider.fbx"] },
    { id: 4, type: "HYMotionTextEncoderLoader", mode: 0, properties: { cnr_id: "ComfyUI-HyMotion", ver: "c1168e2" }, widgets_values: ["clip-vit-large-patch14.safetensors", "Qwen3-8B-Q8_0.gguf"] },
  ],
});

const SAMPLE_ERR = `Traceback (most recent call last):
  File "execution.py", line 151, in recursive_execute
    output_data, output_ui = get_output_data(obj, input_data_all)
  File "nodes_hymotion.py", line 88, in load_dit
    self.model.load_state_dict(sd)
RuntimeError: Error(s) in loading state_dict for HYMotionDiT:
	size mismatch for blocks.0.attn.qkv.weight: copying a param with shape torch.Size([3072, 1024]) from checkpoint, the shape in current model is torch.Size([2304, 768]).`;

export default function App() {
  const [wfText, setWfText] = useState("");
  const [errText, setErrText] = useState("");
  const [context, setContext] = useState(null);
  const [parseErr, setParseErr] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const fileRef = useRef(null);

  const analyzeWf = (text) => {
    setParseErr(null); setAiResult(null); setAiError(null);
    try {
      const nodes = normalize(JSON.parse(text));
      if (!nodes) throw new Error("ComfyUI 워크플로 형식이 아닙니다.");
      setContext(buildContext(nodes));
      setWfText(text);
    } catch (e) {
      setContext(null);
      setParseErr("JSON을 읽지 못했습니다. ComfyUI export가 맞는지 확인하세요.");
    }
  };

  const onFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => analyzeWf(String(r.result));
    r.readAsText(file);
  };

  const runAiDiagnosis = async () => {
    if (!context || !errText.trim()) return;
    setLoading(true); setAiError(null); setAiResult(null);

    const prompt = `당신은 ComfyUI 무거운 파이프라인(Trellis2/UniRig/HYMotion) 환경 디버깅 전문가입니다.
아래는 사용자가 실행하려는 워크플로의 구조 분석 결과와, 실행 중 발생한 에러 로그입니다.
이 에러를 **이 워크플로의 구체적인 노드·모델과 결합해서** 진단하세요. 일반론이 아니라 "당신의 OO 노드가/이 모델이" 식으로 짚어야 합니다.

[워크플로 구조]
- 전체 노드 수: ${context.totalNodes}
- 노드 타입: ${context.nodeTypes.join(", ")}
- 설치된 pack(버전): ${context.packs.join(" / ") || "없음"}
- 참조 모델·자산: ${context.models.join(" / ") || "없음"}
- 비활성 노드: ${context.muted.join(", ") || "없음"}

[에러 로그]
${errText}

다음 JSON 형식으로만 답하세요. 마크다운·코드펜스 없이 순수 JSON만:
{
  "title": "한 줄 진단 제목 (이 워크플로 맥락 반영)",
  "severity": "high|mid|low",
  "rootCause": "근본 원인. 워크플로의 어느 노드·모델과 연결되는지 명시",
  "relatedNode": "관련 노드 타입 (워크플로에 실제 있는 것)",
  "fixes": ["구체적 해결 단계 1", "단계 2", "단계 3"],
  "command": "실행할 명령어 (있으면, 없으면 빈 문자열)",
  "confidence": "high|mid|low",
  "caveat": "확신이 낮거나 추가 확인이 필요하면 솔직하게. 없으면 빈 문자열"
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const textOut = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = textOut.replace(/```json|```/g, "").trim();
      setAiResult(JSON.parse(clean));
    } catch (e) {
      setAiError("AI 진단 호출 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const sevColor = (s) => (s === "high" ? C.red : s === "mid" ? C.amber : C.faint);
  const sevLabel = (s) => (s === "high" ? "CRITICAL" : s === "mid" ? "WARNING" : "INFO");
  const confLabel = (c) => (c === "high" ? "확신 높음" : c === "mid" ? "확신 보통" : "확신 낮음 — 검증 권장");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: SANS, padding: "32px 24px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
        .btn{transition:transform .12s,background .15s,color .15s}
        .btn:hover{transform:translateY(-1px)}
        .spin{animation:sp 0.8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
      `}</style>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: C.point, letterSpacing: "0.04em", marginBottom: 6 }}>TEARDOWN · v1.1 PROTOTYPE</div>
        <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 30, fontWeight: 700, color: C.text, margin: "0 0 8px", letterSpacing: "-0.02em" }}>AI 정밀 진단 — 효용 A</h1>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, margin: "0 0 28px" }}>
          룰이 못 잡는 임의 에러를, <b style={{ color: C.text }}>이 워크플로의 노드·모델 구조와 결합</b>해 진단합니다.
          ChatGPT에 에러만 붙여넣는 것과 다른 지점 — 워크플로 컨텍스트가 함께 들어갑니다.
        </p>

        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>1. 워크플로 JSON</div>
            <div style={{ display: "flex", gap: 10 }}>
              <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
              <button className="btn" onClick={() => fileRef.current?.click()} style={{ background: C.point, color: INK, border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>파일 선택</button>
              <button className="btn" onClick={() => analyzeWf(SAMPLE_WF)} style={{ background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>샘플</button>
            </div>
          </div>
          {context ? (
            <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>
              <span style={{ color: C.green }}>✓ 분석됨</span> · 노드 {context.totalNodes} · pack {context.packs.length} · 모델 {context.models.length}
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.faint, marginTop: 6, lineHeight: 1.6 }}>{context.nodeTypes.join(" · ")}</div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: C.faint }}>{parseErr || "워크플로를 올리거나 샘플을 눌러 시작하세요."}</div>
          )}
        </div>

        {context && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: C.text }}>2. 에러 로그 (빨간 줄)</div>
              <button className="btn" onClick={() => setErrText(SAMPLE_ERR)} style={{ background: "transparent", color: C.dim, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, cursor: "pointer" }}>샘플 에러</button>
            </div>
            <textarea value={errText} onChange={(e) => setErrText(e.target.value)} spellCheck={false}
              placeholder="터미널의 마지막 Traceback 블록을 붙여넣으세요."
              style={{ width: "100%", minHeight: 110, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, outline: "none" }} />
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              <button className="btn" onClick={runAiDiagnosis} disabled={!errText.trim() || loading}
                style={{ width: 320, maxWidth: "100%", border: `1px solid ${C.point}`, color: errText.trim() && !loading ? C.point : C.faint, background: errText.trim() && !loading ? "transparent" : "#30293b", borderRadius: 999, padding: "13px 0", fontSize: 14, fontWeight: 700, cursor: errText.trim() && !loading ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {loading ? <><span className="spin" style={{ width: 14, height: 14, border: `2px solid ${C.faint}`, borderTopColor: "transparent", borderRadius: "50%", display: "inline-block" }} /> 진단 중…</> : "AI 정밀 진단 실행"}</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: C.faint, textAlign: "center", lineHeight: 1.5 }}>
              워크플로 구조 + 에러를 Claude에 함께 전달합니다. (프로토타입 · 아티팩트 환경 전용)
            </div>
          </div>
        )}

        {aiError && (
          <div style={{ background: "rgba(239,83,80,0.08)", border: `1px solid ${C.red}55`, borderRadius: 12, padding: "13px 16px", fontSize: 13.5, color: C.text, marginBottom: 14 }}>{aiError}</div>
        )}

        {aiResult && (
          <div style={{ background: C.surface, border: `1.5px solid ${C.point}`, borderRadius: 18, padding: "22px 30px", boxShadow: `0 0 0 4px rgba(244,255,117,0.06)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: aiResult.severity === "high" ? C.red : INK, background: aiResult.severity === "high" ? "rgba(239,83,80,0.12)" : sevColor(aiResult.severity), borderRadius: 6, padding: "5px 9px", letterSpacing: "0.02em" }}>{sevLabel(aiResult.severity)}</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: C.text, flex: 1, letterSpacing: "-0.01em" }}>{aiResult.title}</span>
            </div>

            {aiResult.relatedNode && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surfaceHi, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", marginBottom: 14 }}>
                <span style={{ fontSize: 11.5, color: C.faint }}>관련 노드</span>
                <span style={{ fontFamily: MONO, fontSize: 13, color: C.point }}>{aiResult.relatedNode}</span>
              </div>
            )}

            <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.65, marginBottom: 18 }}>{aiResult.rootCause}</div>

            <div>
              {aiResult.fixes?.map((fx, k) => (
                <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 0", borderTop: k > 0 ? `1px solid ${C.divider}` : "none" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: C.point, color: INK, fontSize: 14, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{k + 1}</div>
                  <span style={{ fontSize: 16, color: C.text, lineHeight: 1.55, paddingTop: 2 }}>{fx}</span>
                </div>
              ))}
            </div>

            {aiResult.command && (
              <div style={{ marginTop: 16, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}>
                <pre style={{ margin: 0, fontFamily: MONO, fontSize: 12.5, color: C.text, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{aiResult.command}</pre>
              </div>
            )}

            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.divider}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: aiResult.confidence === "high" ? C.green : aiResult.confidence === "mid" ? C.amber : C.red }}>● {confLabel(aiResult.confidence)}</span>
              {aiResult.caveat && <span style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>{aiResult.caveat}</span>}
            </div>
          </div>
        )}

        <p style={{ marginTop: 40, fontSize: 11.5, color: C.faint, textAlign: "center", lineHeight: 1.6 }}>
          프로토타입 — 효용 A(에러→LLM 맥락 진단) 검증용. v1.0 룰 진단의 fallback/심화 레이어로 통합 예정.<br />
          Teardown · Built by Joon Hyung Kim
        </p>
      </div>
    </div>
  );
}
