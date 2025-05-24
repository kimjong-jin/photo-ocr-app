
import React from 'react';

interface LoadingSpinnerProps {
  text?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ text = "Processing..."}) => {
  return (
    <div className="flex items-center justify-center space-x-2" aria-label={text} role="status">
      <div className="w-3 h-3 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="w-3 h-3 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="w-3 h-3 bg-white rounded-full animate-bounce"></div>
      <span className="ml-2 text-sm text-white">{text}</span>
    </div>
  );
};

export default LoadingSpinner;
