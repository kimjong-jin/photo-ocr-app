import { Type } from "@google/genai";
import type { CsvGraphJob, AiPhase } from "../types/csvGraph";
import { getGenAIClient } from "../services/geminiService"; // ✅ 공용 Gemini 클라이언트

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
   - Low Phase: STABLE and CONTINUOUS ≥60s where all v ∈ ph4_range
   - High Phase: STABLE and CONTINUOUS ≥60s where all v ∈ ph7_range
   - Low Phase 2 must contain a rest period (stable pH7) ≥2h (7200s)
**Execution Plan:**
1. Low Phase 1
2. High Phase 1
3. Low Phase 2 (with rest period)
4. High Phase 2
5. Low Phase 3
6. High Phase 3
**FINAL OUTPUT:** Single JSON array of identified phases.
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "수질 (SS)":
      const rangePart =
        typeof measurementRange === "number" && measurementRange > 0
          ? `
- Measurement range: ${measurementRange}.
- Thresholds: high = ${measurementRange * 0.8}, low = ${
              measurementRange * 0.2
            }, medium_low = ${measurementRange * 0.4}, medium_high = ${
              measurementRange * 0.6
            }.
`
          : `
- Find data_min and data_max.
- Define thresholds using 0.2, 0.4, 0.6, 0.8 ratios between min and max.
`;

      prompt = `
You are a hyper-precise data analysis robot. Your mission is to find concentration phases from '수질 (SS)' data.
**DATA & THRESHOLDS:**
- JSON: {t: "ISO timestamp", v: numeric_value}.
${rangePart}
**CRITICAL RULES:**
1. Sequential: Low → High → Low → High → Low → High (+ Medium)
2. Stable periods only (ignore spikes).
3. Low Phase 2 must include ≥2h rest period (7200s).
**FINAL OUTPUT:** JSON array of identified phases.
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "먹는물 (TU/Cl)":
    default:
      const dynamicRange =
        typeof measurementRange === "number" && measurementRange > 0
          ? `
- Measurement range: ${measurementRange}.
- Thresholds: high=${measurementRange * 0.8}, low=${measurementRange * 0.2},
  medium_low=${measurementRange * 0.4}, medium_high=${measurementRange * 0.6}.
`
          : `
- Auto-derive thresholds from min/max values (0.2–0.8 fractions).
`;

      prompt = `
You are a strict phase detector for '먹는물 (TU/Cl)'.
${dynamicRange}

**Rules:**
1. Each phase = continuous period where ALL points fit within thresholds.
2. If any value breaks the threshold → terminate current phase immediately.
3. Identify phases in exact order:
   Low1 → High1 → Low2 (rest 2h) → High2 → Low3 → High3 → Medium1
**FINAL OUTPUT:** JSON array of all valid phases.
Data:
${JSON.stringify(dataPoints)}
`;
      break;
  }

  return prompt;
}

export async function runPhaseAnalysis(job: CsvGraphJob): Promise<AiPhase[]> {
  if (!job.parsedData || !job.selectedChannelId) {
    console.error("❌ Missing parsed data or selected channel.");
    return [];
  }

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );

  if (selectedChannelIndex === -1) {
    console.warn("⚠️ Selected channel not found. Skipping.");
    return [];
  }

  // ✅ Gemini 클라이언트 불러오기 (자동 키 포함, 재시도 적용)
  const ai = getGenAIClient();

  const dataPoints = job.parsedData.data
    .map((d) => ({
      t: d.timestamp.toISOString(),
      v: d.values[selectedChannelIndex],
    }))
    .filter((d) => d.v !== null);

  const prompt = getPhaseAnalysisPrompt(
    dataPoints,
    job.sensorType,
    job.parsedData.measurementRange
  );

  const responseSchema = {
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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const jsonText =
      (response as any).output_text ||
      (response as any).output?.[0]?.content?.parts?.[0]?.text ||
      (response as any).text;

    if (!jsonText) throw new Error("Gemini returned empty response.");

    const parsed = JSON.parse(jsonText) as AiPhase[];

    // ✅ 결과 순서 정렬
    const phaseOrder = [
      "Low Phase 1",
      "High Phase 1",
      "Low Phase 2",
      "High Phase 2",
      "Low Phase 3",
      "High Phase 3",
      "Medium Phase 1",
    ];

    parsed.sort((a, b) => {
      const idxA = phaseOrder.indexOf(a.name);
      const idxB = phaseOrder.indexOf(b.name);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    return parsed;
  } catch (err: any) {
    console.error("❌ Gemini Phase Analysis failed:", err.message);
    throw new Error(
      `Gemini Phase Analysis Error: ${err.message || "Unknown error."}`
    );
  }
}
