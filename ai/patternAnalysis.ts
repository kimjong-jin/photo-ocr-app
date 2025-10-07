// src/ai/patternAnalysis.ts
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/CsvGraph";

/**
 * 패턴 분석용 프롬프트를 구성
 */
function getPatternAnalysisPrompt(
  job: CsvGraphJob,
  allDataPoints: { t: string; v: number }[],
  phaseMap: Map<string, AiPhase>
): string {
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

  let prompt = "";

  // ✅ 먹는물 (TU/Cl) 전용 패턴 분석
  if (job.sensorType === "먹는물 (TU/Cl)") {
    const threshold =
      typeof measurementRange === "number" && measurementRange > 0
        ? measurementRange * 0.03
        : 0.3;

    prompt = `
You are a precise data analysis system for '먹는물 (TU/Cl)' sensor data.
Use phase boundaries as already defined; do not reinterpret noise or stability.
Return valid {timestamp, value} pairs within each dataset only.

---

**TASKS**

1️⃣ Z1 & Z2 (Low Phase 1)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Low Phase 1")))}
Rule: Z1 = first point; Z2 = first point ≥300s after Z1.

2️⃣ S1 & S2 (High Phase 1)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("High Phase 1")))}
Rule: S1 = first point; S2 = first point ≥300s after S1.

3️⃣ Z3 & Z4 (Low Phase 2, 2h Rest Rule)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Low Phase 2")))}
Rule:
- Find a stable section (Δv/v ≤5%) lasting ≥7200s.
- Let end_timestamp = end of that section.
- After that, find:
  • Z3 = first point
  • Z4 = first point ≥300s after Z3.

4️⃣ S3 & S4 (High Phase 2)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("High Phase 2")))}
Rule: S3 = first point; S4 = first point ≥300s after S3.

5️⃣ Z5 (Low Phase 3)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Low Phase 3")))}
Rule: Z5 = point closest to dataset midpoint.

6️⃣ S5 (High Phase 3)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("High Phase 3")))}
Rule: S5 = point closest to dataset midpoint.

7️⃣ M1 (Medium Phase 1)
Data: ${JSON.stringify(filterDataForPhase(phaseMap.get("Medium Phase 1")))}
Rule: M1 = point closest to dataset midpoint.

---

**Response Time Analysis**
Full Data: ${JSON.stringify(allDataPoints)}
Prerequisites: S1, Z5, S5.
Rules:
- If missing, set responseError = "Prerequisites not found."
- responseStartPoint = first point between Z5 and S5 with v ≥ ${threshold}.
- responseEndPoint = first point after start where v ≥ S1.value × 0.9.
Return all results as JSON.
`;
  }

  return prompt;
}

/**
 * 패턴 분석 실행 (서버 API 호출 방식)
 */
export async function runPatternAnalysis(job: CsvGraphJob): Promise<AiAnalysisResult> {
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

  // ✅ 모든 데이터 포인트 준비
  const allDataPoints = job.parsedData.data
    .map((d) => ({
      t: d.timestamp.toISOString(),
      v: d.values[selectedChannelIndex],
    }))
    .filter((d) => d.v !== null && typeof d.v === "number") as { t: string; v: number }[];

  const phaseMap = new Map(job.aiPhaseAnalysisResult.map((p) => [p.name, p]));

  // ✅ 프롬프트 생성
  const prompt = getPatternAnalysisPrompt(job, allDataPoints, phaseMap);

  // ✅ 서버리스 API(`/api/gemini-analyze`) 호출
  try {
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
    const parsed = JSON.parse(output) as AiAnalysisResult;

    // ✅ 응답 시간 계산
    if (parsed.responseStartPoint && parsed.responseEndPoint) {
      const start = new Date(parsed.responseStartPoint.timestamp).getTime();
      const end = new Date(parsed.responseEndPoint.timestamp).getTime();
      if (end >= start) parsed.responseTimeInSeconds = (end - start) / 1000;
    }

    return parsed;
  } catch (err: any) {
    console.error("❌ Pattern Analysis failed:", err);
    throw new Error(`Gemini Pattern Analysis Error: ${err.message}`);
  }
}
