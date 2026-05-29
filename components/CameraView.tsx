import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ActionButton } from './ActionButton';
import { Spinner } from './Spinner';

interface CameraViewProps {
  onCapture: (file: File, base64: string, mimeType: string) => void;
  onClose: () => void;
}

type QualityPreset = 'max' | 'high' | 'normal';

const QUALITY_PRESETS: Record<QualityPreset, {
  label: string;
  jpegQuality: number;
  maxWidth: number;
  maxHeight: number;
  cameraConstraint: MediaTrackConstraints;
}> = {
  max: {
    label: '최고',
    jpegQuality: 0.97,
    maxWidth: 4096,
    maxHeight: 4096,
    cameraConstraint: { width: { ideal: 4096 }, height: { ideal: 3072 } },
  },
  high: {
    label: '고화질',
    jpegQuality: 0.88,
    maxWidth: 2048,
    maxHeight: 2048,
    cameraConstraint: { width: { ideal: 1920 }, height: { ideal: 1080 } },
  },
  normal: {
    label: '일반',
    jpegQuality: 0.75,
    maxWidth: 1280,
    maxHeight: 1280,
    cameraConstraint: { width: { ideal: 1280 }, height: { ideal: 720 } },
  },
};

const CaptureIcon: React.FC = () => (
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
  </svg>
);

const CancelIcon: React.FC = () => (
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SwitchCameraIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const CameraView: React.FC<CameraViewProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(true);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(undefined);
  const [isFrontCamera, setIsFrontCamera] = useState<boolean>(false);
  const [isStreamPlaying, setIsStreamPlaying] = useState<boolean>(false);
  const [quality, setQuality] = useState<QualityPreset>(
    () => (localStorage.getItem('parser-cam-quality') as QualityPreset) || 'max'
  );
  const [captureInfo, setCaptureInfo] = useState<string | null>(null);

  const stopCurrentStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const setupStream = useCallback(async (constraints: MediaStreamConstraints) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저에서는 카메라 API를 사용할 수 없습니다.");
    }
    stopCurrentStream();
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      streamRef.current = stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(e => {
          console.error("[CameraView] Video play failed:", e);
          setCameraError("비디오 재생에 실패했습니다.");
        });
      };
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);
      const currentTrack = stream.getVideoTracks()[0];
      const currentSettings = currentTrack.getSettings();
      setCurrentDeviceId(currentSettings.deviceId);
      if (currentSettings.facingMode) {
        setIsFrontCamera(currentSettings.facingMode === 'user');
      } else {
        const currentDevice = videoDevices.find(d => d.deviceId === currentSettings.deviceId);
        setIsFrontCamera(!!currentDevice?.label.toLowerCase().includes('front'));
      }
    }
  }, [stopCurrentStream]);

  const initCamera = useCallback(async (preset: QualityPreset) => {
    setIsCameraLoading(true);
    setCameraError(null);
    const { cameraConstraint } = QUALITY_PRESETS[preset];
    try {
      await setupStream({ video: { facingMode: { ideal: 'environment' }, ...cameraConstraint } });
    } catch {
      try { await setupStream({ video: true }); }
      catch (err: any) {
        let msg = "카메라를 시작할 수 없습니다.";
        if (err.name === 'NotAllowedError') msg = "카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.";
        else if (err.name === 'NotFoundError') msg = "사용 가능한 카메라를 찾을 수 없습니다.";
        else msg = `카메라 오류: ${err.message}`;
        setCameraError(msg);
      }
    }
  }, [setupStream]);

  useEffect(() => {
    initCamera(quality);
    return () => stopCurrentStream();
  }, []);  // eslint-disable-line

  const handleQualityChange = useCallback((preset: QualityPreset) => {
    setQuality(preset);
    localStorage.setItem('parser-cam-quality', preset);
    initCamera(preset);
  }, [initCamera]);

  const handleSwitchCamera = useCallback(async () => {
    if (availableCameras.length <= 1 || isCameraLoading) return;
    setIsCameraLoading(true);
    setCameraError(null);
    const idx = availableCameras.findIndex(c => c.deviceId === currentDeviceId);
    const nextId = availableCameras[(idx + 1) % availableCameras.length].deviceId;
    try {
      await setupStream({ video: { deviceId: { exact: nextId } } });
    } catch (err: any) {
      setCameraError("카메라 전환에 실패했습니다.");
    } finally {
      setIsCameraLoading(false);
    }
  }, [availableCameras, currentDeviceId, isCameraLoading, setupStream]);

  const handleCapture = useCallback(() => {
    if (!videoRef.current || !isStreamPlaying) {
      setCameraError("카메라가 준비되지 않았습니다.");
      return;
    }
    const video = videoRef.current;
    const { jpegQuality, maxWidth, maxHeight } = QUALITY_PRESETS[quality];

    // Compute output size (preserve aspect ratio)
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w === 0 || h === 0) { setCameraError("캡처 실패: 비디오 크기가 0입니다."); return; }
    const ratio = Math.min(maxWidth / w, maxHeight / h, 1); // never upscale
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setCameraError("캔버스 컨텍스트 오류."); return; }

    if (isFrontCamera) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(blob => {
      if (!blob) { setCameraError("이미지 생성 실패."); return; }
      const sizeStr = formatBytes(blob.size);
      setCaptureInfo(`${w}×${h} · ${sizeStr} · JPEG ${Math.round(jpegQuality * 100)}%`);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture(file, base64, 'image/jpeg');
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', jpegQuality);
  }, [onCapture, isFrontCamera, isStreamPlaying, quality]);

  return (
    <div className="space-y-3 flex flex-col items-center">
      {/* 화질 선택 */}
      <div className="w-full flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-1.5 border border-slate-700/50">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">촬영 화질</span>
        <div className="flex gap-1">
          {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map(p => (
            <button
              key={p}
              onClick={() => handleQualityChange(p)}
              className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-md transition-all border ${
                quality === p
                  ? 'bg-sky-500 text-white border-sky-500/50 shadow-sm'
                  : 'text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-600'
              }`}
            >
              {QUALITY_PRESETS[p].label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-600">
          {QUALITY_PRESETS[quality].maxWidth <= 1280 ? '≤1280px' :
           QUALITY_PRESETS[quality].maxWidth <= 2048 ? '≤2048px' : '원본'}
        </span>
      </div>

      {/* 카메라 뷰 */}
      {(isCameraLoading && !cameraError) && (
        <div className="w-full aspect-video bg-slate-800 rounded-lg flex items-center justify-center">
          <Spinner /><span className="ml-2 text-slate-400 text-sm">카메라 시작 중...</span>
        </div>
      )}
      {cameraError && (
        <div className="w-full p-4 bg-red-900/30 border border-red-700/50 text-red-300 rounded-lg text-center text-sm">
          <p className="font-semibold mb-1">카메라 오류</p>
          <p className="text-xs">{cameraError}</p>
        </div>
      )}
      <video
        ref={videoRef}
        className={`w-full aspect-video bg-slate-900 rounded-lg shadow-md ${
          isCameraLoading || cameraError ? 'hidden' : 'block'
        } ${isFrontCamera ? 'transform scale-x-[-1]' : ''}`}
        playsInline muted autoPlay
        onPlaying={() => { setIsStreamPlaying(true); setIsCameraLoading(false); }}
        onPause={() => setIsStreamPlaying(false)}
      />

      {/* 캡처 정보 */}
      {captureInfo && (
        <div className="w-full text-center text-[10px] text-sky-400/80 bg-sky-900/20 rounded-md py-1 border border-sky-800/30">
          ✓ 캡처됨: {captureInfo}
        </div>
      )}

      {/* 버튼 */}
      {!isCameraLoading && !cameraError && (
        <div className="grid grid-cols-1 gap-2 w-full sm:grid-cols-2">
          <ActionButton onClick={handleCapture} icon={<CaptureIcon />} fullWidth disabled={!isStreamPlaying}>
            촬영
          </ActionButton>
          {availableCameras.length > 1 && (
            <ActionButton onClick={handleSwitchCamera} icon={<SwitchCameraIcon />} variant="secondary" fullWidth>
              카메라 전환
            </ActionButton>
          )}
        </div>
      )}
      <ActionButton onClick={onClose} variant="secondary" icon={<CancelIcon />} fullWidth>
        {isCameraLoading || cameraError ? "뒤로" : "취소"}
      </ActionButton>
    </div>
  );
};
