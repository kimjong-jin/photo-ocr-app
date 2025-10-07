import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/csvGraph";

/**
 * ✅ 이름 정규화 (Phase 이름 불일치 방지)
 */
const normalizeName = (name: string) =>
  name.replace(/\s+/g, "").replace(/_/g, "").toLowerCase();

/**
 * ✅ 특정 Phase 범위 내 데이터 추출
 */
const filterDataForPhase = (
  all: { t: string; v: number }[],
  phase: AiPhase | undefined
) => {
  if (!phase) return [];
  const s = new Date(phase.startTime).getTime();
  const e = new Date(phase.endTime).getTime();
  return all.filter((p) => {
    const t = new Date(p.t).getTime();
    return t >= s && t <= e;
  });
};

/**
 * ✅ 패턴 분석용 프롬프트 (Phase 결과 기반)
 */
function getPatternAnalysisPrompt(
  job: CsvGraphJob,
  all: { t: string; v: number }[],
  phaseMap: Map<string, AiPhase>
): { masterPrompt: string; masterSchema: any } {
  const ch = job.parsedData!.channels.find((c) => c.id === job.selectedChannelId)!;
  const range = job.parsedData!.measurementRange;

  const pd = (n: string) => filterDataForPhase(all, phaseMap.get(normalizeName(n)));

  const pointSchema = {
    type: Type.OBJECT,
    properties: { timestamp: { type: Type.STRING }, value: { type: Type.NUMBER } },
    required: ["timestamp", "value"],
  };

  const threshold =
    (ch.name.toLowerCase().includes("tu") ||
      ch.name.toLowerCase().includes("cl")) &&
    typeof range === "number" &&
    range > 0
      ? range * 0.03
      : 0.3;

  const masterSchema = {
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

  const masterPrompt = `
You are a highly precise data analysis system for '먹는물 (TU/Cl)' sensor data.
Use the already defined phase data boundaries from the previous concentration phase analysis.
Do NOT re-interpret stability or noise — assume all given phase data are clean and valid.

---

**CRITICAL DIRECTIVES**
1. Each task must be handled independently. Missing one does not block others.
2. Use ONLY the provided data for each phase; do not infer external data.
3. Return only valid {timestamp, value} pairs from within each phase dataset.
4. Do NOT perform spike or noise filtering.
5. If data is missing, omit that field.

---

**TASKS**
Z1,Z2 (Low Phase 1): ${JSON.stringify(pd("Low Phase 1"))}
S1,S2 (High Phase 1): ${JSON.stringify(pd("High Phase 1"))}
Z3,Z4 (Low Phase 2): ${JSON.stringify(pd("Low Phase 2"))}
S3,S4 (High Phase 2): ${JSON.stringify(pd("High Phase 2"))}
Z5 (Low Phase 3): ${JSON.stringify(pd("Low Phase 3"))}
S5 (High Phase 3): ${JSON.stringify(pd("High Phase 3"))}
M1 (Medium Phase 1): ${JSON.stringify(pd("Medium Phase 1"))}

---

**FINAL TASK: RESPONSE TIME ANALYSIS**
Full Data: ${JSON.stringify(all)}
Prerequisites: S1, Z5, and S5 must exist.
Rule:
1. If missing → responseError = "Prerequisites not found."
2. responseStartPoint = first point between Z5 and S5 where v ≥ ${threshold}
3. responseEndPoint = first point after start where v ≥ S1.value × 0.9
4. If missing → responseError = "Response point not found."
`;

  return { masterPrompt, masterSchema };
}

/**
 * ✅ 패턴 분석 실행
 */
export async function runPatternAnalysis(job: CsvGraphJob): Promise<AiAnalysisResult> {
  if (!job.parsedData || !job.selectedChannelId || !job.aiPhaseAnalysisResult)
    throw new Error("Pattern analysis requires parsed data, a selected channel, and phase results.");

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

  const idx = job.parsedData.channels.findIndex((c) => c.id === job.selectedChannelId);
  const all = job.parsedData.data
    .map((d) => ({ t: d.timestamp.toISOString(), v: d.values[idx] }))
    .filter((d) => typeof d.v === "number");

  const phaseMap = new Map(
    job.aiPhaseAnalysisResult.map((p) => [normalizeName(p.name), p])
  );

  const { masterPrompt, masterSchema } = getPatternAnalysisPrompt(job, all, phaseMap);

  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: masterPrompt }] }],
    config: { responseMimeType: "application/json", responseSchema: masterSchema },
  });

  const text =
    (r as any).output_text ||
    (r as any).text ||
    (r as any).output?.[0]?.content?.parts?.[0]?.text ||
    "";

  if (!text.trim()) throw new Error("Empty response from Gemini model");

  const result = JSON.parse(text) as AiAnalysisResult;

  if (result.responseStartPoint && result.responseEndPoint) {
    const s = new Date(result.responseStartPoint.timestamp).getTime();
    const e = new Date(result.responseEndPoint.timestamp).getTime();
    if (e >= s) result.responseTimeInSeconds = (e - s) / 1000;
  }

  return result;
}
