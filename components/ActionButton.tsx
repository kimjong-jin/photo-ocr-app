import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const ActionButton: React.FC<ActionButtonProps> = ({ 
  children, 
  variant = 'primary', 
  icon, 
  fullWidth = false,
  className, 
  ...props 
}) => {
  const baseStyle = "font-semibold py-2.5 px-5 rounded-lg transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 flex items-center justify-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed";
  
  let variantStyle = '';
  switch (variant) {
    case 'primary':
      variantStyle = 'bg-sky-500 hover:bg-sky-600 text-white focus:ring-sky-500';
      break;
    case 'secondary':
      variantStyle = 'bg-slate-600 hover:bg-slate-500 text-slate-100 focus:ring-slate-500';
      break;
    case 'danger':
      variantStyle = 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500';
      break;
  }

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button 
      className={`${baseStyle} ${variantStyle} ${widthStyle} ${className || ''}`}
      {...props}
    >
      {icon && <span className="w-5 h-5">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};
