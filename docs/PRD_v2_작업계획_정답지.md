# Teardown v2 — 작업 계획 + 테스트 정답지 (실행용)

> 2026-06-26. v2(환경 진단) 구현 단계 + 측정용 테스트 세트/정답지.

---

## 0. 가설 (측정 대상)

**"기초정보(워크플로 구조+환경+에러+룰 힌트)를 깔아 LLM에 보내면, 캡처 노가다보다 성공률·속도가 오른다."**

- 강하게 맞음: 맥락 풍부 → LLM 답 질 상승
- 과대평가 주의: "다 해결"은 환상. 진짜 새 문제는 LLM도 모름.
- 정직한 기대치: 풀던 걸 더 빠르고 확실하게 + 일부 새 문제 추가.
- 성공률 예상: 흔한 환경문제 ~90%(룰) / 알려진 패턴 변형 ~70%(LLM+맥락) / 진짜 새 문제 ~30~40%
- → 5단계(실측)가 핵심. 감이 아니라 숫자.

---

## 1. 작업 단계 + 시간 추정 (순수 작업시간)

| 단계 | 내용 | 시간 | 핵심도 |
|---|---|---|---|
| 1 | 데이터 층(A) — compatibility.json 탑재 + Manager 맵 연동. "출처 미상"·"허깅페이스 검색" → 정확한 출처·직링크 | 3~5h | ★★★ |
| 2 | 환경 입력 UI(B입력) — +/− 토글 입력칸 + 명령어 팝업 + ComfyUI 로그 붙여넣기 칸 | 2~3h | ★★ |
| 3 | 환경 파싱+룰 대조(B진단) — torch/cuda/flash_attn/GPU 추출 → 대조 → 확정 진단 | 4~6h | ★★★★ |
| 4 | LLM 폴백 개조 — 반쪽 프롬프트 → JSON+환경+에러+룰힌트 완성 브리핑 | 2~3h | ★★★ |
| 5 | 테스트 세트 성공률 측정 | 3~4h | ★★★★ |
| | 합계 | 14~21h | |

- 정공법 1→2→3→4→5 / 빠른 검증은 4번부터

---

## 2. 환경별 양자화 호환성 규칙 (B층 핵심 룰)

| 양자화 | Ampere(30xx) | Ada(40xx) | Blackwell(50xx) |
|---|---|---|---|
| fp8_scaled / fp8_e4m3fn | ❌ 미지원 | ✅ | ✅ |
| fp4_mixed / mxfp8 | ❌ | △ | ✅ |
| GGUF (Q4/Q8) | ✅ 권장 | ✅ | ✅ |
| bf16 | ✅ | ✅ | ✅ |

**룰: Ampere + fp8/fp4/mxfp8 → "GGUF로 교체" 확정 조치.**

---

## 3. 테스트 세트 + 정답지 (환경 가정: 집 RTX 3090 Ampere 24GB)

### T1. Ideogram40_Layout_builder (대조군·가벼움)
- 노드 8, comfy-core만. 모델 5개 전부 fp8_scaled.
- 정답: fp8_scaled×5 → Ampere 위험(GGUF 대안 없음). `flux2\flux2-vae` (\) 경고. 효용 ★☆ (대조군).

### T2. Bernini_workflow_Deno (Wan2.2)
- 노드 37. KJNodes, deno-custom-nodes(버전충돌 0.7.26/0.7.28), VideoHelper.
- 모델: Wan22 mxfp8×2, umt5 fp8, wan_2.1_vae, lightx2v lora bf16.
- 정답: mxfp8+fp8 → Ampere 위험. SetNode/GetNode→KJNodes(확정). deno 버전충돌 경고. `WanVideo\..`(\) 경고. Wan22_Bernini=개인 파인튜닝→Manager에 없음→"못 찾음" 정직 표기.

### T3. LTX2_3_8GB_VRAM_workflow
- 노드 60. LTXVideo, KJNodes, VFI, nvidia_rtx_nodes, memory_cleanup.
- 모델 혼재: dev(풀), fp8_scaled transformer, Q4_K_M.gguf, gemma fp4_mixed, vae bf16.
- 정답: fp8+fp4 → Ampere 위험. 단 Q4_K_M.gguf 포함 → "fp8/fp4 대신 GGUF 경로 써라" 확정. VRAM 8GB 타깃이나 22B→3090 OK/3060 빡빡. 효용 ★★★★(집에서 막힘).

### T4. LTX2_3_8GB_Audio_to_Video
- T3 + MelBandRoFormer(오디오, 흔치 않은 노드).
- 정답: T3 + MelBandRoFormer 별도 설치 안내. MelBandRoformer_fp16 출처.

### T5. Ltx2_3_LipSync_GGUF (★ 미해결 핵심)
- 노드 47. comfyui-gguf, KJNodes, MelBandRoFormer, VideoHelper, frame-interpolation.
- 모델: ltx Q8_0.gguf, gemma Q4_K_XL.gguf(둘 다 GGUF=올바름), vae bf16, rife49.pth.
- 정답: GGUF만→Ampere 호환 OK(양자화 문제 아님). 사용자 기록: gemma safetensors JSONDecodeError 미해결 → 런타임 문제 → 룰 못 잡음 → B폴백(완성 브리핑→LLM). comfyui-gguf 노드 필수 확인. **룰한계→LLM폴백 검증 핵심 케이스.**

### T6. Silent_Snow_LTX2_3_Full (고사양)
- 노드 20. rgthree. 모델: dev(풀), distilled-lora, gemma fp4_mixed, spatial-upscaler.
- 정답: fp4_mixed + 풀 dev → Ampere 위험 + VRAM 압박. GGUF 강력 권장. 효용 ★★★★.

### T7. SCAIL_Auto_Extend_V3
- 노드 59. KJNodes(23), scail-auto-extend, VFI, essentials, rmbg.
- 모델: SCAIL_2 fp8_scaled, lightx2v lora bf16, umt5 fp8, sam3.1 fp16, film_net, clip_vision.
- 정답: fp8_scaled → Ampere 위험. SCAIL-2 nightly/master 빌드 요구(룰). scail-auto-extend(Brobert-in-aus) 수동 설치.

### T8. PixelArtistry_Rig_AnimWorkflow (Trellis 헤비)
- 팩: Trellis2, UniRig, HY-Motion×2, geometrypack, rmbg, kjnodes.
- 정답: HEAVY_PIPELINE_RULES.md 전체 — Torch 2.8+cu128, flash_attn+spconv+nvdiffrast, 노드 위치, comfy_env/pixi, Developer Mode, 단계별 실행.

### T9. PixelArtistry_Skintoken (default/Anim)
- 팩: ComfyUI-SkinTokens(Aero-Ex), HY-Motion, comfy-core(Load3D).
- 모델: SkinTokens grpo ckpt, Qwen3-8B-Q8_0.gguf.
- 정답: SkinTokens 신규팩 출처(Aero-Ex/ComfyUI-SkinTokens). "Headless (Blender)" 위젯→Blender 설치 의존성 경고. Load3D=comfy-core(설치 불필요).

---

## 4. 채점 (5단계)

케이스별: 양자화 진단 정확? / 출처·직링크 정확? / 환경경고 정확? / (해결불가는) 완성 브리핑 품질?
- 성공률 = 정답 일치 항목 / 전체. 케이스별 + 평균.
- 목표: 흔한 환경문제 80%+ = 룰 검증 성공. T5 완성브리핑을 실제 LLM에 넣어 풀리면 = 가설 최종 검증.

---

## 5. 정직한 갭

- 개인 파인튜닝 모델(Wan22_Bernini, SCAIL_2)은 Manager에도 없어 직링크 못 줌 → "못 찾음"이 정답.
- T5 JSONDecodeError 등 런타임 버그는 룰 못 잡음 → 폴백 품질로 평가.
- compatibility.json은 10노드뿐 → 신규 노드(SkinTokens, scail, MelBand)는 web_search/수동 보강 필요.
