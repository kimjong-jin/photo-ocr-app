
import React from 'react';

interface AnalysisContextFormProps {
  receiptNumber: string;
  onReceiptNumberChange: (value: string) => void;
  siteLocation: string;
  onSiteLocationChange: (value: string) => void;
  // inspectionStartDate: string; // Removed
  // onInspectionStartDateChange: (value: string) => void; // Removed
  selectedItem: string; 
  onSelectedItemChange: (value: string) => void; 
  disabled?: boolean;
}

const itemOptions = ["TOC", "TN", "TP", "COD", "TN/TP"]; // Added TN/TP

const AnalysisContextForm: React.FC<AnalysisContextFormProps> = ({
  receiptNumber,
  onReceiptNumberChange,
  siteLocation,
  onSiteLocationChange,
  // inspectionStartDate, // Removed
  // onInspectionStartDateChange, // Removed
  selectedItem,
  onSelectedItemChange,
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
              접수번호 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              id="receipt-number"
              name="receipt-number"
              value={receiptNumber}
              onChange={(e) => onReceiptNumberChange(e.target.value)}
              disabled={disabled}
              required
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors duration-150 ease-in-out disabled:opacity-60"
              placeholder="예: 25-000000-01-1"
            />
          </div>

          <div>
            <label htmlFor="site-location" className="block text-sm font-medium text-slate-300 mb-1">
              현장 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              id="site-location"
              name="site-location"
              value={siteLocation}
              onChange={(e) => onSiteLocationChange(e.target.value)}
              disabled={disabled}
              required
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400 transition-colors duration-150 ease-in-out disabled:opacity-60"
              placeholder="예: 공공하수처리시설"
            />
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-1 gap-x-6 gap-y-4"> {/* Changed to sm:grid-cols-1 */}
          {/* Inspection Start Date input removed */}
          <div>
            <label htmlFor="item-selection" className="block text-sm font-medium text-slate-300 mb-1">
              항목 <span className="text-red-400">*</span>
            </label>
            <select
              id="item-selection"
              name="item-selection"
              value={selectedItem}
              onChange={(e) => onSelectedItemChange(e.target.value)}
              disabled={disabled}
              required
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm transition-colors duration-150 ease-in-out disabled:opacity-60"
            >
              <option value="" disabled>항목 선택...</option>
              {itemOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-1 text-xs text-slate-400">
          접수번호, 현장명, 항목은 필수 입력 항목입니다.
        </p>
      </div>
    </div>
  );
};

export { AnalysisContextForm as AdditionalInfoInput };
export default AnalysisContextForm;
