import React, { useState, useCallback, useMemo } from 'react';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';

interface FtpPageProps {
  userName: string;
}

type FtpStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

const FolderIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-400">
    <path d="M2 3.5A1.5 1.5 0 013.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0012.62 6H16.5A1.5 1.5 0 0118 7.5v7a1.5 1.5 0 01-1.5 1.5H3.5A1.5 1.5 0 012 14.5v-11z" />
  </svg>
);
const FileIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-400">
    <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6.414A2.2 2.2 0 0017.414 5L13 1.586A2 2 0 0011.586 1H4zm3 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
  </svg>
);

const fetchWithTimeout = (url: string, opts: any = {}, ms = 8000) => {
  const c = new AbortController(); 
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
};

async function ensureOk(res: Response) {
  if (res.ok) return;
  let msg = `HTTP ${res.status}`;
  try {
    const bodyText = await res.text();
    try {
      const jsonBody = JSON.parse(bodyText);
      if (jsonBody?.error) {
        msg = jsonBody.error;
      } else if (bodyText) {
        msg = bodyText;
      }
    } catch (e) {
      if (bodyText) msg = bodyText;
    }
  } catch (e) {}
  throw new Error(msg);
}

const FtpPage: React.FC<FtpPageProps> = ({ userName }) => {
  const [host, setHost] = useState('192.168.230.1');
  const [port, setPort] = useState('21');
  const [bridgeUrl, setBridgeUrl] = useState('http://192.168.0.34:4000');
  const [transferMode, setTransferMode] = useState<'passive' | 'active'>('passive');
  const [useTls12, setUseTls12] = useState(false);
  const [useTls13, setUseTls13] = useState(false);
  
  const [status, setStatus] = useState<FtpStatus>('disconnected');
  const [logs, setLogs] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const [cwd, setCwd] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 100));
  }, []);

  const handleTlsChange = (version: '1.2' | '1.3') => {
    if (version === '1.2') {
      const isEnabling = !useTls12;
      setUseTls12(isEnabling);
      if (isEnabling) setUseTls13(false);
    } else {
      const isEnabling = !useTls13;
      setUseTls13(isEnabling);
      if (isEnabling) setUseTls12(false);
    }
  };

  const fetchDirectory = useCallback(async (path: string) => {
    setIsBusy(true); 
    addLog(`Fetching: ${path}`);
    try {
      const r = await fetchWithTimeout(`${bridgeUrl}/api/ftp/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: Number(port), user: 'anonymous', password: '', path })
      }, 8000);
      await ensureOk(r);
      const data = await r.json();
      setCwd(data.path); 
      setFiles(
         data.files.sort((a: FileEntry, b: FileEntry) =>
           a.isDir===b.isDir ? a.name.localeCompare(b.name, 'en', {numeric:true}) : (a.isDir?-1:1))
       );
    } catch (e:any) { 
        setStatus('error'); 
        addLog(`List error: ${e.message}`); 
    }
    finally { setIsBusy(false); }
  }, [bridgeUrl, host, port, addLog]);

  const handleConnect = useCallback(async () => {
    setIsBusy(true);
    setStatus('connecting');
    setLogs([]);
    addLog(`Connecting to ${host}:${port} via bridge ${bridgeUrl}...`);
    try {
      const r = await fetchWithTimeout(`${bridgeUrl}/api/ftp/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: Number(port), user: 'anonymous', password: '', path: '/' })
      }, 8000);
      await ensureOk(r);
      const data = await r.json();
      setStatus('connected');
      setCwd(data.path);
      setFiles(
        data.files.sort((a: FileEntry, b: FileEntry) =>
          a.isDir===b.isDir ? a.name.localeCompare(b.name, 'en', {numeric:true}) : (a.isDir?-1:1))
      );
      addLog(`Connected. Listed ${data.path} (${data.files.length} items).`);
    } catch (e:any) {
      setStatus('error'); addLog(`Connection failed: ${e.message}`);
    } finally { setIsBusy(false); }
  }, [bridgeUrl, host, port, addLog]);

  const handleDisconnect = useCallback(async () => {
    addLog('Disconnecting...');
    setIsBusy(true);
    // No actual backend call is needed for disconnect in this bridge model
    setTimeout(() => {
        setStatus('disconnected');
        setCwd('/');
        setFiles([]);
        addLog('Disconnected.');
        setIsBusy(false);
    }, 500);
  }, [addLog]);
  
  const handleDownload = async (file: FileEntry) => {
    try {
      addLog(`Downloading ${file.path} ...`);
      const r = await fetchWithTimeout(`${bridgeUrl}/api/ftp/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: Number(port), user: 'anonymous', password: '', remotePath: file.path })
      }, 30000); // Longer timeout for downloads
      await ensureOk(r);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addLog(`Saved: ${file.name}`);
    } catch (e:any) { addLog(`Download error: ${e.message}`); }
  };

  const handleItemClick = (item: FileEntry) => {
    if (isBusy) return;
    if (item.isDir) fetchDirectory(item.path);
    else handleDownload(item);
  };
  
  const handleCdUp = () => {
    if (isBusy || cwd === '/') return;
    const parent = cwd.replace(/\\/g, '/').replace(/\/$/, '').split('/').slice(0, -1).join('/') || '/';
    fetchDirectory(parent);
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const StatusIndicator: React.FC<{ status: FtpStatus }> = ({ status }) => {
    let color = 'text-slate-400';
    let text = 'Disconnected';
    if (status === 'connecting') {
      color = 'text-yellow-400 animate-pulse';
      text = 'Connecting...';
    } else if (status === 'connected') {
      color = 'text-green-400';
      text = 'Connected';
    } else if (status === 'error') {
      color = 'text-red-400';
      text = 'Error';
    }
    return <span className={`font-semibold ${color}`}>{text}</span>;
  };

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
        FTP 설정 (P7)
      </h2>
      
      <div className="space-y-4">
        <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-4">
          <h3 className="text-lg font-semibold text-slate-100">연결 정보</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ftp-host" className="block text-sm font-medium text-slate-300 mb-1">호스트 이름</label>
              <input id="ftp-host" value={host} onChange={(e) => setHost(e.target.value)} disabled={isBusy || status === 'connected'} className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm disabled:opacity-50" />
            </div>
            <div>
              <label htmlFor="ftp-port" className="block text-sm font-medium text-slate-300 mb-1">포트</label>
              <input id="ftp-port" value={port} onChange={(e) => setPort(e.target.value)} disabled={isBusy || status === 'connected'} className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm disabled:opacity-50" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bridge-url" className="block text-sm font-medium text-slate-300 mb-1">Bridge URL</label>
              <input id="bridge-url" value={bridgeUrl} onChange={(e)=>setBridgeUrl(e.target.value)}
                disabled={isBusy || status==='connected'}
                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md text-sm disabled:opacity-50"
                placeholder="http://192.168.0.34:4000" />
              <p className="mt-1 text-xs text-slate-400">모바일에선 localhost 사용 불가. 브리지 PC의 IP를 입력하세요.</p>
            </div>
          </div>
        </div>

        <fieldset disabled title="브리지 서버 사용 시 이 설정은 비활성화됩니다.">
            <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-3 opacity-50">
            <h3 className="text-lg font-semibold text-slate-100">전송 모드 (비활성)</h3>
            <div className="flex items-center space-x-6">
                <div className="flex items-center">
                <input id="mode-passive" name="transferMode" type="radio" checked={transferMode === 'passive'} onChange={() => setTransferMode('passive')} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 focus:ring-sky-500" />
                <label htmlFor="mode-passive" className="ml-2 block text-sm text-slate-200">Passive</label>
                </div>
                <div className="flex items-center">
                <input id="mode-active" name="transferMode" type="radio" checked={transferMode === 'active'} onChange={() => setTransferMode('active')} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 focus:ring-sky-500" />
                <label htmlFor="mode-active" className="ml-2 block text-sm text-slate-200">Active</label>
                </div>
            </div>
            </div>
        </fieldset>

        <fieldset disabled title="브리지 서버 사용 시 이 설정은 비활성화됩니다.">
            <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-3 opacity-50">
            <h3 className="text-lg font-semibold text-slate-100">TLS 암호화 (비활성)</h3>
            <div className="flex items-center space-x-6">
                <div className="flex items-center">
                <input id="tls-12" type="checkbox" checked={useTls12} onChange={() => handleTlsChange('1.2')} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 rounded-md focus:ring-sky-500" />
                <label htmlFor="tls-12" className="ml-2 block text-sm text-slate-200">TLS 1.2 사용</label>
                </div>
                <div className="flex items-center">
                <input id="tls-13" type="checkbox" checked={useTls13} onChange={() => handleTlsChange('1.3')} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 rounded-md focus:ring-sky-500" />
                <label htmlFor="tls-13" className="ml-2 block text-sm text-slate-200">TLS 1.3 사용</label>
                </div>
            </div>
            </div>
        </fieldset>


        {status !== 'disconnected' && (
          <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-100">상태</h3>
              <StatusIndicator status={status} />
            </div>
            
            {status === 'connected' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 bg-slate-800 rounded-md">
                    <p className="text-sm font-mono text-slate-400 truncate">현재 경로: {cwd}</p>
                    <ActionButton onClick={handleCdUp} disabled={isBusy || cwd === '/'} variant="secondary" className="!py-1 !px-3 text-xs">..</ActionButton>
                </div>
                <div className="w-full h-64 bg-slate-900 rounded-md border border-slate-600 overflow-y-auto">
                    <ul>
                        {files.map(file => (
                            <li key={file.path} onClick={() => handleItemClick(file)} className="flex items-center justify-between p-2 border-b border-slate-700 last:border-b-0 hover:bg-slate-700/50 cursor-pointer transition-colors">
                                <div className="flex items-center gap-3">
                                    {file.isDir ? <FolderIcon /> : <FileIcon />}
                                    <span className="text-slate-200">{file.name}</span>
                                </div>
                                {!file.isDir && <span className="text-xs text-slate-400 font-mono">{formatBytes(file.size)}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
              </div>
            )}
            
            <div className="w-full h-40 bg-slate-900 p-3 rounded-md border border-slate-600 overflow-y-auto text-xs text-slate-300 font-mono">
              {logs.map((log, i) => <div key={i}>{log}</div>)}
              {logs.length === 0 && <div className="text-slate-500">연결을 시작하여 로그를 확인하세요.</div>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-700">
          <ActionButton onClick={handleConnect} disabled={isBusy || status === 'connected'}>
            {status === 'connecting' ? <Spinner size="sm" /> : '연결'}
          </ActionButton>
          <ActionButton onClick={handleDisconnect} disabled={isBusy || status === 'disconnected'} variant="danger">
            연결 끊기
          </ActionButton>
        </div>
      </div>
    </div>
  );
};

export default FtpPage;
