import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiPhase } from "../types/csvGraph";
import { callVllmApi } from "../services/vllmService";

/**
 * Phase 분석용 프롬프트 생성
 */
function getPhaseAnalysisPrompt(
  dataPoints: { t: string; v: number | null }[],
  sensorType: CsvGraphJob["sensorType"],
  measurementRange: number | undefined
): string {
  let prompt: string;

  switch (sensorType) {
    /** ✅ PH 센서 */
    case "수질 (PH)":
      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (PH)' data. You MUST NOT identify individual points like Z1, S1.
**DATA & THRESHOLDS:**
- The data is a JSON array: \`{t: "ISO timestamp", v: numeric_value}\`.
- The sensor is a PH meter. Values cluster around 4, 7, and 10.
- Define value ranges:
  * \`ph4_range = [3.5, 5.0]\`
  * \`ph7_range = [6.5, 8.0]\`
**MISSION: SEQUENTIAL & ALTERNATING PHASE IDENTIFICATION**
**CRITICAL RULES:**
1.  **Strict Sequence & Gaps:** Find phases in order (Low Phase 1 -> High Phase 1 -> ...). A new phase MUST start after the previous one ends.
2.  **Noise Immunity:** Prioritize stable, sustained periods. Ignore brief spikes.
3.  **Phase Definitions:**
    *   A **Low Phase** is a STABLE and CONTINUOUS period of at least 60 seconds where all \`v\` are within \`ph4_range\`.
    *   A **High Phase** is a STABLE and CONTINUOUS period of at least 60 seconds where all \`v\` are within \`ph7_range\`.
    *   **CRITICAL "Low Phase 2" RULE:** This phase MUST be a HIGH phase (in ph7_range) and contain a continuous stable pH 7 period (휴직기, rest period) of at least 2 hours (7200 seconds). If not found, you MUST NOT identify "Low Phase 2".
**Execution Plan:**
1. Find "Low Phase 1".
2. Find "High Phase 1" after "Low Phase 1".
3. Find "Low Phase 2" (which is a High Phase at pH 7) after "High Phase 1", ensuring it meets its CRITICAL 2-hour rule.
4. Find "High Phase 2" after "Low Phase 2".
5. Find "Low Phase 3" after "High Phase 2".
6. Find "High Phase 3" after "Low Phase 3".
**FINAL OUTPUT:** Respond ONLY with a single JSON array of the phase objects you successfully identified.
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    /** ✅ SS 센서 */
    case "수질 (SS)":
      let ssThresholdDefinition: string;
      if (typeof measurementRange === "number" && measurementRange > 0) {
        ssThresholdDefinition = `
- The measurement range is ${measurementRange}.
- Define thresholds: high_threshold = ${measurementRange * 0.8}, low_threshold = ${
          measurementRange * 0.2
        }, medium_threshold_low = ${measurementRange * 0.4}, medium_threshold_high = ${
          measurementRange * 0.6
        }.
`;
      } else {
        ssThresholdDefinition = `
- First, find the absolute minimum (\`data_min\`) and maximum (\`data_max\`) values in the entire dataset.
- Define thresholds: high_threshold = data_min + (data_max - data_min) * 0.8, low_threshold = data_min + (data_max - data_min) * 0.2, medium_threshold_low = data_min + (data_max - data_min) * 0.4, medium_threshold_high = data_min + (data_max - data_min) * 0.6.
`;
      }
      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (SS)' data based on time. You MUST NOT identify individual points like Z1, S1.
**DATA & THRESHOLDS:**
- The data is a JSON array: \`{t: "ISO timestamp", v: numeric_value}\`.
${ssThresholdDefinition}
**MISSION: SEQUENTIAL & ALTERNATING PHASE IDENTIFICATION**
**CRITICAL RULES:**
1.  **Strict Sequence & Gaps:** Find phases in order. A new phase MUST start after the previous one ends.
2.  **Noise Immunity:** Prioritize stable, sustained periods. Ignore brief spikes.
3.  **Phase Definitions (Time-based):**
    *   A **Low Phase** is a STABLE and CONTINUOUS period of at least 30 minutes (1800 seconds) where all \`v\` are \`<= low_threshold\`.
    *   A **High Phase** is a STABLE and CONTINUOUS period of at least 30 minutes (1800 seconds) where all \`v\` are \`>= high_threshold\`.
    *   A **Medium Phase** is a period of at least 20 minutes (1200 seconds) where all \`v\` are between \`medium_threshold_low\` and \`medium_threshold_high\`.
    *   **CRITICAL "Low Phase 2" RULE:** This phase MUST be a LOW phase and contain a continuous stable low period (휴직기, rest period) of at least 2 hours (7200 seconds). If not found, you MUST NOT identify "Low Phase 2".
**Execution Plan:**
1. Find "Low Phase 1".
2. Find "High Phase 1" after "Low Phase 1".
3. Find "Low Phase 2" after "High Phase 1", ensuring it meets its CRITICAL 2-hour rule.
4. Find "High Phase 2" after "Low Phase 2".
5. Find "Low Phase 3" after "High Phase 2".
6. Find "High Phase 3" after "Low Phase 3".
7. Find one "Medium Phase 1" in the remaining data.
**FINAL OUTPUT:** Respond ONLY with a single JSON array of the phase objects you successfully identified.
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    /** ✅ 먹는물 (TU/Cl) */
    case "먹는물 (TU/Cl)":
    default:
      let drinkingWaterThresholdDefinition: string;
      let highPhaseUpperBoundRule = "";
      if (typeof measurementRange === "number" && measurementRange > 0) {
        drinkingWaterThresholdDefinition = `
- The measurement range for this instrument is ${measurementRange}.
- Define thresholds based on this range: high_threshold = ${
          measurementRange * 0.8
        }, low_threshold = ${measurementRange * 0.2}, medium_threshold_low = ${
          measurementRange * 0.4
        }, medium_threshold_high = ${measurementRange * 0.6}.
`;
        highPhaseUpperBoundRule = `AND \`v\` <= \`${measurementRange}\``;
      } else {
        drinkingWaterThresholdDefinition = `
- First, find the absolute minimum (\`data_min\`) and maximum (\`data_max\`) values in the entire dataset.
- Define thresholds: high_threshold = data_min + (data_max - data_min) * 0.8, low_threshold = data_min + (data_max - data_min) * 0.2, medium_threshold_low = data_min + (data_max - data_min) * 0.4, medium_threshold_high = data_min + (data_max - data_min) * 0.6.
`;
      }
      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to identify broad concentration phases from '먹는물 (TU/Cl)' data, following extremely strict rules.

**CONTEXT & THRESHOLDS:**
- The data is a JSON array: \`{t: "ISO timestamp", v: numeric_value}\`.
- The sensor type is '먹는물 (TU/Cl)'.
${drinkingWaterThresholdDefinition}

**CORE DIRECTIVE: ABSOLUTE VALUE RANGE COMPLIANCE**
A phase is valid ONLY if every single data point strictly fits its range.
If one value breaks the boundary, end the phase immediately.

**MISSION:**
1. Find "Low Phase 1" (\`v <= low_threshold\`, ≥60s)
2. Find "High Phase 1" (\`v >= high_threshold\` ${highPhaseUpperBoundRule}, ≥60s)
3. Find "Low Phase 2" (low phase with ≥7200s rest rule)
4. Find "High Phase 2"
5. Find "Low Phase 3"
6. Find "High Phase 3"
7. Find "Medium Phase 1" (\`medium_threshold_low <= v <= medium_threshold_high\`, ≥60s)
**FINAL OUTPUT:** Single JSON array of identified phases (no overlap, chronological).
Data:
${JSON.stringify(dataPoints)}
`;
      break;
  }
  return prompt;
}

/**
 * Phase 분석 실행 (Gemini / vLLM 전환 가능)
 */
export async function runPhaseAnalysis(job: CsvGraphJob): Promise<AiPhase[]> {
  if (!job.parsedData || !job.selectedChannelId) {
    throw new Error("Phase analysis requires parsed data and a selected channel.");
  }

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );
  if (selectedChannelIndex === -1) {
    throw new Error("Selected channel not found in parsed data.");
  }

  const dataPoints = job.parsedData.data
    .map((d) => ({ t: d.timestamp.toISOString(), v: d.values[selectedChannelIndex] }))
    .filter((d) => d.v !== null);

  const measurementRange = job.parsedData.measurementRange;
  const prompt = getPhaseAnalysisPrompt(dataPoints, job.sensorType, measurementRange);

  const apiMode = localStorage.getItem("apiMode") || "gemini";
  let resultJson: string;

  /** ✅ vLLM 모드 */
  if (apiMode === "vllm") {
    const messages = [{ role: "user" as const, content: prompt }];
    resultJson = await callVllmApi(messages, { json_mode: true });
  } else {
    /** ✅ Gemini 모드 */
    const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
    const phaseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        startTime: { type: Type.STRING },
        endTime: { type: Type.STRING },
      },
      required: ["name", "startTime", "endTime"],
    };
    const responseSchema = {
      type: Type.ARRAY,
      items: phaseSchema,
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    resultJson = response.text;
  }

  /** ✅ JSON Safeguard */
  const match = resultJson.match(/\[[\s\S]*\]|\{[\s\S]*\}/s);
  if (!match) throw new Error("No valid JSON found in response");
  const parsedResult = JSON.parse(match[0]) as AiPhase[];

  /** ✅ Phase 순서 정렬 */
  const phaseOrder = [
    "Low Phase 1",
    "High Phase 1",
    "Low Phase 2",
    "High Phase 2",
    "Low Phase 3",
    "High Phase 3",
    "Medium Phase 1",
  ];
  parsedResult.sort((a, b) => {
    const indexA = phaseOrder.indexOf(a.name);
    const indexB = phaseOrder.indexOf(b.name);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  return parsedResult;
}
