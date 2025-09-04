import React, { useState, useEffect, useMemo } from 'react';
import { ActionButton } from './ActionButton';
import { LoadedData } from '../services/apiService';
import { ANALYSIS_ITEM_GROUPS } from '../shared/constants';
import { MAIN_STRUCTURAL_ITEMS } from '../shared/structuralChecklists';

export interface LoadSelections {
  photoLog: string[];
  fieldCount: string[];
  drinkingWater: string[];
  structuralCheck: string[];
}

interface LoadDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selections: LoadSelections) => void;
  loadedData: LoadedData;
}

const LoadDataModal: React.FC<LoadDataModalProps> = ({ isOpen, onClose, onConfirm, loadedData }) => {
  const [selections, setSelections] = useState<LoadSelections>({
    photoLog: [],
    fieldCount: [],
    drinkingWater: [],
    structuralCheck: [],
  });

  const categorizedItems = useMemo(() => {
    const p1Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [];
    const p2Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '현장 계수')?.items || [];
    const p3Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '먹는물')?.items || [];
    const p4Items = MAIN_STRUCTURAL_ITEMS.map(i => i.key);

    const available = {
      photoLog: new Set<string>(),
      fieldCount: new Set<string>(),
      drinkingWater: new Set<string>(),
      structuralCheck: new Set<string>(),
    };
    
    if (loadedData.values.TN && loadedData.values.TP) {
      if (p1Items.includes('TN/TP')) available.photoLog.add('TN/TP');
      if (p2Items.includes('TN/TP')) available.fieldCount.add('TN/TP');
    }
    
    loadedData.item.forEach(item => {
      if (p1Items.includes(item)) available.photoLog.add(item);
      if (p2Items.includes(item)) available.fieldCount.add(item);
      if (p3Items.includes(item)) available.drinkingWater.add(item);
      if (p4Items.includes(item as any)) available.structuralCheck.add(item);
    });

    if(loadedData.values.TU && loadedData.values.Cl && p3Items.includes('TU/CL')) {
      available.drinkingWater.add('TU/CL');
      available.drinkingWater.delete('TU');
      available.drinkingWater.delete('Cl');
    }

    return {
      photoLog: Array.from(available.photoLog),
      fieldCount: Array.from(available.fieldCount),
      drinkingWater: Array.from(available.drinkingWater),
      structuralCheck: Array.from(available.structuralCheck),
    };
  }, [loadedData]);

  useEffect(() => {
    if (isOpen) {
      setSelections({
        photoLog: categorizedItems.photoLog,
        fieldCount: categorizedItems.fieldCount,
        drinkingWater: categorizedItems.drinkingWater,
        structuralCheck: categorizedItems.structuralCheck,
      });
    }
  }, [isOpen, categorizedItems]);
  
  const handleToggle = (page: keyof LoadSelections, item: string) => {
    setSelections(prev => {
        const current = prev[page];
        const newItems = current.includes(item)
            ? current.filter(i => i !== item)
            : [...current, item];
        return { ...prev, [page]: newItems };
    });
  };

  const handleToggleAll = (page: keyof LoadSelections, items: string[]) => {
    setSelections(prev => {
        const allSelected = items.every(item => prev[page].includes(item));
        return { ...prev, [page]: allSelected ? [] : [...items] };
    });
  };

  const renderSection = (title: string, pageKey: keyof LoadSelections, items: string[]) => {
    if (items.length === 0) return null;
    const allSelected = items.every(item => selections[pageKey].includes(item));
    return (
        <section key={pageKey}>
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-slate-200">{title} ({items.length}개)</h3>
                <button type="button" onClick={() => handleToggleAll(pageKey, items)} className="text-xs text-sky-400 hover:text-sky-300">
                    {allSelected ? '전체 해제' : '전체 선택'}
                </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-700/50 p-3 rounded-md">
                {items.map(item => {
                    const itemName = pageKey === 'structuralCheck' ? MAIN_STRUCTURAL_ITEMS.find(i => i.key === item)?.name || item : item;
                    return (
                        <label key={item} className="flex items-center space-x-2 p-1.5 rounded hover:bg-slate-600/50 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selections[pageKey].includes(item)}
                                onChange={() => handleToggle(pageKey, item)}
                                className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="text-sm text-slate-300">{itemName}</span>
                        </label>
                    );
                })}
            </div>
        </section>
    );
  };
  
  if (!isOpen) return null;

  const totalSelected = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <h2 className="text-2xl font-bold text-sky-400 mb-4 pb-3 border-b border-slate-700">
          불러올 작업 선택
        </h2>
        <p className="text-sm text-slate-400 mb-4">서버에서 '{loadedData.receipt_no}'에 대한 데이터를 찾았습니다. 불러올 항목을 선택하세요.</p>

        <div className="overflow-y-auto space-y-6 pr-2 flex-grow">
          {renderSection('수질 분석 (P1)', 'photoLog', categorizedItems.photoLog)}
          {renderSection('현장 계수 (P2)', 'fieldCount', categorizedItems.fieldCount)}
          {renderSection('먹는물 분석 (P3)', 'drinkingWater', categorizedItems.drinkingWater)}
          {renderSection('구조 확인 (P4)', 'structuralCheck', categorizedItems.structuralCheck)}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-700 flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
          <ActionButton onClick={onClose} variant="secondary" className="w-full sm:w-auto">
            취소
          </ActionButton>
          <ActionButton onClick={() => onConfirm(selections)} variant="primary" className="w-full sm:w-auto" disabled={totalSelected === 0}>
            선택한 작업 불러오기 ({totalSelected}개)
          </ActionButton>
        </div>
      </div>
    </div>
  );
};

export default LoadDataModal;
