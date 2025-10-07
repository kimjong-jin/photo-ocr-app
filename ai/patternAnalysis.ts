// src/ai/patternAnalysis.ts
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/csvGraph";
import { getGenAIClient } from "../services/geminiService";

function getPatternAnalysisPrompt(
  job: CsvGraphJob,
  allDataPoints: { t: string; v: number }[],
  phaseMap: Map<string, AiPhase>
): { masterPrompt: string; masterSchema: any } {
  const selectedChannel = job.parsedData!.channels.find(
    (c) => c.id === job.selectedChannelId
  )!;
  const measurementRange = job.parsedData!.measurementRange;

  const filterDataForPhase = (phase: AiPhase | undefined) => {
    if (!phase) return [];
    const start = new Date(phase.startTime).getTime();
    const end = new Date(phase.endTime).getTime();
    return allDataPoints.filter((p) => {
      const pTime = new Date(p.t).getTime();
      return pTime >= start && pTime <= end;
    });
  };

  let masterPrompt = "";
  let masterSchema: any;

  // ✅ JSON Schema 구조 (신 SDK에서 Type 제거됨)
  const pointSchema = {
    type: "object",
    properties: {
      timestamp: { type: "string" },
      value: { type: "number" },
    },
    required: ["timestamp", "value"],
  };

  // ✅ 먹는물 (TU/Cl) 전용 패턴 분석
  if (job.sensorType === "먹는물 (TU/Cl)") {
    let responseStartThresholdValue: number;
    if (
      (selectedChannel.name.toLowerCase().includes("tu") ||
        selectedChannel.name.toLowerCase().includes("cl")) &&
      typeof measurementRange === "number" &&
      measurementRange > 0
    ) {
      responseStartThresholdValue = measurementRange * 0.03;
    } else {
      responseStartThresholdValue = 0.3;
    }

    masterSchema = {
      type: "object",
      properties: {
        z1: pointSchema,
        z2: pointSchema,
        s1: pointSchema,
        s2: pointSchema,
        z3: pointSchema,
        z4: pointSchema,
        s3: pointSchema,
        s4: pointSchema,
        z5: pointSchema,
        s5: pointSchema,
        m1: pointSchema,
        responseStartPoint: pointSchema,
        responseEndPoint: pointSchema,
        responseError: { type: "string" },
      },
    };

    masterPrompt = `
You are a highly precise data analysis system for '먹는물 (TU/Cl)' sensor data.
Use the already defined phase data boundaries from concentration analysis.
Do NOT re-interpret stability or noise — assume each provided phase dataset is clean and valid.

---

**CRITICAL DIRECTIVES**
1. Each task below must be attempted independently. Missing one does not stop the rest.
2. Return only valid {timestamp, value} pairs found inside the given phase datasets.
3. Do NOT apply any spike or noise filtering; the concentration analysis has already handled this.
4. If data is missing, omit that field.

---

**TASK 1: Z1 & Z2 (Low Phase 1)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Low Phase 1")))}
- Rule: Z1 = first point; Z2 = first point ≥300s after Z1.

---

**TASK 2: S1 & S2 (High Phase 1)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("High Phase 1")))}
- Rule: S1 = first point; S2 = first point ≥300s after S1.

---

**TASK 3: Z3 & Z4 (Low Phase 2, includes 2-hour Rest Period Rule)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Low Phase 2")))}
- Rule:
  1. Within this dataset, find a continuous stable section where (Δv/v ≤5%) for at least 2 hours (7200 seconds).
  2. Let 'end_timestamp' be the end of that rest period.
  3. Consider only data points strictly AFTER 'end_timestamp'.
  4. From that subset, find:
     - Z3 = first data point,
     - Z4 = first point ≥300s after Z3.
  5. If no stable section exists, omit this task.

---

**TASK 4: S3 & S4 (High Phase 2)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("High Phase 2")))}
- Rule: S3 = first point; S4 = first point ≥300s after S3.

---

**TASK 5: Z5 (Low Phase 3)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Low Phase 3")))}
- Rule: Z5 = point closest to midpoint of dataset.

---

**TASK 6: S5 (High Phase 3)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("High Phase 3")))}
- Rule: S5 = point closest to midpoint of dataset.

---

**TASK 7: M1 (Medium Phase 1)**
- Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Medium Phase 1")))}
- Rule: M1 = point closest to midpoint of dataset.

---

**FINAL TASK: Response Time Analysis**
- Data: Full_Data: ${JSON.stringify(allDataPoints)}
- Prerequisites: S1, Z5, and S5 must exist.
- Rule:
  1. If missing, set responseError = "Prerequisites not found."
  2. responseStartPoint = first point between Z5 and S5 with v ≥ ${responseStartThresholdValue}.
  3. responseEndPoint = first point after responseStartPoint where v ≥ S1.value × 0.9.
  4. If not found, set appropriate responseError.
`;
  }

  return { masterPrompt, masterSchema };
}

export async function runPatternAnalysis(
  job: CsvGraphJob
): Promise<AiAnalysisResult> {
  if (!job.parsedData || !job.selectedChannelId || !job.aiPhaseAnalysisResult) {
    throw new Error(
      "Pattern analysis requires parsed data, a selected channel, and phase analysis results."
    );
  }

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );
  if (selectedChannelIndex === -1) {
    throw new Error("Selected channel not found in parsed data.");
  }

  // ✅ Gemini 클라이언트 가져오기
  const ai = getGenAIClient();
  const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

  const allDataPoints = job.parsedData.data
    .map((d) => ({ t: d.timestamp.toISOString(), v: d.values[selectedChannelIndex] }))
    .filter((d) => d.v !== null && typeof d.v === "number") as { t: string; v: number }[];

  const phaseMap = new Map(job.aiPhaseAnalysisResult.map((p) => [p.name, p]));

  const { masterPrompt, masterSchema } = getPatternAnalysisPrompt(
    job,
    allDataPoints,
    phaseMap
  );

  try {
    const result = await model.generateContent([
      { text: masterPrompt },
    ]);

    const jsonText = result.response.text();
    if (!jsonText) throw new Error("No JSON response from Gemini model.");

    const parsed = JSON.parse(jsonText) as AiAnalysisResult;

    if (parsed.responseStartPoint && parsed.responseEndPoint) {
      const start = new Date(parsed.responseStartPoint.timestamp).getTime();
      const end = new Date(parsed.responseEndPoint.timestamp).getTime();
      if (end >= start) parsed.responseTimeInSeconds = (end - start) / 1000;
    }

    return parsed;
  } catch (err: any) {
    console.error("❌ Gemini Pattern Analysis failed:", err.message);
    throw new Error(
      `Gemini 분석 실패: ${err.message || "알 수 없는 오류가 발생했습니다."}`
    );
  }
}
