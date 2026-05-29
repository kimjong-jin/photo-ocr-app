import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ReactNode;
  fullWidth?: boolean;
  isAnalyzed?: boolean;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  children,
  variant = 'primary',
  icon,
  fullWidth = false,
  isAnalyzed,
  className,
  ...props
}) => {
  const baseStyle = "font-semibold py-2 px-4 rounded-lg transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-slate-900 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed text-sm tracking-wide";

  let variantStyle = '';
  switch (variant) {
    case 'primary':
      variantStyle = 'bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white focus:ring-sky-500 shadow-sm shadow-sky-900/40';
      break;
    case 'secondary':
      variantStyle = 'bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-200 focus:ring-slate-500 border border-slate-600/60';
      break;
    case 'danger':
      variantStyle = 'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white focus:ring-red-500 shadow-sm shadow-red-900/40';
      break;
  }

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseStyle} ${variantStyle} ${widthStyle} ${className || ''}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
      {isAnalyzed && (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 text-green-300 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </button>
  );
};
