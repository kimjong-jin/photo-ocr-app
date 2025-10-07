import type { CsvGraphJob, AiPhase } from "../types/csvGraph";

/**
 * ✅ Phase 분석 프롬프트 생성기 (원문 보존 + 데이터 최적화)
 */
function getPhaseAnalysisPrompt(
  dataPoints: { t: string; v: number | null }[],
  sensorType: CsvGraphJob["sensorType"],
  measurementRange: number | undefined
): string {
  const safeJson = (arr: any[]) => JSON.stringify(arr.slice(0, 500));
  let prompt: string;

  switch (sensorType) {
    case "수질 (PH)":
      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (PH)' data. You MUST NOT identify individual points like Z1, S1.

**DATA & THRESHOLDS:**
- The data is a JSON array: \`{t: "ISO timestamp", v: numeric_value}\`.
- The sensor is a PH meter. Values cluster around 4, 7, and 10.
- Define value ranges:
  * ph4_range = [3.5, 5.0]
  * ph7_range = [6.5, 8.0]

**MISSION: SEQUENTIAL & ALTERNATING PHASE IDENTIFICATION**

**CRITICAL RULES:**
1. Strict Sequence & Gaps — phases must appear in logical order.
2. Noise Immunity — ignore short spikes, focus on stable regions.
3. Phase Definitions:
   - Low Phase: ≥60s where all v ∈ ph4_range
   - High Phase: ≥60s where all v ∈ ph7_range
   - Low Phase 2: must include continuous stable region (Δv/v ≤5%) lasting ≥7200s (2h) inside a high phase (pH≈7).

**Execution Plan:**
1. Low Phase 1 → High Phase 1 → Low Phase 2 → High Phase 2 → Low Phase 3 → High Phase 3

**FINAL OUTPUT:**
Respond ONLY with JSON array of phase objects.
Data:
${safeJson(dataPoints)}
`;
      break;

    case "수질 (SS)": {
      let ssThresholdDefinition: string;
      if (typeof measurementRange === "number" && measurementRange > 0) {
        ssThresholdDefinition = `
- The measurement range is ${measurementRange}.
- Define thresholds:
  high_threshold = ${measurementRange * 0.8},
  low_threshold = ${measurementRange * 0.2},
  medium_threshold_low = ${measurementRange * 0.4},
  medium_threshold_high = ${measurementRange * 0.6}.
`;
      } else {
        ssThresholdDefinition = `
- Compute data_min & data_max.
- Define thresholds:
  high_threshold = data_min + (data_max - data_min)*0.8,
  low_threshold = data_min + (data_max - data_min)*0.2,
  medium_threshold_low = data_min + (data_max - data_min)*0.4,
  medium_threshold_high = data_min + (data_max - data_min)*0.6.
`;
      }

      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (SS)' data.

**DATA & THRESHOLDS:**
${ssThresholdDefinition}

**RULES:**
- Low Phase: ≥1800s (30min) where v <= low_threshold
- High Phase: ≥1800s where v >= high_threshold
- Medium Phase: ≥1200s where v is between medium_threshold_low and medium_threshold_high
- Low Phase 2 must contain a rest period ≥7200s where Δv/v ≤5%

**Sequence:**
Low1 → High1 → Low2 → High2 → Low3 → High3 → Medium1

**FINAL OUTPUT:**
Return only JSON array of detected phases.
Data:
${safeJson(dataPoints)}
`;
      break;
    }

    default: {
      let drinkingWaterThresholdDefinition: string;
      let highPhaseUpperBoundRule = "";
      if (typeof measurementRange === "number" && measurementRange > 0) {
        drinkingWaterThresholdDefinition = `
- Measurement range: ${measurementRange}
- Thresholds:
  high_threshold = ${measurementRange * 0.8},
  low_threshold = ${measurementRange * 0.2},
  medium_threshold_low = ${measurementRange * 0.4},
  medium_threshold_high = ${measurementRange * 0.6}.
`;
        highPhaseUpperBoundRule = `AND v <= ${measurementRange}`;
      } else {
        drinkingWaterThresholdDefinition = `
- Compute data_min & data_max.
- Thresholds:
  high_threshold = data_min + (data_max - data_min)*0.8,
  low_threshold = data_min + (data_max - data_min)*0.2,
  medium_threshold_low = data_min + (data_max - data_min)*0.4,
  medium_threshold_high = data_min + (data_max - data_min)*0.6.
`;
      }

      prompt = `
You are a hyper-precise data analysis robot. Identify broad concentration phases from '먹는물 (TU/Cl)' data following strict logical rules.

**THRESHOLDS:**
${drinkingWaterThresholdDefinition}

**RULES:**
1. Low Phase 1 — ≥60s, all v <= low_threshold
2. High Phase 1 — ≥60s, all v >= high_threshold ${highPhaseUpperBoundRule}
3. Low Phase 2 — ≥60s, all v <= low_threshold AND includes rest period ≥7200s (Δv/v ≤5%)
4. High Phase 2 — ≥60s, all v >= high_threshold ${highPhaseUpperBoundRule}
5. Low Phase 3 — ≥60s, all v <= low_threshold
6. High Phase 3 — ≥60s, all v >= high_threshold ${highPhaseUpperBoundRule}
7. Medium Phase 1 — ≥60s, medium_threshold_low ≤ v ≤ medium_threshold_high

**FINAL OUTPUT:**
Return JSON array of phase objects:
[{ "name": string, "startTime": string, "endTime": string }]
Data:
${safeJson(dataPoints)}
`;
      break;
    }
  }

  return prompt;
}

/**
 * ✅ REST 기반 Phase 분석 실행 (Gemini 2.5 Flash)
 * - SDK 제거
 * - fetch() 직접 호출
 * - JSON 안정 파싱 및 속도 최적화
 */
export async function runPhaseAnalysis(job: CsvGraphJob): Promise<AiPhase[]> {
  if (!job.parsedData || !job.selectedChannelId)
    throw new Error("Phase analysis requires parsed data and a selected channel.");

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );
  if (selectedChannelIndex === -1)
    throw new Error("Selected channel not found in parsed data.");

  // ✅ 데이터 샘플링 + 소수점 제한
  const dataPoints = job.parsedData.data
    .filter((_, i) => i % 10 === 0)
    .map((d) => ({
      t: d.timestamp.toISOString(),
      v: Number(d.values[selectedChannelIndex]?.toFixed(4)),
    }))
    .filter((d) => d.v !== null && !isNaN(d.v));

  const measurementRange = job.parsedData.measurementRange;
  const prompt = getPhaseAnalysisPrompt(dataPoints, job.sensorType, measurementRange);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("❌ Gemini API key (VITE_GEMINI_API_KEY) not found.");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("❌ Gemini API Error:", err);
    throw new Error("Gemini API request failed.");
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

  if (!text) throw new Error("Empty response from Gemini model.");

  let result: AiPhase[];
  try {
    result = JSON.parse(text);
  } catch (err) {
    console.error("❌ JSON Parse Error:\n", text);
    throw new Error("Invalid JSON format returned by Gemini.");
  }

  // ✅ Phase 순서 정렬
  const phaseOrder = [
    "Low Phase 1",
    "High Phase 1",
    "Low Phase 2",
    "High Phase 2",
    "Low Phase 3",
    "High Phase 3",
    "Medium Phase 1",
  ];

  result.sort((a, b) => phaseOrder.indexOf(a.name) - phaseOrder.indexOf(b.name));

  return result;
}
