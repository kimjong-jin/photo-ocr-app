import React from 'react';
import { Spinner } from '../Spinner';
import { CheckIcon, CrossIcon } from '../icons';
import { InstitutionEntry } from '../../types';

interface StatusIndicatorProps {
    status: InstitutionEntry['status'];
    message?: string;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, message }) => {
    if (status === 'idle') return null;
    
    const iconClass = "w-4 h-4 flex-shrink-0";
    
    const statusConfig = {
        sending: { text: 'text-sky-300', icon: <Spinner size="sm" color="text-sky-300" />, label: '전송 중...' },
        success: { text: 'text-green-400', icon: <CheckIcon className={iconClass} />, label: message || '성공' },
        error: { text: 'text-red-400', icon: <CrossIcon className={iconClass}/>, label: message || '실패' },
    };

    const { text, icon, label } = statusConfig[status];
    
    return (
        <div className={`flex items-center gap-1.5 text-xs mt-1 ${text}`} title={label}>
            {icon}
            <span className="truncate">{label}</span>
        </div>
    );
};

export default StatusIndicator;