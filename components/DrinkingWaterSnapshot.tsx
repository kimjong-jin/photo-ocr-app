
import React from 'react';
import type { DrinkingWaterJob } from '../DrinkingWaterPage';
import { DRINKING_WATER_IDENTIFIERS } from '../shared/constants';

interface DrinkingWaterSnapshotProps {
  job: DrinkingWaterJob;
}

const formatSite = (site: string, details?: string) =>
  details && details.trim() ? `${site.trim()}_(${details.trim()})` : site.trim();

export const DrinkingWaterSnapshot: React.FC<DrinkingWaterSnapshotProps> = ({ job, siteLocation }) => {
  const finalSite = formatSite(siteLocation, job.details);
  const isTuClMode = job.selectedItem === 'TU/CL';

  const dataToRender = job.processedOcrData?.length ? job.processedOcrData : DRINKING_WATER_IDENTIFIERS.map(id => ({ id: self.crypto.randomUUID(), identifier: id, value: '', time: '', valueTP: isTuClMode ? '' : undefined }));

  return (
    <div
      id={`snapshot-container-for-${job.id}`}
      style={{
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: '800px',
        padding: '24px',
        backgroundColor: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'Inter, sans-serif',
        lineHeight: '1.5',
      }}
    >
      <div style={{
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#e2e8f0',
        backgroundColor: '#1e293b',
        padding: '12px 16px',
        borderRadius: '8px',
        marginBottom: '24px',
        borderLeft: '4px solid #38bdf8'
      }}>
        먹는물 분석 데이터: {job.receiptNumber} / {finalSite}
      </div>
      <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead style={{ backgroundColor: '#1e293b' }}>
            <tr>
              <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #334155' }}>No.</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid #334155' }}>구분</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #334155' }}>{isTuClMode ? 'TU 측정치' : '측정치'}</th>
              {isTuClMode && <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Cl 측정치</th>}
              <th style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #334155' }}>최종 저장 시간</th>
            </tr>
          </thead>
          <tbody>
            {dataToRender.map((entry, index) => (
              <tr key={entry.id} style={{ borderTop: '1px solid #334155', backgroundColor: index % 2 === 0 ? '#1e293b' : 'transparent' }}>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8' }}>{index + 1}</td>
                <td style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 500 }}>{entry.identifier}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: '#cbd5e1' }}>{entry.value || '-'}</td>
                {isTuClMode && <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: '#cbd5e1' }}>{entry.valueTP || '-'}</td>}
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8' }}>{entry.time || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
