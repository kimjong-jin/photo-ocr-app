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

const FtpPage: React.FC<FtpPageProps> = ({ userName }) => {
  const [host, setHost] = useState('192.168.230.1');
  const [port, setPort] = useState('21');
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
    addLog(`Fetching directory: ${path}`);
    try {
      // This is a hypothetical API endpoint. A backend proxy is required.
      const response = await fetch(`/api/ftp/list?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to list directory' }));
        throw new Error(errorData.message);
      }
      const data = await response.json();
      setCwd(data.path);
      const sortedFiles = data.files.sort((a: FileEntry, b: FileEntry) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name, 'en', { numeric: true });
      });
      setFiles(sortedFiles);
      addLog(`Listed ${data.path}. Found ${data.files.length} items.`);
    } catch (error: any) {
      addLog(`Error listing directory: ${error.message}`);
      setStatus('error');
    } finally {
      setIsBusy(false);
    }
  }, [addLog]);

  const handleConnect = useCallback(async () => {
    setIsBusy(true);
    setStatus('connecting');
    setLogs([]);
    addLog(`Connecting to ${host}:${port}...`);

    // This is a mock implementation because browsers can't directly make FTP connections.
    // It simulates a connection and then fetches a mock directory listing.
    setTimeout(async () => {
      try {
        // In a real scenario, you'd call a backend proxy here:
        // const response = await fetch('/api/ftp/connect', { method: 'POST', body: ... });
        // if (!response.ok) throw new Error('Connection failed');
        setStatus('connected');
        addLog('Connection successful (simulated).');
        addLog(`Mode: ${transferMode}`);
        addLog(`TLS: ${[useTls12 && '1.2', useTls13 && '1.3'].filter(Boolean).join(', ') || 'None'}`);

        // Simulate fetching files
        setCwd('/');
        setFiles([
          { name: 'data', path: '/data', isDir: true, size: 0, mtime: Date.now() },
          { name: 'LOGFILE.TXT', path: '/LOGFILE.TXT', isDir: false, size: 1024, mtime: Date.now() },
        ]);
        addLog('Fetched mock directory listing for /');

      } catch (error: any) {
        setStatus('error');
        addLog(`Error: ${error.message}`);
      } finally {
        setIsBusy(false);
      }
    }, 1500);

  }, [host, port, transferMode, useTls12, useTls13, addLog]);

  const handleDisconnect = useCallback(async () => {
    addLog('Disconnecting...');
    setIsBusy(true);
    // In a real scenario: await fetch('/api/ftp/disconnect', { method: 'POST' });
    setTimeout(() => {
        setStatus('disconnected');
        setCwd('/');
        setFiles([]);
        addLog('Disconnected.');
        setIsBusy(false);
    }, 500);
  }, [addLog]);

  const handleItemClick = (item: FileEntry) => {
    if (isBusy) return;
    if (item.isDir) {
        alert(`Navigating to directory '${item.name}' is not implemented in this mock version.`);
        // In a real implementation: fetchDirectory(item.path);
    } else {
        alert(`Downloading file '${item.name}' is not implemented in this mock version.`);
        // In a real implementation: handleDownload(item);
    }
  };
  
  const handleCdUp = () => {
    if (isBusy || cwd === '/') return;
    alert("Navigating up is not implemented in this mock version.");
    // In a real implementation:
    // const parentPath = cwd.substring(0, cwd.lastIndexOf('/')) || '/';
    // fetchDirectory(parentPath);
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
          </div>
        </div>

        <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-3">
          <h3 className="text-lg font-semibold text-slate-100">전송 모드</h3>
          <div className="flex items-center space-x-6">
            <div className="flex items-center">
              <input id="mode-passive" name="transferMode" type="radio" checked={transferMode === 'passive'} onChange={() => setTransferMode('passive')} disabled={isBusy || status === 'connected'} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 focus:ring-sky-500 disabled:opacity-50" />
              <label htmlFor="mode-passive" className="ml-2 block text-sm text-slate-200">Passive</label>
            </div>
            <div className="flex items-center">
              <input id="mode-active" name="transferMode" type="radio" checked={transferMode === 'active'} onChange={() => setTransferMode('active')} disabled={isBusy || status === 'connected'} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 focus:ring-sky-500 disabled:opacity-50" />
              <label htmlFor="mode-active" className="ml-2 block text-sm text-slate-200">Active</label>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-3">
          <h3 className="text-lg font-semibold text-slate-100">TLS 암호화</h3>
           <div className="flex items-center space-x-6">
            <div className="flex items-center">
              <input id="tls-12" type="checkbox" checked={useTls12} onChange={() => handleTlsChange('1.2')} disabled={isBusy || status === 'connected'} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 rounded-md focus:ring-sky-500 disabled:opacity-50" />
              <label htmlFor="tls-12" className="ml-2 block text-sm text-slate-200">TLS 1.2 사용</label>
            </div>
             <div className="flex items-center">
              <input id="tls-13" type="checkbox" checked={useTls13} onChange={() => handleTlsChange('1.3')} disabled={isBusy || status === 'connected'} className="h-4 w-4 text-sky-600 bg-slate-700 border-slate-500 rounded-md focus:ring-sky-500 disabled:opacity-50" />
              <label htmlFor="tls-13" className="ml-2 block text-sm text-slate-200">TLS 1.3 사용</label>
            </div>
          </div>
        </div>

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
