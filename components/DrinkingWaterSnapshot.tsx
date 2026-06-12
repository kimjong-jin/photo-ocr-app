

import React from 'react';
import type { DrinkingWaterJob } from '../DrinkingWaterPage';
import { DRINKING_WATER_IDENTIFIERS } from '../shared/constants';

interface DrinkingWaterSnapshotProps {
  job: DrinkingWaterJob;
  siteName: string;
}

const formatSite = (site: string, details?: string) =>
  details && details.trim() ? `${site.trim()}_(${details.trim()})` : site.trim();

export const DrinkingWaterSnapshot: React.FC<DrinkingWaterSnapshotProps> = ({ job, siteName }) => {
  const finalSite = formatSite(siteName, job.details);
  const isTuClMode = job.selectedItem === 'TU/CL';

  const dataToRender = job.processedOcrData?.length ? job.processedOcrData : DRINKING_WATER_IDENTIFIERS.map(id => ({ id: self.crypto.randomUUID(), identifier: id, value: '', time: '', valueTP: isTuClMode ? '' : undefined }));

  // 공공기관 용지 절약: 흰 바탕 + 검은 글씨
  const primaryTextColor = '#0f172a'; // slate-900 (거의 검정) — 본문
  const secondaryTextColor = '#475569'; // slate-600 — No./시간 등 보조

  return (
    <div
      id={`snapshot-container-for-${job.id}`}
      style={{
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: '800px',
        padding: '24px',
        backgroundColor: '#ffffff', // 흰 바탕
        color: primaryTextColor,
        fontFamily: 'Inter, sans-serif',
        lineHeight: '1.5',
      }}
    >
      <div style={{
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#0f172a',
        backgroundColor: '#f1f5f9',
        padding: '12px 16px',
        borderRadius: '8px',
        marginBottom: '24px',
        borderLeft: '4px solid #0284c7'
      }}>
        먹는물 분석 데이터: {job.receiptNumber} / {finalSite}
      </div>
      <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead style={{ backgroundColor: '#f1f5f9' }}>
            <tr>
              <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #cbd5e1', color: primaryTextColor }}>No.</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid #cbd5e1', color: primaryTextColor }}>구분</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #cbd5e1', color: primaryTextColor }}>{isTuClMode ? 'TU 측정치' : '측정치'}</th>
              {isTuClMode && <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #cbd5e1', color: primaryTextColor }}>Cl 측정치</th>}
              <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #cbd5e1', color: primaryTextColor }}>최종 저장 시간</th>
            </tr>
          </thead>
          <tbody>
            {dataToRender.map((entry, index) => (
              <tr key={entry.id} style={{ borderTop: '1px solid #e2e8f0', backgroundColor: index % 2 === 0 ? '#f8fafc' : '#ffffff' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: secondaryTextColor }}>{index + 1}</td>
                <td style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 500, color: primaryTextColor }}>{entry.identifier}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: primaryTextColor }}>{entry.value || '-'}</td>
                {isTuClMode && <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: primaryTextColor }}>{entry.valueTP || '-'}</td>}
                <td style={{ padding: '10px 12px', textAlign: 'center', color: secondaryTextColor }}>{entry.time || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
