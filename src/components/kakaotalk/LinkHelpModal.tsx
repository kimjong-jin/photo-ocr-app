import React from 'react';
import { ActionButton } from '../ActionButton';

const LinkHelpModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
      <div 
        className="fixed inset-0 bg-slate-900 bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-4 z-50" 
        onClick={onClose} 
        role="dialog" 
        aria-modal="true"
        aria-labelledby="link-help-modal-title"
      >
        <div className="bg-slate-800 p-6 rounded-xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
          <h3 id="link-help-modal-title" className="text-xl font-bold text-sky-400 mb-4">파일 공유 링크 만드는 방법</h3>
          <div className="space-y-4 text-slate-300 text-sm">
            <p>외부 클라우드 서비스를 이용해 파일을 공유하고, 공개된 링크를 사용해주세요.</p>
            <ol className="list-decimal list-inside space-y-3 bg-slate-700/50 p-4 rounded-md">
              <li>클라우드 서비스에 파일 업로드 (구글 드라이브 등)</li>
              <li>접근 권한을 <strong>'링크가 있는 모든 사용자'</strong>로 변경</li>
              <li>생성된 공개용 링크를 복사하여 앱에 붙여넣기</li>
            </ol>
             <p className="text-xs text-slate-400">참고: 이 앱은 파일을 직접 저장(호스팅)하지 않습니다.</p>
          </div>
          <div className="mt-6 text-right">
            <ActionButton onClick={onClose} variant="secondary">닫기</ActionButton>
          </div>
        </div>
      </div>
    );
};

export default LinkHelpModal;