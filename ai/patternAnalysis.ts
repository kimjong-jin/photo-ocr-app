import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/csvGraph";

/**
 * ✅ 이름 정규화
 */
const normalizeName = (name: string) =>
  name.replace(/\s+/g, "").replace(/_/g, "").toLowerCase();

/**
 * ✅ 특정 Phase 범위 데이터 필터링
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
 * ✅ 패턴 분석 프롬프트 생성기
 */
function getPatternAnalysisPrompt(
  job: CsvGraphJob,
  all: { t: string; v: number }[],
  phaseMap: Map<string, AiPhase>
): { prompt: string; schema: any } {
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

  const prompt = `
You are a highly precise data analysis system for '먹는물 (TU/Cl)' sensor data.
Use the phase boundaries below to find measurement points.

CRITICAL RULES:
1. Do not modify or interpret stability/noise.
2. Only return valid {timestamp, value} pairs found in the datasets.
3. Skip missing data.

TASKS:
1. Z1,Z2 → Low Phase 1: ${JSON.stringify(ps("Low Phase 1"))}
2. S1,S2 → High Phase 1: ${JSON.stringify(ps("High Phase 1"))}
3. Z3,Z4 → Low Phase 2: ${JSON.stringify(ps("Low Phase 2"))}
4. S3,S4 → High Phase 2: ${JSON.stringify(ps("High Phase 2"))}
5. Z5 → Low Phase 3: ${JSON.stringify(ps("Low Phase 3"))}
6. S5 → High Phase 3: ${JSON.stringify(ps("High Phase 3"))}
7. M1 → Medium Phase 1: ${JSON.stringify(ps("Medium Phase 1"))}

FINAL TASK: Response Time Analysis
Use all data: ${JSON.stringify(all)}
- responseStartPoint = first between Z5→S5 where v ≥ ${threshold}
- responseEndPoint = first after start where v ≥ S1.value × 0.9
- If missing → responseError
`;

  return { prompt, schema };
}

/**
 * ✅ 패턴 분석 실행 (Gemini 직접 호출)
 */
export async function runPatternAnalysis(job: CsvGraphJob): Promise<AiAnalysisResult> {
  if (!job.parsedData || !job.selectedChannelId || !job.aiPhaseAnalysisResult)
    throw new Error("Pattern analysis requires phase analysis results.");

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

  const idx = job.parsedData.channels.findIndex((c) => c.id === job.selectedChannelId);
  const all = job.parsedData.data
    .map((d) => ({ t: d.timestamp.toISOString(), v: d.values[idx] }))
    .filter((d) => typeof d.v === "number");

  const phaseMap = new Map(
    job.aiPhaseAnalysisResult.map((p) => [normalizeName(p.name), p])
  );

  const { prompt, schema } = getPatternAnalysisPrompt(job, all, phaseMap);

  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json", responseSchema: schema },
  });

  const resultText =
    (r as any).output_text ||
    (r as any).text ||
    (r as any).output?.[0]?.content?.parts?.[0]?.text ||
    "";

  if (!resultText.trim()) throw new Error("Empty response from Gemini model");

  const result = JSON.parse(resultText) as AiAnalysisResult;

  if (result.responseStartPoint && result.responseEndPoint) {
    const s = new Date(result.responseStartPoint.timestamp).getTime();
    const e = new Date(result.responseEndPoint.timestamp).getTime();
    if (e >= s) result.responseTimeInSeconds = (e - s) / 1000;
  }

  return result;
}
