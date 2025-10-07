import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiPhase } from "../types/csvGraph";

/**
 * ✅ 단계 분석 프롬프트 (절대 수정 금지)
 */
function getPhaseAnalysisPrompt(
  dataPoints: { t: string; v: number | null }[],
  sensorType: CsvGraphJob["sensorType"],
  measurementRange: number | undefined
): string {
  let prompt: string;

  switch (sensorType) {
    case "수질 (PH)":
      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (PH)' data. You MUST NOT identify individual points like Z1, S1.
**DATA & THRESHOLDS:**
- The data is a JSON array: {t: "ISO timestamp", v: numeric_value}.
- The sensor is a PH meter. Values cluster around 4, 7, and 10.
- Define value ranges:
  * ph4_range = [3.5, 5.0]
  * ph7_range = [6.5, 8.0]
**MISSION: SEQUENTIAL & ALTERNATING PHASE IDENTIFICATION**
**CRITICAL RULES:**
1. Strict Sequence & Gaps: Find phases in order (Low Phase 1 -> High Phase 1 -> ...). A new phase MUST start after the previous one ends.
2. Noise Immunity: Prioritize stable, sustained periods. Ignore brief spikes.
3. Phase Definitions:
   * Low Phase: Continuous ≥60s, all v within ph4_range.
   * High Phase: Continuous ≥60s, all v within ph7_range.
   * CRITICAL Low Phase 2 RULE: Must be High phase at pH 7 with ≥2h (7200s) stable period.
**Execution Plan:**
1. Low Phase 1
2. High Phase 1
3. Low Phase 2 (2h rest)
4. High Phase 2
5. Low Phase 3
6. High Phase 3
**FINAL OUTPUT:** Respond ONLY with a single JSON array of phases you identified.
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "수질 (SS)":
      let ssThreshold: string;
      if (typeof measurementRange === "number" && measurementRange > 0) {
        ssThreshold = `
- Measurement range = ${measurementRange}.
- Define thresholds:
  high_threshold = ${measurementRange * 0.8}
  low_threshold = ${measurementRange * 0.2}
  medium_threshold_low = ${measurementRange * 0.4}
  medium_threshold_high = ${measurementRange * 0.6}
`;
      } else {
        ssThreshold = `
- Find data_min, data_max in dataset.
- Define thresholds using 0.8/0.2/0.4/0.6 ratios.
`;
      }

      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (SS)' data.
**DATA & THRESHOLDS:**
${ssThreshold}
**MISSION:**
- Low Phase ≥30min (v <= low_threshold)
- High Phase ≥30min (v >= high_threshold)
- Medium Phase ≥20min (v between medium_threshold_low & medium_threshold_high)
- Low Phase 2 must include 2-hour rest (7200s)
**FINAL OUTPUT:** Respond ONLY with JSON array of identified phases.
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "먹는물 (TU/Cl)":
    default:
      let tuDef: string;
      if (typeof measurementRange === "number" && measurementRange > 0) {
        tuDef = `
- Measurement range = ${measurementRange}.
- Define thresholds:
  high_threshold = ${measurementRange * 0.8}
  low_threshold = ${measurementRange * 0.2}
  medium_threshold_low = ${measurementRange * 0.4}
  medium_threshold_high = ${measurementRange * 0.6}
`;
      } else {
        tuDef = `
- Derive thresholds dynamically using data_min, data_max.
`;
      }

      prompt = `
You are a hyper-precise data analysis robot. Identify broad concentration phases from '먹는물 (TU/Cl)' data.

**THRESHOLDS:**
${tuDef}

**MISSION:**
1. Low Phase 1 (v <= low_threshold, ≥60s)
2. High Phase 1 (v >= high_threshold, ≥60s)
3. Low Phase 2 (2-hour rest rule)
4. High Phase 2
5. Low Phase 3
6. High Phase 3
7. Medium Phase 1

Respond ONLY with JSON array of identified phases.
Data:
${JSON.stringify(dataPoints)}
`;
      break;
  }

  return prompt;
}

/**
 * ✅ Phase 분석 실행 (Gemini 직접 호출)
 */
export async function runPhaseAnalysis(job: CsvGraphJob): Promise<AiPhase[]> {
  if (!job.parsedData || !job.selectedChannelId) {
    throw new Error("Phase analysis requires parsed data and a selected channel.");
  }

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );
  if (selectedChannelIndex === -1)
    throw new Error("Selected channel not found in parsed data.");

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

  const dataPoints = job.parsedData.data
    .map((d) => ({ t: d.timestamp.toISOString(), v: d.values[selectedChannelIndex] }))
    .filter((d) => d.v !== null);

  const prompt = getPhaseAnalysisPrompt(
    dataPoints,
    job.sensorType,
    job.parsedData.measurementRange
  );

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        startTime: { type: Type.STRING },
        endTime: { type: Type.STRING },
      },
      required: ["name", "startTime", "endTime"],
    },
  };

  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const text =
    (r as any).output_text ||
    (r as any).text ||
    (r as any).output?.[0]?.content?.parts?.[0]?.text ||
    "";

  if (!text.trim()) throw new Error("Empty response from Gemini model");

  const phases = JSON.parse(text) as AiPhase[];

  const order = [
    "Low Phase 1",
    "High Phase 1",
    "Low Phase 2",
    "High Phase 2",
    "Low Phase 3",
    "High Phase 3",
    "Medium Phase 1",
  ];
  phases.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  return phases;
}
