// src/ai/phaseAnalysis.ts
import type { CsvGraphJob, AiPhase } from "../types/csvGraph";

/**
 * Phase 분석용 프롬프트 생성
 */
function getPhaseAnalysisPrompt(
  dataPoints: { t: string; v: number | null }[],
  sensorType: CsvGraphJob["sensorType"],
  measurementRange: number | undefined
): string {
  let prompt = "";

  switch (sensorType) {
    case "수질 (PH)":
      prompt = `
You are a hyper-precise analyzer for '수질 (PH)' sensor data.

**DATA & THRESHOLDS**
- JSON Array: {t: "ISO timestamp", v: numeric_value}
- pH meter values cluster near 4, 7, 10
- Ranges:
  • ph4_range = [3.5, 5.0]
  • ph7_range = [6.5, 8.0]

**RULES**
1. Detect in strict order: Low1 → High1 → Low2 → High2 → Low3 → High3
2. Each new phase starts strictly after the previous one ends
3. Ignore spikes; focus on stable segments ≥60s
4. Low Phase 2 must include ≥2h (7200s) stable pH7 rest period

**OUTPUT**
Return JSON array:
[{ name, startTime, endTime }]
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "수질 (SS)":
      const ssThresholds =
        typeof measurementRange === "number" && measurementRange > 0
          ? `
- Measurement range: ${measurementRange}
- Thresholds:
  • high=${measurementRange * 0.8}
  • low=${measurementRange * 0.2}
  • medium_low=${measurementRange * 0.4}
  • medium_high=${measurementRange * 0.6}
`
          : `
- Auto-compute data_min, data_max.
- Thresholds = 0.2, 0.4, 0.6, 0.8 ratios between min/max.
`;

      prompt = `
You are a precise time-based analyzer for '수질 (SS)' sensor data.

**DATA & THRESHOLDS**
${ssThresholds}

**RULES**
1. Phases: Low → High → Low → High → Low → High (+ Medium)
2. Each Low/High lasts ≥1800s (30min), Medium ≥1200s (20min)
3. Low Phase 2 must include ≥2h continuous low rest section

**OUTPUT**
Return JSON array:
[{ name, startTime, endTime }]
Data:
${JSON.stringify(dataPoints)}
`;
      break;

    case "먹는물 (TU/Cl)":
    default:
      const tuThresholds =
        typeof measurementRange === "number" && measurementRange > 0
          ? `
- Measurement range: ${measurementRange}
- Thresholds:
  • high=${measurementRange * 0.8}
  • low=${measurementRange * 0.2}
  • medium_low=${measurementRange * 0.4}
  • medium_high=${measurementRange * 0.6}
`
          : `
- Auto-derive thresholds from min/max using 0.2–0.8 ratios.
`;

      prompt = `
You are a strict phase segmentation analyzer for '먹는물 (TU/Cl)'.

**DATA & THRESHOLDS**
${tuThresholds}

**RULES**
1. A phase = continuous segment where ALL values fit within thresholds
2. If any value breaks range → terminate current phase immediately
3. Follow exact order:
   Low1 → High1 → Low2 (rest ≥2h) → High2 → Low3 → High3 → Medium1

**OUTPUT**
Return JSON array:
[{ name, startTime, endTime }]
Data:
${JSON.stringify(dataPoints)}
`;
      break;
  }

  return prompt;
}

/**
 * Phase 분석 실행 (API 호출 방식)
 */
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

  // ✅ 데이터 준비
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

  try {
    // ✅ Vercel 서버리스 API 호출 (백엔드에서 Gemini SDK 처리)
    const response = await fetch("/api/gemini-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API call failed: ${errText}`);
    }

    const { output } = await response.json();
    const parsed = JSON.parse(output) as AiPhase[];

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
    console.error("❌ Phase Analysis failed:", err);
    throw new Error(`Gemini Phase Analysis Error: ${err.message}`);
  }
}
