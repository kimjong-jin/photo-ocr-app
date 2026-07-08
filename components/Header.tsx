import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ApiMode } from '../PageContainer';

interface HeaderProps {
  apiMode: ApiMode;
  onApiModeChange: (mode: ApiMode) => void;
  userName?: string;
  onLogout?: () => void;
  onKakaoTalkClick?: () => void;
}

const ACCENT_THEMES = [
  { id: 'sky',     color: '#0ea5e9', label: '블루' },
  { id: 'indigo',  color: '#6366f1', label: '인디고' },
  { id: 'violet',  color: '#8b5cf6', label: '바이올렛' },
  { id: 'emerald', color: '#10b981', label: '에메랄드' },
] as const;

const BG_THEMES = [
  { id: '',          color: '#020617', label: '기본',     icon: '🌑' },
  { id: 'midnight',  color: '#000000', label: '미드나잇', icon: '⬛' },
  { id: 'warm',      color: '#0c0a14', label: '웜',       icon: '🟣' },
  { id: 'stone',     color: '#0c0b0a', label: '스톤',     icon: '🟤' },
  { id: 'light',     color: '#f1f5f9', label: '라이트',   icon: '☀️' },
] as const;

const TEXT_THEMES = [
  { id: '',       label: '기본', sample: 'Aa' },
  { id: 'bright', label: '밝게', sample: 'Aa' },
  { id: 'soft',   label: '부드럽게', sample: 'Aa' },
] as const;

const FONT_SIZES = [
  { id: 'xs',  label: '소',   px: 13 },
  { id: 'sm',  label: '중소', px: 14 },
  { id: 'md',  label: '기본', px: 16 },
  { id: 'lg',  label: '대',   px: 18 },
  { id: 'xl',  label: '특대', px: 20 },
] as const;

type AccentId = typeof ACCENT_THEMES[number]['id'];
type BgId = typeof BG_THEMES[number]['id'];
type TextId = typeof TEXT_THEMES[number]['id'];
type FontSizeId = typeof FONT_SIZES[number]['id'];

// 비밀번호 변경 버튼 + 모달
const PwChangeButton: React.FC<{ userName: string; onLogout?: () => void }> = ({ userName, onLogout }) => {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [msg, setMsg] = useState<{text:string;ok:boolean}|null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!cur || !nw || !nw2) { setMsg({text:'모두 입력하세요',ok:false}); return; }
    if (nw !== nw2) { setMsg({text:'새 비밀번호가 일치하지 않습니다',ok:false}); return; }
    if (nw.length < 4) { setMsg({text:'4자 이상 입력하세요',ok:false}); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/change-password', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: userName, currentPassword: cur, newPassword: nw }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg({text:'✅ 변경됨. 다시 로그인해주세요.',ok:true});
        setTimeout(() => { setOpen(false); onLogout?.(); }, 1500);
      } else {
        setMsg({text:'❌ ' + (d.error||'오류'),ok:false});
      }
    } catch { setMsg({text:'서버 연결 실패',ok:false}); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button
        onClick={() => { setOpen(true); setCur(''); setNw(''); setNw2(''); setMsg(null); }}
        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-all border border-slate-700/40"
        title="비밀번호 변경"
      >🔑</button>
      {open && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4" onClick={e => e.target===e.currentTarget&&setOpen(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-xs shadow-2xl">
            <div className="text-sm font-bold text-slate-200 mb-4">🔑 비밀번호 변경</div>
            <div className="space-y-2">
              <input type="password" placeholder="현재 비밀번호" value={cur} onChange={e=>setCur(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500" />
              <input type="password" placeholder="새 비밀번호" value={nw} onChange={e=>setNw(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500" />
              <input type="password" placeholder="새 비밀번호 확인" value={nw2} onChange={e=>setNw2(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&submit()}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500" />
              {msg && <p className={`text-xs ${msg.ok?'text-green-400':'text-red-400'}`}>{msg.text}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={submit} disabled={loading}
                  className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                  {loading?'처리중...':'변경'}
                </button>
                <button onClick={()=>setOpen(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-2 rounded-lg transition-colors">
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export const Header: React.FC<HeaderProps> = ({ apiMode, onApiModeChange, userName, onLogout, onKakaoTalkClick }) => {
  const [accent, setAccent] = useState<AccentId>(() =>
    (localStorage.getItem('parser-theme') as AccentId) || 'sky'
  );
  const [bg, setBg] = useState<BgId>(() =>
    (localStorage.getItem('parser-bg') as BgId) || ''
  );
  const [textTheme, setTextTheme] = useState<TextId>(() =>
    (localStorage.getItem('parser-text') as TextId) || ''
  );
  const [fontSize, setFontSize] = useState<FontSizeId>(() =>
    (localStorage.getItem('parser-font-size') as FontSizeId) || 'md'
  );
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (accent === 'sky') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', accent);
    localStorage.setItem('parser-theme', accent);
  }, [accent]);

  useEffect(() => {
    if (!bg) document.documentElement.removeAttribute('data-bg');
    else document.documentElement.setAttribute('data-bg', bg);
    localStorage.setItem('parser-bg', bg);
  }, [bg]);

  useEffect(() => {
    if (!textTheme) document.documentElement.removeAttribute('data-text');
    else document.documentElement.setAttribute('data-text', textTheme);
    localStorage.setItem('parser-text', textTheme);
  }, [textTheme]);

  // html 루트 font-size 변경 → rem 기반 Tailwind 전체 스케일
  useEffect(() => {
    const size = FONT_SIZES.find(f => f.id === fontSize) ?? FONT_SIZES[2];
    document.documentElement.style.fontSize = `${size.px}px`;
    localStorage.setItem('parser-font-size', fontSize);
  }, [fontSize]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    if (showSettings) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const currentAccent = ACCENT_THEMES.find(t => t.id === accent)?.color ?? '#0ea5e9';
  const currentFontSize = FONT_SIZES.find(f => f.id === fontSize) ?? FONT_SIZES[2];

  return (
    <header className="w-full max-w-3xl mb-4 relative z-[100]" ref={settingsRef}>
      <div className="flex justify-between items-center w-full px-2.5 py-1.5 bg-slate-900/80 backdrop-blur-sm rounded-xl border border-slate-700/60 shadow-lg gap-1">
        {/* KTL 로고 */}
        <span className="text-sm font-bold tracking-widest text-sky-400 uppercase shrink-0">KTL</span>

        {/* 가운데: 테마 + 내부/외부 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={() => setShowSettings(s => !s)}
            title="화면 설정"
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] transition-all border shrink-0 ${
              showSettings
                ? 'bg-slate-700 text-slate-200 border-slate-600'
                : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span style={{ color: currentAccent, fontSize: 8 }}>●</span>
            <span className="hidden sm:inline">테마</span>
          </button>

          <div className="w-px h-3 bg-slate-700/80 shrink-0" />

          <div className="flex items-center bg-slate-800 rounded-md p-0.5 border border-slate-700/50 shrink-0">
            <button
              onClick={() => onApiModeChange('vllm')}
              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-all duration-150 ${
                apiMode === 'vllm' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >내부</button>
            <button
              onClick={() => onApiModeChange('gemini')}
              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-all duration-150 ${
                apiMode === 'gemini' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >외부</button>
          </div>
        </div>

        {/* 오른쪽: 카카오+이름+로그아웃 */}
        <div className="flex items-center gap-1 shrink-0">

          {onKakaoTalkClick && (
            <button
              onClick={onKakaoTalkClick}
              className="flex items-center px-1.5 py-1 rounded-md text-[11px] font-semibold border border-transparent text-yellow-500 hover:text-yellow-300 hover:bg-slate-800 transition-all"
              title="카카오톡 전송"
            >
              💬<span className="hidden sm:inline ml-1">카카오톡</span>
            </button>
          )}

          <div className="w-px h-3 bg-slate-700/80" />

          {/* 이름: 모바일 숨김 */}
          {userName && <span className="hidden sm:inline text-[10px] font-medium text-slate-400">{userName}</span>}

          {/* 비밀번호 변경 */}
          {userName && <PwChangeButton userName={userName} onLogout={onLogout} />}

          {onLogout && (
            <button
              onClick={onLogout}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-red-900/60 text-slate-600 hover:text-red-300 transition-all border border-slate-700/40 hover:border-red-700/60"
              aria-label="로그아웃"
              title={userName ? `${userName} 로그아웃` : '로그아웃'}
            >
              <span className="hidden sm:inline">로그아웃</span>
              <span className="sm:hidden">나가기</span>
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="absolute z-[100] mt-1.5 left-0 right-0" style={{width:'100%',maxWidth:'100vw'}}>
          <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/70 rounded-xl shadow-2xl p-3 space-y-2.5" style={{overflowX:'hidden'}}>

            {/* 강조색 */}
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-12 shrink-0 pt-1">강조색</span>
              <div className="flex flex-wrap gap-1.5">
                {ACCENT_THEMES.map(t => (
                  <button key={t.id} onClick={() => setAccent(t.id)} title={t.label}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                      accent === t.id ? 'border-white/20 bg-slate-800 text-white scale-105' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                    }`}>
                    <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: t.color }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-800" />

            {/* 배경색 */}
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-12 shrink-0 pt-1">배경</span>
              <div className="flex flex-wrap gap-1.5">
                {BG_THEMES.map(t => (
                  <button key={t.id} onClick={() => setBg(t.id)} title={t.label}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                      bg === t.id ? 'border-white/20 bg-slate-800 text-white scale-105' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                    }`}>
                    <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0 border border-slate-600" style={{ backgroundColor: t.color }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-800" />

            {/* 글씨색 */}
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-12 shrink-0 pt-1">글씨색</span>
              <div className="flex flex-wrap gap-1.5">
                {TEXT_THEMES.map(t => (
                  <button key={t.id} onClick={() => setTextTheme(t.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                      textTheme === t.id ? 'border-white/20 bg-slate-800 text-white scale-105' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                    }`}>
                    <span className={`font-bold text-xs ${t.id === '' ? 'text-slate-200' : t.id === 'bright' ? 'text-white' : 'text-slate-400'}`}>{t.sample}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-800" />

            {/* 글씨 크기 */}
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-12 shrink-0 pt-1">크기</span>
              <div className="flex flex-wrap gap-1.5">
                {FONT_SIZES.map(f => (
                  <button key={f.id} onClick={() => setFontSize(f.id)} title={`${f.px}px`}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all border ${
                      fontSize === f.id ? 'border-white/20 bg-slate-800 text-white scale-105' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
                    }`}
                    style={{ fontSize: `${Math.max(9, f.px * 0.65)}px` }}>
                    {f.label}
                  </button>
                ))}
                <span className="text-[9px] text-slate-600 self-center">{currentFontSize.px}px</span>
              </div>
            </div>

          </div>
        </div>
      )}
    </header>
  );
};
