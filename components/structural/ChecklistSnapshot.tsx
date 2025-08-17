import React from 'react';
import { CHECKLIST_DEFINITIONS, MAIN_STRUCTURAL_ITEMS, CertificateDetails } from '../../shared/structuralChecklists';
import type { StructuralJob } from '../../StructuralCheckPage';

interface ChecklistSnapshotProps {
  job: StructuralJob;
}

const getNotePrefix = (itemName: string): string | null => {
    switch (itemName) {
        case "측정범위확인": return "범위";
        case "측정방법확인": return "방법";
        case "기기번호 확인": return "기기번호";
        default: return null;
    }
};

const formatCertificateNotes = (notes: string): string => {
    try {
        const details: CertificateDetails = JSON.parse(notes);
        if (details.presence !== 'present') {
            return details.presence === 'initial_new' ? '최초정도검사' : details.presence === 'reissued_lost' ? '분실 후 재발행' : '정보 없음';
        }
        const fields = [
            details.productName && `품명: ${details.productName}`,
            details.manufacturer && `제작사: ${details.manufacturer}`,
            details.serialNumber && `기기번호: ${details.serialNumber}`,
            details.typeApprovalNumber && `형식승인번호: ${details.typeApprovalNumber}`,
            details.inspectionDate && `검사일자: ${details.inspectionDate}`,
            details.validity && `유효기간: ${details.validity}`,
        ].filter(Boolean);

        return fields.length > 0 ? fields.join('\n') : '정보 없음';
    } catch {
        return notes; // Return raw notes if parsing fails
    }
};

const formatMarkingCheckNotes = (notes: string): string => {
    try {
        const details: Record<string, string> = JSON.parse(notes);
        const fields = Object.entries(details)
            .map(([key, value]) => value ? `${key}: ${value}` : null)
            .filter(Boolean);
        return fields.length > 0 ? fields.join('\n') : '정보 없음';
    } catch {
        return notes; // Return raw notes if parsing fails
    }
};

export const ChecklistSnapshot: React.FC<ChecklistSnapshotProps> = ({ job }) => {
  const mainItemName = MAIN_STRUCTURAL_ITEMS.find(item => item.key === job.mainItemKey)?.name || job.mainItemKey;
  const checklistItems = CHECKLIST_DEFINITIONS[job.mainItemKey];
  
  const isFixedDateItem = job.mainItemKey === 'PH' || job.mainItemKey === 'TU' || job.mainItemKey === 'Cl';

  // --- Start: Logic to calculate comparison note ---
  let comparisonNote: string | null = null;
  const markingCheckData = job.checklistData["표시사항확인"];
  const certificateData = job.checklistData["정도검사 증명서"];

  if (markingCheckData?.notes && certificateData?.notes) {
      let markingDetails: Record<string, string> | null = null;
      try {
          const parsed = JSON.parse(markingCheckData.notes);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              markingDetails = {};
              for (const key in parsed) {
                  if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                      markingDetails[key] = String(parsed[key]);
                  }
              }
          }
      } catch (e) { /* silent fail */ }

      let certDetails: CertificateDetails | null = null;
      try {
          const parsed = JSON.parse(certificateData.notes);
          if (typeof parsed === 'object' && parsed !== null) certDetails = parsed as CertificateDetails;
      } catch (e) { /* silent fail */ }

      if (markingDetails && certDetails && certDetails.presence === 'present') {
          const norm = (s: string | undefined) => (s || '').toLowerCase().replace(/\s+/g, '').replace(/제|호/g, '');
          const messages: string[] = [];
          let allMatch = true;
          let anyComparisonMade = false;

          const markingManufacturerVal = markingDetails['제조회사'];
          const certManufacturerVal = certDetails.manufacturer;
          if (markingManufacturerVal || certManufacturerVal) {
            anyComparisonMade = true;
            if (norm(markingManufacturerVal) !== norm(certManufacturerVal)) {
              messages.push(`제조사 (표시사항: "${markingManufacturerVal || '없음'}" vs 증명서: "${certManufacturerVal || '없음'}")`);
              allMatch = false;
            }
          }

          const markingTypeApprovalVal = markingDetails['형식승인번호'];
          const certTypeApprovalVal = certDetails.typeApprovalNumber;
           if (markingTypeApprovalVal || certTypeApprovalVal) {
            anyComparisonMade = true;
            if (norm(markingTypeApprovalVal) !== norm(certTypeApprovalVal)) {
              messages.push(`형식승인번호 (표시사항: "${markingTypeApprovalVal || '없음'}" vs 증명서: "${certTypeApprovalVal || '없음'}")`);
              allMatch = false;
            }
          }

          const markingSerialVal = markingDetails['기기고유번호'];
          const certSerialVal = certDetails.serialNumber;
          if (markingSerialVal || certSerialVal) {
            anyComparisonMade = true;
            if (norm(markingSerialVal) !== norm(certSerialVal)) {
              messages.push(`기기/제작번호 (표시사항: "${markingSerialVal || '없음'}" vs 증명서: "${certSerialVal || '없음'}")`);
              allMatch = false;
            }
          }

          if (anyComparisonMade) {
              if (allMatch) {
                  comparisonNote = "(참고) 표시사항과 증명서 정보가 일치합니다.";
              } else {
                  comparisonNote = `(주의) 표시사항과 증명서 정보가 다릅니다:\n- ${messages.join('\n- ')}\n내용을 확인하세요.`;
              }
          }
      }
  }
  // --- End: Logic to calculate comparison note ---

  const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    let bgColor = '#64748b'; // slate-500 for '선택 안됨'
    let textColor = '#f8fafc'; // slate-50
    if (status === '적합') bgColor = '#22c55e'; // green-500
    if (status === '부적합') bgColor = '#ef4444'; // red-500

    return (
      <span style={{
        backgroundColor: bgColor,
        color: textColor,
        padding: '4px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: '600',
        minWidth: '50px',
        textAlign: 'center'
      }}>
        {status}
      </span>
    );
  };

  return (
    <div
      id={`snapshot-container-for-${job.id}`}
      style={{
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: '800px',
        padding: '24px',
        backgroundColor: '#0f172a', // slate-900
        color: '#e2e8f0', // slate-200
        fontFamily: 'Inter, sans-serif',
        lineHeight: '1.5',
      }}
    >
      <div style={{
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#e2e8f0',
        backgroundColor: '#1e293b', // slate-800
        padding: '12px 16px',
        borderRadius: '8px',
        marginBottom: '24px',
        borderLeft: '4px solid #38bdf8' // sky-500
      }}>
        구조 확인 체크리스트: {job.receiptNumber} / {mainItemName}
      </div>

      <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{
            padding: '12px 16px',
            backgroundColor: '#1e293b',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            borderBottom: '1px solid #334155'
        }}>
          <span style={{ fontWeight: '600', fontSize: '16px', color: '#f8fafc' }}>
              {isFixedDateItem ? '사후검사일' : '사후검사 유효일자'}: {job.postInspectionDate}
          </span>
          {job.postInspectionDateConfirmedAt && (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>(확인: {job.postInspectionDateConfirmedAt})</span>
          )}
        </div>

        {checklistItems.map((itemName, index) => {
          const data = job.checklistData[itemName];
          if (!data) return null;
          
          const tocSpecialItemCount = job.mainItemKey === 'TOC' ? 2 : 0;
          const displayItemNumber = (index >= tocSpecialItemCount) ? index - tocSpecialItemCount + 1 : null;
          const isAiReferenceItem = itemName === "표시사항확인" || itemName === "정도검사 증명서";


          let notesToDisplay = data.notes || '';
          if (itemName === '정도검사 증명서') {
              notesToDisplay = formatCertificateNotes(data.notes || '');
          } else if (itemName === '표시사항확인') {
              notesToDisplay = formatMarkingCheckNotes(data.notes || '');
          }

          const notePrefix = getNotePrefix(itemName);
          
          return (
            <div key={itemName} style={{ padding: '12px 16px', borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: 'calc(100% - 80px)' }}>
                  <span style={{ fontWeight: '600', fontSize: '16px', color: '#f8fafc', display: 'flex', alignItems: 'baseline' }}>
                    <span>{displayItemNumber !== null && `${displayItemNumber}. `}{itemName}</span>
                    {isAiReferenceItem && (
                      <span style={{ fontSize: '12px', color: '#c084fc', marginLeft: '6px', whiteSpace: 'nowrap' }}>(AI 분석 참고)</span>
                    )}
                  </span>
                  {data.confirmedAt && (
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>(확인: {data.confirmedAt})</span>
                  )}
                  {notesToDisplay && notesToDisplay.trim() && (
                      <span style={{ fontSize: '14px', color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {notePrefix && <strong>{notePrefix}: </strong>}{notesToDisplay}
                      </span>
                  )}
                  {data.specialNotes && data.specialNotes.trim() && (
                      <span style={{ fontSize: '14px', color: '#f59e0b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          <strong>특이사항: </strong>{data.specialNotes}
                      </span>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>
                  <StatusBadge status={data.status} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {comparisonNote && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          borderRadius: '8px',
          fontSize: '14px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: `1px solid ${comparisonNote.startsWith('(주의)') ? '#f59e0b' : '#38bdf8'}`, // amber-500 or sky-500
          backgroundColor: `${comparisonNote.startsWith('(주의)') ? 'rgba(245, 158, 11, 0.1)' : 'rgba(56, 189, 248, 0.1)'}`, // amber/sky bg with opacity
          color: `${comparisonNote.startsWith('(주의)') ? '#fcd34d' : '#7dd3fc'}`, // amber-300 or sky-300
        }}>
          {comparisonNote}
        </div>
      )}
    </div>
  );
};
