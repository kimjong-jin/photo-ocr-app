import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  CHECKLIST_DEFINITIONS,
  MAIN_STRUCTURAL_ITEMS,
  CertificateDetails,
  EMISSION_STANDARD_ITEM_NAME,
  RESPONSE_TIME_ITEM_NAME,
} from '../../shared/structuralChecklists';
import type { StructuralJob } from '../../StructuralCheckPage';

interface ChecklistSnapshotProps {
  job: StructuralJob;
}

const TARGET_W = 800;
const TARGET_H = 1131; // A4 비율 높이(800 * 1.414)

/** 노트 접두어 */
const getNotePrefix = (itemName: string): string | null => {
  if (itemName === EMISSION_STANDARD_ITEM_NAME) return '기준';
  if (itemName === RESPONSE_TIME_ITEM_NAME) return '분'; // 응답시간 단위
  switch (itemName) {
    case '측정범위확인':
      return '범위';
    case '측정방법확인':
      return '방법';
    case '기기번호 확인':
      return '기기번호';
    default:
      return null;
  }
};

/** 정도검사 증명서 노트 포맷 */
const formatCertificateNotes = (notes: string): string => {
  try {
    const details: CertificateDetails = JSON.parse(notes);
    if (details.presence !== 'present') {
      return details.presence === 'initial_new'
        ? '최초정도검사'
        : details.presence === 'reissued_lost'
        ? '분실 후 재발행'
        : '정보 없음';
    }
    const fields = [
      details.productName ? `품명: ${details.productName}` : null,
      details.manufacturer ? `제작사: ${details.manufacturer}` : null,
      details.serialNumber ? `기기번호: ${details.serialNumber}` : null,
      details.typeApprovalNumber ? `형식승인번호: ${details.typeApprovalNumber}` : null,
      details.inspectionDate ? `검사일자: ${details.inspectionDate}` : null,
      details.validity ? `유효기간: ${details.validity}` : null,
    ].filter(Boolean) as string[];
    return fields.length > 0 ? fields.join('\n') : '정보 없음';
  } catch {
    return notes; // 파싱 실패 시 원문 반환
  }
};

/** 표시사항확인 노트 포맷 */
const formatMarkingCheckNotes = (notes: string): string => {
  try {
    const details: Record<string, string> = JSON.parse(notes);
    const fields = Object.entries(details)
      .map(([key, value]) => (value ? `${key}: ${value}` : null))
      .filter(Boolean) as string[];
    return fields.length > 0 ? fields.join('\n') : '정보 없음';
  } catch {
    return notes; // 파싱 실패 시 원문 반환
  }
};

/** 상태 뱃지 */
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  let bgColor = '#64748b'; // slate-500
  let textColor = '#f8fafc'; // slate-50
  if (status === '적합') bgColor = '#22c55e'; // green-500
  if (status === '부적합') bgColor = '#ef4444'; // red-500
  return (
    <span
      style={{
        backgroundColor: bgColor,
        color: textColor,
        padding: '4px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        minWidth: '50px',
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      {status}
    </span>
  );
};

export const ChecklistSnapshot: React.FC<ChecklistSnapshotProps> = ({ job }) => {
  const mainItemName =
    MAIN_STRUCTURAL_ITEMS.find((item) => item.key === job.mainItemKey)?.name ||
    job.mainItemKey;

  const checklistItems = CHECKLIST_DEFINITIONS[job.mainItemKey];
  const isFixedDateItem =
    job.mainItemKey === 'PH' || job.mainItemKey === 'TU' || job.mainItemKey === 'Cl';

  // --- 비교 노트 산출 ---
  let comparisonNote: string | null = null;
  const markingCheckData = job.checklistData['표시사항확인'];
  const certificateData = job.checklistData['정도검사 증명서'];

  if (markingCheckData?.notes && certificateData?.notes) {
    let markingDetails: Record<string, string> | null = null;
    try {
      const parsed = JSON.parse(markingCheckData.notes);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        markingDetails = {};
        for (const key in parsed) {
          if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            markingDetails[key] = String(parsed[key]); // 문자열 정규화
          }
        }
      }
    } catch {
      /* silent */
    }

    let certDetails: CertificateDetails | null = null;
    try {
      const parsed = JSON.parse(certificateData.notes);
      if (typeof parsed === 'object' && parsed !== null) {
        certDetails = parsed as CertificateDetails;
      }
    } catch {
      /* silent */
    }

    if (markingDetails && certDetails && certDetails.presence === 'present') {
      const norm = (s: string | undefined) =>
        (s || '')
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/제|호/g, '');

      const messages: string[] = [];
      let allMatch = true;
      let anyComparisonMade = false;

      const markingManufacturerVal = markingDetails['제조회사'];
      const certManufacturerVal = certDetails.manufacturer;
      if (markingManufacturerVal || certManufacturerVal) {
        anyComparisonMade = true;
        if (norm(markingManufacturerVal) !== norm(certManufacturerVal)) {
          messages.push(
            `제조사 (표시사항: "${markingManufacturerVal || '없음'}" vs 증명서: "${
              certManufacturerVal || '없음'
            }")`,
          );
          allMatch = false;
        }
      }

      const markingTypeApprovalVal = markingDetails['형식승인번호'];
      const certTypeApprovalVal = certDetails.typeApprovalNumber;
      if (markingTypeApprovalVal || certTypeApprovalVal) {
        anyComparisonMade = true;
        if (norm(markingTypeApprovalVal) !== norm(certTypeApprovalVal)) {
          messages.push(
            `형식승인번호 (표시사항: "${markingTypeApprovalVal || '없음'}" vs 증명서: "${
              certTypeApprovalVal || '없음'
            }")`,
          );
          allMatch = false;
        }
      }

      const markingSerialVal = markingDetails['기기고유번호'];
      const certSerialVal = certDetails.serialNumber;
      if (markingSerialVal || certSerialVal) {
        anyComparisonMade = true;
        if (norm(markingSerialVal) !== norm(certSerialVal)) {
          messages.push(
            `기기/제작번호 (표시사항: "${markingSerialVal || '없음'}" vs 증명서: "${
              certSerialVal || '없음'
            }")`,
          );
          allMatch = false;
        }
      }

      if (anyComparisonMade) {
        comparisonNote = allMatch
          ? '(참고) 표시사항과 증명서 정보가 일치합니다.'
          : `(주의) 표시사항과 증명서 정보가 다릅니다:\n- ${messages.join('\n- ')}\n내용을 확인하세요.`;
      }
    }
  }
  // --- End ---

  // ====== 스케일 자동 맞춤 ======
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0); // 가로 중앙 정렬용 translateX

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;

    // 1) 측정 전 초기화 (원래 크기에서 높이 측정)
    node.style.transform = 'none';
    node.style.width = `${TARGET_W}px`;
    node.style.height = 'auto';
    node.style.overflow = 'visible';
    node.style.transformOrigin = 'top left';

    const raf = requestAnimationFrame(() => {
      const realH = node.scrollHeight; // 실제 콘텐츠 높이
      const s = realH > TARGET_H ? TARGET_H / realH : 1; // 축소 비율
      setScale(s);
      setTx((TARGET_W - TARGET_W * s) / 2); // 가로 중앙 정렬
    });

    return () => cancelAnimationFrame(raf);
    // job이 바뀌거나 내용이 변하면 다시 계산
  }, [job]);
  // ============================

  // 비교 노트 스타일
  const compIsWarn = (comparisonNote || '').startsWith('(주의)');
  const compBorderColor = compIsWarn ? '#f59e0b' : '#38bdf8';
  const compBg = compIsWarn ? 'rgba(245, 158, 11, 0.1)' : 'rgba(56, 189, 248, 0.1)';
  const compColor = compIsWarn ? '#fcd34d' : '#7dd3fc';

  return (
    // === 외곽 래퍼: A4 한 장 크기 고정 ===
    <div
      id={`snapshot-container-for-${job.id}`}
      style={{
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: `${TARGET_W}px`,
        height: `${TARGET_H}px`,
        overflow: 'hidden', // 스케일 후에도 넘침 방지
        backgroundColor: '#0f172a', // 바탕색 동일
      }}
    >
      {/* === 실제 콘텐츠 컨테이너(스케일 대상) === */}
      <div
        ref={innerRef}
        style={{
          width: `${TARGET_W}px`,
          minHeight: `${TARGET_H}px`,
          boxSizing: 'border-box',
          padding: '24px',
          backgroundColor: '#0f172a', // slate-900
          color: '#e2e8f0', // slate-200
          fontFamily: 'Inter, sans-serif',
          lineHeight: 1.5,
          transformOrigin: 'top left',
          transform: `translateX(${tx}px) scale(${scale})`,
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#e2e8f0',
            backgroundColor: '#1e293b', // slate-800
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '24px',
            borderLeft: '4px solid #38bdf8', // sky-500
          }}
        >
          구조 확인 체크리스트: {job.receiptNumber} / {mainItemName}
        </div>

        {/* 본문 카드 */}
        <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#1e293b',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              borderBottom: '1px solid #334155',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '16px', color: '#f8fafc' }}>
              {isFixedDateItem ? '사후검사일' : '사후검사 유효일자'}: {job.postInspectionDate}
            </span>
            {job.postInspectionDateConfirmedAt && (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                (확인: {job.postInspectionDateConfirmedAt})
              </span>
            )}
          </div>

          {checklistItems.map((itemName, index) => {
            const data = job.checklistData[itemName];
            if (!data) return null;

            // TOC 특수 항목(배출기준/응답시간): 뱃지만 숨기고 번호는 포함
            const isSpecialTocItem =
              job.mainItemKey === 'TOC' &&
              (itemName === EMISSION_STANDARD_ITEM_NAME || itemName === RESPONSE_TIME_ITEM_NAME);

            const displayItemNumber = index + 1;
            const isAiReferenceItem = itemName === '표시사항확인' || itemName === '정도검사 증명서';

            let notesToDisplay = data.notes || '';
            if (itemName === '정도검사 증명서') {
              notesToDisplay = formatCertificateNotes(data.notes || '');
            } else if (itemName === '표시사항확인') {
              notesToDisplay = formatMarkingCheckNotes(data.notes || '');
            }

            const notePrefix = getNotePrefix(itemName);

            return (
              <div
                key={itemName}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #334155',
                  backgroundColor: '#1e293b',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: 'calc(100% - 80px)' }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '16px',
                        color: '#f8fafc',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '6px',
                      }}
                    >
                      <span>
                        {`${displayItemNumber}. `}
                        {itemName}
                      </span>
                      {isAiReferenceItem && (
                        <span style={{ fontSize: '12px', color: '#c084fc', whiteSpace: 'nowrap' }}>
                          (AI 분석 참고)
                        </span>
                      )}
                    </span>

                    {data.confirmedAt && !isSpecialTocItem && (
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>(확인: {data.confirmedAt})</span>
                    )}

                    {notesToDisplay && notesToDisplay.trim() && (
                      <span style={{ fontSize: '14px', color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {notePrefix ? <strong>{notePrefix}: </strong> : null}
                        {notesToDisplay}
                      </span>
                    )}

                    {data.specialNotes && data.specialNotes.trim() && (
                      <span style={{ fontSize: '14px', color: '#f59e0b', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        <strong>특이사항: </strong>
                        {data.specialNotes}
                      </span>
                    )}
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    {!isSpecialTocItem ? <StatusBadge status={data.status} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {comparisonNote && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '14px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: `1px solid ${compBorderColor}`,
              backgroundColor: compBg,
              color: compColor,
            }}
          >
            {comparisonNote}
          </div>
        )}
      </div>
      {/* === /실제 콘텐츠 컨테이너 === */}
    </div>
    // === /외곽 래퍼 ===
  );
};
