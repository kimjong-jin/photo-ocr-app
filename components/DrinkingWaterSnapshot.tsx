import React from 'react';
import type { DrinkingWaterJob } from '../DrinkingWaterPage';

interface DrinkingWaterSnapshotProps {
  job: DrinkingWaterJob;
  siteLocation: string;
}

const dividerIdentifiers = new Set(['Z 2시간 시작 - 종료', '드리프트 완료', '반복성 완료']);

const formatResponseTimeValue = (value: string): {초: string; 분: string; 길이: string} => {
    try {
        if (value && value.trim().startsWith('[')) {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return {
                    초: String(parsed[0] || '-'),
                    분: String(parsed[1] || '-'),
                    길이: String(parsed[2] || '-')
                };
            }
        }
    } catch (e) { /* fall through */ }
    return { 초: '-', 분: '-', 길이: '-' };
};


export const DrinkingWaterSnapshot: React.FC<DrinkingWaterSnapshotProps> = ({ job, siteLocation }) => {
    const fullSite = job.details && job.details.trim() ? `${siteLocation.trim()}_(${job.details.trim()})` : siteLocation.trim();
    const showTwoValueColumns = job.selectedItem === 'TU/CL';
    
    // Inline styles
    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: '800px',
        padding: '24px',
        backgroundColor: '#0f172a', // slate-900
        color: '#e2e8f0', // slate-200
        fontFamily: 'Inter, sans-serif',
        lineHeight: '1.5',
    };

    const headerStyle: React.CSSProperties = {
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#e2e8f0',
        backgroundColor: '#1e293b', // slate-800
        padding: '12px 16px',
        borderRadius: '8px',
        marginBottom: '24px',
        borderLeft: '4px solid #38bdf8' // sky-500
    };

    const tableStyle: React.CSSProperties = {
        width: '100%',
        borderCollapse: 'collapse',
        border: '1px solid #334155',
        borderRadius: '8px',
        overflow: 'hidden',
    };
    
    const thStyle: React.CSSProperties = {
        backgroundColor: '#1e293b',
        padding: '12px',
        textAlign: 'center',
        fontSize: '12px',
        fontWeight: '600',
        color: '#94a3b8',
        textTransform: 'uppercase',
        borderBottom: '1px solid #334155',
    };

    const tdStyle: React.CSSProperties = {
        padding: '10px 12px',
        borderBottom: '1px solid #334155',
        fontSize: '14px',
        textAlign: 'center',
        verticalAlign: 'middle', // Key fix for vertical alignment
        color: '#cbd5e1',
        height: '50px' // Ensure consistent row height
    };
    
    const lastRowTdStyle: React.CSSProperties = { ...tdStyle, borderBottom: 'none' };

    const identifierTdStyle: React.CSSProperties = {
        ...tdStyle,
        color: '#f87171', // red-400
        fontWeight: '600'
    };

    return (
        <div id={`snapshot-container-for-${job.id}`} style={containerStyle}>
            <div style={headerStyle}>
                먹는물 분석 데이터: {job.receiptNumber} / {job.selectedItem} ({fullSite})
            </div>
            <table style={tableStyle}>
                <thead>
                    <tr>
                        <th style={{...thStyle, width: '5%'}}>NO.</th>
                        <th style={{...thStyle, width: '25%'}}>최종 저장 시간</th>
                        {showTwoValueColumns ? (
                            <>
                                <th style={thStyle}>TU 값</th>
                                <th style={thStyle}>Cl 값</th>
                            </>
                        ) : (
                            <th style={thStyle}>값</th>
                        )}
                        <th style={{...thStyle, width: '20%'}}>구분</th>
                    </tr>
                </thead>
                <tbody>
                    {(job.processedOcrData || []).map((entry, index) => {
                        const isLastRow = index === (job.processedOcrData?.length || 0) - 1;
                        const currentTdStyle = isLastRow ? lastRowTdStyle : tdStyle;
                        const currentIdentifierTdStyle = isLastRow ? { ...identifierTdStyle, ...lastRowTdStyle } : identifierTdStyle;

                        if (dividerIdentifiers.has(entry.identifier || '')) {
                            return (
                                <tr key={entry.id}>
                                    <td colSpan={showTwoValueColumns ? 5 : 4} style={{...currentTdStyle, padding: '16px 8px'}}>
                                        <div style={{ display: 'flex', alignItems: 'center', color: '#64748b' }}>
                                            <div style={{ flexGrow: 1, borderTop: '1px solid #475569' }}></div>
                                            <span style={{ padding: '0 16px', fontSize: '12px', fontWeight: '600' }}>
                                                {entry.identifier}
                                            </span>
                                            <div style={{ flexGrow: 1, borderTop: '1px solid #475569' }}></div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        }
                        
                        const isResponseTimeRow = entry.identifier === '응답';

                        return (
                            <tr key={entry.id}>
                                <td style={currentTdStyle}>{index + 1}</td>
                                <td style={{...currentTdStyle, fontSize: '13px'}}>{entry.time || '-'}</td>
                                
                                {isResponseTimeRow ? (
                                    <>
                                        <td colSpan={showTwoValueColumns ? 1 : 1} style={currentTdStyle}>
                                            {formatResponseTimeValue(entry.value).초} 초 / {formatResponseTimeValue(entry.value).분} 분 / {formatResponseTimeValue(entry.value).길이} mm
                                        </td>
                                        {showTwoValueColumns && (
                                            <td style={currentTdStyle}>
                                                    {formatResponseTimeValue(entry.valueTP || '').초} 초 / {formatResponseTimeValue(entry.valueTP || '').분} 분 / {formatResponseTimeValue(entry.valueTP || '').길이} mm
                                            </td>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <td style={currentTdStyle}>{entry.value || '-'}</td>
                                        {showTwoValueColumns && <td style={currentTdStyle}>{entry.valueTP || '-'}</td>}
                                    </>
                                )}

                                <td style={currentIdentifierTdStyle}>{isResponseTimeRow ? '응답시간' : entry.identifier}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
