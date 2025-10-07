// utils/phaseLabel.ts
export const phaseLabelMap: Record<string, string> = {
  "Low Phase 1": "L1",
  "High Phase 1": "H1",
  "Low Phase 2": "L2",
  "High Phase 2": "H2",
  "Low Phase 3": "L3",
  "High Phase 3": "H3",
  "Medium Phase 1": "M1",
};

export function getPhaseLabel(phaseName: string): string {
  return phaseLabelMap[phaseName] || phaseName;
}
