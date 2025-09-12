import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ActionButton } from './ActionButton';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CORRECT_PASSWORD = '1111';

const PasswordModal: React.FC<PasswordModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (password === CORRECT_PASSWORD) {
      onSuccess();
    } else {
      setError('비밀번호가 올바르지 않습니다.');
      setPassword('');
      inputRef.current?.focus();
    }
  }, [password, onSuccess]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900 bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      aria-labelledby="password-modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-800 p-6 rounded-xl shadow-2xl w-full max-w-sm">
        {/* Visually hidden title for accessibility */}
        <h2 id="password-modal-title" className="sr-only">
          비밀번호 입력
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            className="block w-full p-3 bg-slate-700 border border-slate-600 rounded-lg shadow-sm focus:ring-2 focus:ring-sky-500 text-slate-100 text-center text-lg tracking-widest placeholder-slate-500"
            aria-describedby={error ? "password-error" : undefined}
          />
          {error && (
            <p id="password-error" className="text-red-400 text-xs text-center">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <ActionButton type="button" onClick={onClose} variant="secondary">
              취소
            </ActionButton>
            <ActionButton type="submit">
              확인
            </ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordModal;
