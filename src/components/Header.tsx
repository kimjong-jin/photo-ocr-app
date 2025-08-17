import React from 'react';

interface HeaderProps {
  title: string;
  description: string;
}

export const Header: React.FC<HeaderProps> = ({ title, description }) => (
  <header className="w-full max-w-4xl mb-8 text-center">
    <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
      {title}
    </h1>
    <p className="text-slate-400 mt-2 text-md sm:text-lg px-2">
      {description}
    </p>
  </header>
);
