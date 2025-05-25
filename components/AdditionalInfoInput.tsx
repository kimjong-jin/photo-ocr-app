import React from 'react';

interface AdditionalInfoInputProps {
  receiptNumber: string;
  onReceiptNumberChange: (value: string) => void;
  siteLocation: string;
  onSiteLocationChange: (value: string) => void;
  inspectionStartDate: string;
  onInspectionStartDateChange: (value: string) => void;
  disabled?: boolean;
}

const AdditionalInfoInput: React.FC<AdditionalInfoInputProps> = ({
  receiptNumber,
  onReceiptNumberChange,
  siteLocation,
  onSiteLocationChange,
  inspectionStartDate,
  onInspectionStartDateChange,
  disabled,
}) => {
  return (
    <div className="space-y-4 mb-6">
      <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-slate-100 mb-3 border-b border-slate-600 pb-2">
          입력 정보 (Input Information)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <label htmlFor="receipt-number" className="block text-sm font-medium text-slate-300 mb-1">
              접수번호
            </label>
            <input
              type="text"
              id="receipt-number"
              name="receipt-number"
              value={receiptNumber}
              onChange={(e) => onReceiptNumberChange(e.target.value)}
              disabled={disabled}
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors duration-150 ease-in-out disabled:opacity-60"
              placeholder="예: R2023001"
            />
          </div>

          <div>
            <label htmlFor="site-location" className="block text-sm font-medium text-slate-300 mb-1">
              현장
            </label>
            <input
              type="text"
              id="site-location"
              name="site-location"
              value={siteLocation}
              onChange={(e) => onSiteLocationChange(e.target.value)}
              disabled={disabled}
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors duration-150 ease-in-out disabled:opacity-60"
              placeholder="예: 강남 수질 측정소"
            />
          </div>
        </div>

        <div>
          <label htmlFor="inspection-start-date" className="block text-sm font-medium text-slate-300 mb-1">
            검사 시작일
          </label>
          <input
            type="date"
            id="inspection-start-date"
            name="inspection-start-date"
            value={inspectionStartDate}
            onChange={(e) => onInspectionStartDateChange(e.target.value)}
            disabled={disabled}
            className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm transition-colors duration-150 ease-in-out disabled:opacity-60"
          />
        </div>

        <p className="mt-1 text-xs text-slate-400">
          접수번호와 현장명, 검사 시작일은 선택 사항입니다.
        </p>
      </div>
    </div>
  );
};

export default AdditionalInfoInput;
