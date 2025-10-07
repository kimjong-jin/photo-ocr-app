import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/csvGraph";

/**
 * ✅ Phase별 데이터 샘플링 및 프롬프트 구성
 * - Gemini SDK 버전 (빠르고 안정적)
 * - 완전 구조화된 JSON Schema 기반
 */
function getPatternAnalysisPrompt(
  job: CsvGraphJob,
  allDataPoints: { t: string; v: number }[],
  phaseMap: Map<string, AiPhase>
): string {
  const safeJson = (arr: any[]) => JSON.stringify(arr.slice(0, 500));

  const selectedChannel = job.parsedData!.channels.find(
    (c) => c.id === job.selectedChannelId
  )!;
  const measurementRange = job.parsedData!.measurementRange;

  // ✅ 구간별 데이터 필터
  const filterDataForPhase = (phase: AiPhase | undefined) => {
    if (!phase) return [];
    const start = new Date(phase.startTime).getTime();
    const end = new Date(phase.endTime).getTime();
    return allDataPoints.filter((p) => {
      const pTime = new Date(p.t).getTime();
      return pTime >= start && pTime <= end;
    });
  };

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

  // ✅ Prompt (완전 유지)
  return `
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
- Data: ${safeJson(filterDataForPhase(phaseMap.get("Low Phase 1")))}
- Rule: Z1 = first point; Z2 = first point ≥300s after Z1.

---

**TASK 2: S1 & S2 (High Phase 1)**
- Data: ${safeJson(filterDataForPhase(phaseMap.get("High Phase 1")))}
- Rule: S1 = first point; S2 = first point ≥300s after S1.

---

**TASK 3: Z3 & Z4 (Low Phase 2, includes 2-hour Rest Period Rule)**
- Data: ${safeJson(filterDataForPhase(phaseMap.get("Low Phase 2")))}
- IMPORTANT: Use ONLY the data given above for this task.
- Rule:
  1. Within this dataset, find a continuous stable section where (Δv/v ≤5%) lasting at least 2 hours (7200s).
  2. Let 'end_timestamp' be the end of that section (the rest period).
  3. Consider only data points strictly AFTER 'end_timestamp'.
  4. From that subset:
     - Z3 = first data point,
     - Z4 = first point **that occurs at least 300 seconds (5 minutes) AFTER Z3**, not sooner.
  5. If no stable section exists, omit this task.

---

**TASK 4: S3 & S4 (High Phase 2)**
- Data: ${safeJson(filterDataForPhase(phaseMap.get("High Phase 2")))}
- Rule: S3 = first point; S4 = first point ≥300s after S3.

---

**TASK 5: Z5 (Low Phase 3)**
- Data: ${safeJson(filterDataForPhase(phaseMap.get("Low Phase 3")))}
- Rule: Z5 = point closest to midpoint of dataset.

---

**TASK 6: S5 (High Phase 3)**
- Data: ${safeJson(filterDataForPhase(phaseMap.get("High Phase 3")))}
- Rule: S5 = point closest to midpoint of dataset.

---

**TASK 7: M1 (Medium Phase 1)**
- Data: ${safeJson(filterDataForPhase(phaseMap.get("Medium Phase 1")))}
- Rule: M1 = point closest to midpoint of dataset.

---

**FINAL TASK: Response Time Analysis**
- Data: Full_Data: ${safeJson(allDataPoints)}
- Prerequisites: S1, Z5, and S5 must exist.
- Rule:
  1. If missing, set responseError = "Prerequisites not found."
  2. responseStartPoint = first point between Z5 and S5 with v ≥ ${responseStartThresholdValue}.
  3. responseEndPoint = first point after responseStartPoint where v ≥ S1.value × 0.9.
  4. If not found, set appropriate responseError.

---

**OUTPUT FORMAT**
Return ONLY this valid JSON object:
{
  "z1": { "timestamp": "...", "value": ... },
  "z2": { "timestamp": "...", "value": ... },
  "s1": { "timestamp": "...", "value": ... },
  "s2": { "timestamp": "...", "value": ... },
  "z3": { "timestamp": "...", "value": ... },
  "z4": { "timestamp": "...", "value": ... },
  "s3": { "timestamp": "...", "value": ... },
  "s4": { "timestamp": "...", "value": ... },
  "z5": { "timestamp": "...", "value": ... },
  "s5": { "timestamp": "...", "value": ... },
  "m1": { "timestamp": "...", "value": ... },
  "responseStartPoint": { "timestamp": "...", "value": ... },
  "responseEndPoint": { "timestamp": "...", "value": ... },
  "responseError": "..."
}

Ensure all timestamps are ISO strings and numeric values have 4 decimal places.
DO NOT include explanations, notes, or comments.
`;
}

/**
 * ✅ Gemini SDK 버전 (빠르고 정확)
 * - Schema 기반으로 JSON 보장
 * - 2시간 휴직기 + 5분 간격 규칙 안정적
 */
export async function runPatternAnalysis(
  job: CsvGraphJob
): Promise<AiAnalysisResult> {
  if (!job.parsedData || !job.selectedChannelId || !job.aiPhaseAnalysisResult) {
    throw new Error(
      "Pattern analysis requires parsed data, a selected channel, and phase analysis results."
    );
  }

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );
  if (selectedChannelIndex === -1)
    throw new Error("Selected channel not found in parsed data.");

  const allDataPoints = job.parsedData.data
    .filter((_, i) => i % 10 === 0)
    .map((d) => ({
      t: d.timestamp.toISOString(),
      v: Number(d.values[selectedChannelIndex]?.toFixed(4)),
    }))
    .filter((d) => d.v !== null && !isNaN(d.v));

  const phaseMap = new Map(job.aiPhaseAnalysisResult.map((p) => [p.name, p]));
  const prompt = getPatternAnalysisPrompt(job, allDataPoints, phaseMap);

  // ✅ JSON Schema 강제 정의
  const pointSchema = {
    type: Type.OBJECT,
    properties: {
      timestamp: { type: Type.STRING },
      value: { type: Type.NUMBER },
    },
    required: ["timestamp", "value"],
  };

  const schema = {
    type: Type.OBJECT,
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
      responseError: { type: Type.STRING },
    },
  };

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: { thinkingBudget: 1 },
    },
  });

  const parsed = JSON.parse(response.text) as AiAnalysisResult;

  // ✅ 응답시간 계산
  if (parsed.responseStartPoint && parsed.responseEndPoint) {
    const start = new Date(parsed.responseStartPoint.timestamp).getTime();
    const end = new Date(parsed.responseEndPoint.timestamp).getTime();
    if (end >= start) parsed.responseTimeInSeconds = (end - start) / 1000;
  }

  return parsed;
}
