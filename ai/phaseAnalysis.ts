// src/ai/phaseAnalysis.ts
import type { CsvGraphJob, AiPhase } from "../types/csvGraph";
import { getGenAIClient } from "../services/geminiService";

function getPhaseAnalysisPrompt(
  dataPoints: { t: string; v: number | null }[],
  sensorType: CsvGraphJob["sensorType"],
  measurementRange: number | undefined
): string {
  let prompt = "";

  switch (sensorType) {
    case "수질 (PH)":
      prompt = `
You are a hyper-precise data analysis robot. Your SOLE mission is to find broad concentration phases from '수질 (PH)' data. You MUST NOT identify individual points like Z1, S1.

**DATA & THRESHOLDS**
- JSON Array: {t: "ISO timestamp", v: numeric_value}
- Sensor: pH meter (values cluster around 4, 7, and 10)
- Define ranges:
  * ph4_range = [3.5, 5.0]
  * ph7_range = [6.5, 8.0]

**CRITICAL RULES**
1. Strict order: Low Phase 1 → High Phase 1 → Low Phase 2 → High Phase 2 → Low Phase 3 → High Phase 3.
2. Each new phase starts strictly after the previous one ends.
3. Ignore transient spikes; focus on stable 60s+ segments.
4. Low Phase 2 must include ≥2h (7200s) stable pH7 rest period.

**FINAL OUTPUT**
Return only a single JSON array of phase objects:
[{ name, startTime, endTime }]
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "수질 (SS)":
      const ssThresholds =
        typeof measurementRange === "number" && measurementRange > 0
          ? `
- Measurement range: ${measurementRange}.
- Thresholds: high=${measurementRange * 0.8}, low=${measurementRange * 0.2}, medium_low=${measurementRange * 0.4}, medium_high=${measurementRange * 0.6}.
`
          : `
- Compute data_min, data_max.
- Thresholds = 0.2, 0.4, 0.6, 0.8 fractions between min/max.
`;

      prompt = `
You are a hyper-precise analyzer for '수질 (SS)' sensor data.

**DATA & THRESHOLDS**
- JSON Array: {t: "ISO timestamp", v: numeric_value}
${ssThresholds}

**RULES**
1. Detect phases sequentially: Low → High → Low → High → Low → High → (Medium).
2. Low/High phases must last ≥1800s (30min) continuously within thresholds.
3. Medium phase lasts ≥1200s (20min) between medium_low–medium_high.
4. Low Phase 2 must contain ≥2h stable low rest section.

**OUTPUT**
Return [{ name, startTime, endTime }]
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "먹는물 (TU/Cl)":
    default:
      const tuThresholds =
        typeof measurementRange === "number" && measurementRange > 0
          ? `
- Measurement range: ${measurementRange}.
- Thresholds:
  high=${measurementRange * 0.8},
  low=${measurementRange * 0.2},
  medium_low=${measurementRange * 0.4},
  medium_high=${measurementRange * 0.6}.
`
          : `
- Auto-derive thresholds from data_min/data_max (0.2–0.8 ratios).
`;

      prompt = `
You are a precise phase segmentation system for '먹는물 (TU/Cl)' sensor data.

**DATA & THRESHOLDS**
${tuThresholds}

**RULES**
1. A phase = continuous period where ALL values fit within range.
2. If any value breaks threshold, terminate the phase immediately.
3. Follow exact order:
   Low1 → High1 → Low2 (rest ≥2h) → High2 → Low3 → High3 → Medium1

**OUTPUT**
Return only a single JSON array of phase objects:
[{ name, startTime, endTime }]
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
    console.warn("⚠️ Selected channel not found. Skipping analysis.");
    return [];
  }

  const ai = getGenAIClient(); // ✅ GoogleGenerativeAI 인스턴스 반환
  const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

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

  // ✅ JSON Schema 구조 (신 SDK에서는 Type 제거)
  const responseSchema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        startTime: { type: "string" },
        endTime: { type: "string" },
      },
      required: ["name", "startTime", "endTime"],
    },
  };

  try {
    const result = await model.generateContent([{ text: prompt }]);
    const jsonText = result.response.text();

    if (!jsonText) throw new Error("Gemini returned empty response.");

    const parsed = JSON.parse(jsonText) as AiPhase[];

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
