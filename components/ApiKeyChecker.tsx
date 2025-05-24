
import React from 'react';
import { AlertTriangleIcon } from '../constants';

interface ApiKeyCheckerProps {
  children: React.ReactNode;
}

// This value is expected to be set in the environment where the code runs.
// For local development, you might use a .env file and a bundler like Vite/CRA.
// For the target environment, it's assumed to be pre-configured.
const API_KEY = process.env.API_KEY;

const ApiKeyChecker: React.FC<ApiKeyCheckerProps> = ({ children }) => {
  if (!API_KEY) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-300 p-8">
        <AlertTriangleIcon />
        <h2 className="text-2xl font-bold mb-2 text-red-400">API Key Missing</h2>
        <p className="text-center max-w-md">
          The Google Gemini API key is not configured. Please ensure the <code>API_KEY</code> environment variable is set in your execution environment.
        </p>
        <p className="text-sm mt-4 text-slate-500">This application cannot function without the API key.</p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ApiKeyChecker;
