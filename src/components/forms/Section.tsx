import React from 'react';

const Section: React.FC<{title: string, children: React.ReactNode, titleAction?: React.ReactNode, className?: string}> = ({title, children, titleAction, className}) => (
    <div className={`space-y-3 ${className || ''}`}>
        <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-sky-300">{title}</h3>
            {titleAction}
        </div>
        <div className="space-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">{children}</div>
    </div>
);

export default Section;
