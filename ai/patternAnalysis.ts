import { GoogleGenAI, Type } from "@google/genai";
import type { CsvGraphJob, AiAnalysisResult, AiPhase } from "../types/csvGraph";

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

  const pointSchema = {
    type: Type.OBJECT,
    properties: { timestamp: { type: Type.STRING }, value: { type: Type.NUMBER } },
    required: ["timestamp", "value"],
  };

  let masterPrompt = "";
  let masterSchema: any;

  if (job.sensorType === "먹는물 (TU/Cl)") {
    const responseStartThresholdValue =
      typeof measurementRange === "number" && measurementRange > 0
        ? measurementRange * 0.03
        : 0.3;

    masterSchema = {
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

    masterPrompt = `
You are a highly precise data analysis system for '먹는물 (TU/Cl)' sensor data.
Use the already defined phase data boundaries from concentration analysis.
Do NOT re-interpret stability or noise — assume each provided phase dataset is clean and valid.

**TASKS:**
1. Z1/Z2 from Low Phase 1
2. S1/S2 from High Phase 1
3. Z3/Z4 from Low Phase 2 (2h stability rule)
4. S3/S4 from High Phase 2
5. Z5 from Low Phase 3
6. S5 from High Phase 3
7. M1 from Medium Phase 1
8. Response Time Analysis
Each field is optional but should strictly follow the JSON schema below.

Data:
${JSON.stringify(allDataPoints)}
`;
  } else {
    masterSchema = { type: Type.OBJECT, properties: {} };
    masterPrompt = "No analysis defined for this sensor type.";
  }

  return { masterPrompt, masterSchema };
}

export async function runPatternAnalysis(job: CsvGraphJob): Promise<AiAnalysisResult> {
  if (!job.parsedData || !job.selectedChannelId || !job.aiPhaseAnalysisResult) {
    throw new Error("Pattern analysis requires parsed data, a selected channel, and phase analysis results.");
  }

  const selectedChannelIndex = job.parsedData.channels.findIndex(
    (c) => c.id === job.selectedChannelId
  );
  if (selectedChannelIndex === -1)
    throw new Error("Selected channel not found in parsed data.");

  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

  const allDataPoints = job.parsedData.data
    .map((d) => ({ t: d.timestamp.toISOString(), v: d.values[selectedChannelIndex] }))
    .filter((d) => d.v !== null && typeof d.v === "number") as { t: string; v: number }[];

  const phaseMap = new Map(job.aiPhaseAnalysisResult.map((p) => [p.name, p]));
  const { masterPrompt, masterSchema } = getPatternAnalysisPrompt(job, allDataPoints, phaseMap);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: masterPrompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: masterSchema,
    },
  });

  const resultText =
    (response as any).output_text ||
    (response as any).text ||
    (response as any).output?.[0]?.content?.parts?.[0]?.text ||
    "";

  if (!resultText.trim()) {
    throw new Error("Gemini returned empty or invalid response.");
  }

  let result: AiAnalysisResult;
  try {
    result = JSON.parse(resultText);
  } catch {
    console.error("Invalid JSON:", resultText);
    throw new Error("Invalid JSON from Gemini model");
  }

  // Response time calculation
  if (result.responseStartPoint && result.responseEndPoint) {
    const start = new Date(result.responseStartPoint.timestamp).getTime();
    const end = new Date(result.responseEndPoint.timestamp).getTime();
    if (end >= start) result.responseTimeInSeconds = (end - start) / 1000;
  }

  return result;
}
