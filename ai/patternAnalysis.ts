import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/csvGraph";

/**
 * ✅ 이름 정규화
 */
const normalizeName = (n: string) =>
  n.replace(/\s+/g, "").replace(/_/g, "").toLowerCase();

/**
 * ✅ Phase 데이터 필터링
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
 * ✅ 패턴 분석 프롬프트 (절대 수정 금지)
 */
function getPatternAnalysisPrompt(
  job: CsvGraphJob,
  all: { t: string; v: number }[],
  phaseMap: Map<string, AiPhase>
): { masterPrompt: string; masterSchema: any } {
  const ch = job.parsedData!.channels.find((c) => c.id === job.selectedChannelId)!;
  const range = job.parsedData!.measurementRange;

  const ps = (n: string) => filterDataForPhase(all, phaseMap.get(normalizeName(n)));

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
Use the already defined phase data boundaries from concentration analysis.
Do NOT re-interpret stability or noise — assume each provided phase dataset is clean and valid.

CRITICAL RULES:
1. Each task below must be attempted independently. Missing one does not stop the rest.
2. Return only valid {timestamp, value} pairs found inside the given phase datasets.
3. Do NOT apply spike or noise filtering.

TASKS:
1. Z1,Z2 (Low Phase 1): ${JSON.stringify(ps("Low Phase 1"))}
2. S1,S2 (High Phase 1): ${JSON.stringify(ps("High Phase 1"))}
3. Z3,Z4 (Low Phase 2): ${JSON.stringify(ps("Low Phase 2"))}
4. S3,S4 (High Phase 2): ${JSON.stringify(ps("High Phase 2"))}
5. Z5 (Low Phase 3): ${JSON.stringify(ps("Low Phase 3"))}
6. S5 (High Phase 3): ${JSON.stringify(ps("High Phase 3"))}
7. M1 (Medium Phase 1): ${JSON.stringify(ps("Medium Phase 1"))}

FINAL TASK (Response Time Analysis):
Full Data: ${JSON.stringify(all)}
Prerequisites: S1, Z5, S5 must exist.
responseStartPoint = first point between Z5 and S5 where v ≥ ${threshold}
responseEndPoint = first point after start where v ≥ S1.value × 0.9
If missing → responseError
`;

  return { masterPrompt, masterSchema };
}

/**
 * ✅ 패턴 분석 실행 (Gemini 직접 호출)
 */
export async function runPatternAnalysis(job: CsvGraphJob): Promise<AiAnalysisResult> {
  if (!job.parsedData || !job.selectedChannelId || !job.aiPhaseAnalysisResult)
    throw new Error("Pattern analysis requires parsed data and phase results.");

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
