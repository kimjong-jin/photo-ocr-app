import { ExtractedEntry } from '../PhotoLogPage';

interface ConcentrationBoundaries {
  overallMin: number;
  overallMax: number;
  span: number;
  boundary1: number;
  boundary2: number;
}

type ConcentrationCategory = 'low' | 'medium' | 'high' | 'unknown';

interface DataWithMeta {
  index: number;
  originalEntry: ExtractedEntry;
  concentration: ConcentrationCategory;
  numericValue: number | null;
}

export interface AssignmentResult {
  tn?: string;
  tp?: string;
}

// Helper to get numeric value
const getNumericValue = (valueStr: string): number | null => {
    const numericValueString = String(valueStr).match(/^-?\d+(\.\d+)?/)?.[0];
    if (!numericValueString) return null;
    const numericValue = parseFloat(numericValueString);
    return isNaN(numericValue) ? null : numericValue;
};

// Helper to determine concentration category
const getConcentrationCategory = (valueStr: string, boundaries: ConcentrationBoundaries): ConcentrationCategory => {
    const numericValue = getNumericValue(valueStr);
    if (numericValue === null) return 'unknown';
    if (numericValue <= boundaries.boundary1) return 'low';
    if (numericValue <= boundaries.boundary2) return 'medium';
    return 'high';
};


export const autoAssignIdentifiersByConcentration = (
    ocrData: ExtractedEntry[],
    boundaries: ConcentrationBoundaries | null,
    isTpMode: boolean
): AssignmentResult[] => {
    if (!ocrData || ocrData.length === 0 || !boundaries) {
        return ocrData.map(() => ({}));
    }

    const assignments: AssignmentResult[] = ocrData.map(() => ({}));
    const consumedIndices = new Set<number>();

    const dataWithMeta: DataWithMeta[] = ocrData.map((entry, index) => ({
        index,
        originalEntry: entry,
        numericValue: getNumericValue(entry.value),
        concentration: getConcentrationCategory(entry.value, boundaries),
    }));

    const findAndAssignConsecutivePattern = (
        concentrationPattern: ConcentrationCategory[],
        tnIdentifiers: string[],
        tpIdentifiers: string[]
    ): boolean => {
        let patternFound = false;
        const patternLength = concentrationPattern.length;
        for (let i = 0; i <= dataWithMeta.length - patternLength; i++) {
            const windowIndices = Array.from({ length: patternLength }, (_, k) => i + k);
            const window = windowIndices.map(idx => dataWithMeta[idx]);

            if (window.some(item => consumedIndices.has(item.index))) {
                continue;
            }

            const concentrationsMatch = window.every((item, idx) => item.concentration === concentrationPattern[idx]);

            if (concentrationsMatch) {
                window.forEach((item, idx) => {
                    assignments[item.index].tn = tnIdentifiers[idx];
                    if (isTpMode) {
                        assignments[item.index].tp = tpIdentifiers[idx];
                    }
                    consumedIndices.add(item.index);
                });
                patternFound = true;
            }
        }
        return patternFound;
    };
    
    // 1순위: LHLHLH
    findAndAssignConsecutivePattern(
        ['low', 'high', 'low', 'high', 'low', 'high'],
        ['Z5', 'S5', 'Z6', 'S6', 'Z7', 'S7'],
        ['Z5P', 'S5P', 'Z6P', 'S6P', 'Z7P', 'S7P']
    );

    // 2순위: LLHH,
    const p2FoundAtIndices: number[] = [];
    const p2PatternLength = 4;
    for (let i = 0; i <= dataWithMeta.length - p2PatternLength; i++) {
        const windowIndices = Array.from({ length: p2PatternLength }, (_, k) => i + k);
        const window = windowIndices.map(idx => dataWithMeta[idx]);
        if (window.some(item => consumedIndices.has(item.index))) continue;
        const concentrationsMatch = window.every((item, idx) => item.concentration === ['low', 'low', 'high', 'high'][idx]);
        if (concentrationsMatch) {
            window.forEach((item, idx) => {
                assignments[item.index].tn = ['Z1', 'Z2', 'S1', 'S2'][idx];
                if (isTpMode) assignments[item.index].tp = ['Z1P', 'Z2P', 'S1P', 'S2P'][idx];
                consumedIndices.add(item.index);
            });
            p2FoundAtIndices.push(i);
        }
    }
    
    // 3순위: (2순위 뒤) LLHH 패턴
    for (const startIndex of p2FoundAtIndices) {
        const nextWindowIndex = startIndex + p2PatternLength;
        if (nextWindowIndex <= dataWithMeta.length - p2PatternLength) {
            const windowIndices = Array.from({ length: p2PatternLength }, (_, k) => nextWindowIndex + k);
            const window = windowIndices.map(idx => dataWithMeta[idx]);
            if (window.some(item => consumedIndices.has(item.index))) continue;
            const concentrationsMatch = window.every((item, idx) => item.concentration === ['low', 'low', 'high', 'high'][idx]);
            if (concentrationsMatch) {
                window.forEach((item, idx) => {
                    assignments[item.index].tn = ['Z3', 'Z4', 'S3', 'S4'][idx];
                    if (isTpMode) assignments[item.index].tp = ['Z3P', 'Z4P', 'S3P', 'S4P'][idx];
                    consumedIndices.add(item.index);
                });
            }
        }
    }
    
    // 4순위: M1 M2 M3 (부근)
    if (consumedIndices.size > 0) {
        const sortedConsumed = Array.from(consumedIndices).sort((a, b) => a - b);
        const minConsumed = sortedConsumed[0];
        const maxConsumed = sortedConsumed[sortedConsumed.length - 1];
        const searchRadius = 5; 
        let mmmAssigned = false;

        for (let i = minConsumed - 3; i >= 0 && i >= minConsumed - searchRadius - 3; i--) {
            const windowIndices = [i, i + 1, i + 2];
            const window = windowIndices.map(idx => dataWithMeta[idx]);
            if (window.every(item => item && !consumedIndices.has(item.index) && item.concentration === 'medium')) {
                window.forEach((item, idx) => {
                    assignments[item.index].tn = ['M1', 'M2', 'M3'][idx];
                    if (isTpMode) assignments[item.index].tp = ['M1P', 'M2P', 'M3P'][idx];
                    consumedIndices.add(item.index);
                });
                mmmAssigned = true;
                break;
            }
        }

        if (!mmmAssigned) {
            for (let i = maxConsumed + 1; i < dataWithMeta.length - 2 && i <= maxConsumed + searchRadius; i++) {
                const windowIndices = [i, i + 1, i + 2];
                const window = windowIndices.map(idx => dataWithMeta[idx]);
                if (window.every(item => item && !consumedIndices.has(item.index) && item.concentration === 'medium')) {
                    window.forEach((item, idx) => {
                        assignments[item.index].tn = ['M1', 'M2', 'M3'][idx];
                        if (isTpMode) assignments[item.index].tp = ['M1P', 'M2P', 'M3P'][idx];
                        consumedIndices.add(item.index);
                    });
                    break;
                }
            }
        }
    }

    // 5순위: LH
    findAndAssignConsecutivePattern(
        ['low', 'high'],
        ['Z5', 'S5'],
        ['Z5P', 'S5P']
    );

    return assignments;
};
