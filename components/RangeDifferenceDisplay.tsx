
import React from 'react';

// Defines the structure for statistics of a single range
export interface RangeStat {
  min: number;
  max: number;
  diff: number;
}

// Defines the overall structure for results of all ranges
export interface RangeResults {
  low: RangeStat | null;
  medium: RangeStat | null;
  high: RangeStat | null;
}

interface RangeDifferenceDisplayProps {
  results: RangeResults | null;
}

export const RangeDifferenceDisplay: React.FC<RangeDifferenceDisplayProps> = ({ results }) => {
  if (!results) {
    return null; 
  }

  const formatNumber = (num: number | null): string => {
    if (num === null || isNaN(num)) return "N/A";
    // Adjust decimal places as needed, e.g., to 3
    return num.toFixed(3); 
  };

  const renderRangeStat = (label: string, stat: RangeStat | null) => {
    const valueClass = stat ? 'text-sky-400' : 'text-slate-500';
    let displayText: string;

    if (stat) {
      displayText = `${formatNumber(stat.diff)} (최소: ${formatNumber(stat.min)}, 최대: ${formatNumber(stat.max)})`;
    } else {
      displayText = "N/A";
    }

    return (
      <div className="flex justify-between items-center">
        <span className="text-slate-300">{label}:</span>
        <span className={`font-medium ${valueClass} text-right`}>
          {displayText}
        </span>
      </div>
    );
  };
  
  // The component will render its main structure if 'results' is not null.
  // Individual 'N/A' for low, medium, high are handled by renderRangeStat.

  return (
    <div className="mt-6 p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-100 mb-3 border-b border-slate-600 pb-2">
        농도 범위별 값 차이 분석 (Value Difference Analysis by Concentration Range)
      </h3>
      <div className="space-y-2 text-sm">
        {renderRangeStat("저농도 범위 최대-최소 차이", results.low)}
        {renderRangeStat("중간농도 범위 최대-최소 차이", results.medium)}
        {renderRangeStat("고농도 범위 최대-최소 차이", results.high)}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        "N/A"는 해당 농도 범위(자동으로 결정됨)에 데이터가 2개 미만이거나, 전체 데이터가 3개 미만으로 의미있는 그룹핑이 어려움을 의미합니다.
      </p>
    </div>
  );
};
// Unused variable 'aggregatedOcrTextHasBeenProcessed' removed.
