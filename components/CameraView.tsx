
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ActionButton } from './ActionButton';
import { Spinner } from './Spinner';

interface CameraViewProps {
  onCapture: (file: File, base64: string, mimeType: string) => void;
  onClose: () => void;
}

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


export const CameraView: React.FC<CameraViewProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(true);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(undefined);
  const [isFrontCamera, setIsFrontCamera] = useState<boolean>(false);
  const [isStreamPlaying, setIsStreamPlaying] = useState<boolean>(false);

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
            setCameraError("비디오 재생에 실패했습니다. 페이지를 새로고침하거나 브라우저 설정을 확인해주세요.");
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

  useEffect(() => {
    let isMounted = true;

    const initializeCamera = async () => {
      setIsCameraLoading(true);
      setCameraError(null);
      try {
        await setupStream({ video: { facingMode: { ideal: 'environment' } } });
      } catch (err) {
        console.warn("[CameraView] Ideal 'environment' camera failed, trying any video device.", err);
        try {
          await setupStream({ video: true });
        } catch (fallbackErr: any) {
          if (!isMounted) return;
          console.error("[CameraView] All camera attempts failed:", fallbackErr);
          let errorMessage = "카메라를 시작할 수 없습니다.";
          if (fallbackErr.name === 'NotAllowedError') {
              errorMessage = "카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.";
          } else if (fallbackErr.name === 'NotFoundError') {
              errorMessage = "사용 가능한 카메라를 찾을 수 없습니다.";
          } else {
              errorMessage = `카메라 오류: ${fallbackErr.message}`;
          }
          setCameraError(errorMessage);
        }
      }
    };
    
    initializeCamera();
    
    return () => {
      isMounted = false;
      stopCurrentStream();
    };
  }, [setupStream, stopCurrentStream]);


  const handleSwitchCamera = useCallback(async () => {
    if (availableCameras.length <= 1 || isCameraLoading) return;
    
    setIsCameraLoading(true);
    setCameraError(null);
    const currentIndex = availableCameras.findIndex(cam => cam.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % availableCameras.length;
    const nextDeviceId = availableCameras[nextIndex].deviceId;

    try {
      await setupStream({ video: { deviceId: { exact: nextDeviceId } } });
    } catch (err: any) {
      console.error(`[CameraView] Error switching to device ${nextDeviceId}:`, err);
      setCameraError("카메라 전환에 실패했습니다.");
    } finally {
      setIsCameraLoading(false);
    }
  }, [availableCameras, currentDeviceId, isCameraLoading, setupStream]);


  const handleCapture = useCallback(() => {
    if (!videoRef.current || !isStreamPlaying) {
      setCameraError("카메라가 준비되지 않았습니다. 캡처할 수 없습니다.");
      return;
    }
    
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (canvas.width === 0 || canvas.height === 0) {
      setCameraError("캡처 실패: 비디오 크기가 0입니다.");
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError("캡처를 위한 캔버스 컨텍스트를 가져올 수 없습니다.");
      return;
    }

    if (isFrontCamera) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];

    canvas.toBlob(blob => {
      if (blob) {
        const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
        onCapture(file, base64, 'image/png');
      } else {
        setCameraError("캔버스에서 이미지 Blob 생성에 실패했습니다.");
      }
    }, 'image/png');
  }, [onCapture, isFrontCamera, isStreamPlaying]);

  return (
    <div className="space-y-4 flex flex-col items-center">
      {(isCameraLoading && !cameraError) && (
        <div className="w-full aspect-video bg-slate-700 rounded-lg flex items-center justify-center">
          <Spinner /> <span className="ml-2 text-slate-300">카메라 시작 중...</span>
        </div>
      )}
      {cameraError && (
        <div className="w-full p-4 bg-red-700/30 border border-red-500 text-red-300 rounded-lg text-center">
          <p className="font-semibold">카메라 오류:</p>
          <p className="text-sm mt-1 whitespace-pre-wrap">{cameraError}</p>
        </div>
      )}
      <video
        ref={videoRef}
        className={`w-full aspect-video bg-slate-900 rounded-lg shadow-md ${isCameraLoading || cameraError ? 'hidden' : 'block'} ${isFrontCamera ? 'transform scale-x-[-1]' : ''}`}
        playsInline
        muted
        autoPlay
        onPlaying={() => {
            setIsStreamPlaying(true);
            setIsCameraLoading(false);
        }}
        onPause={() => setIsStreamPlaying(false)}
      />
      {!isCameraLoading && !cameraError && (
        <div className="grid grid-cols-1 gap-3 w-full sm:grid-cols-2">
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
      <ActionButton
        onClick={onClose}
        variant="secondary"
        icon={<CancelIcon />}
        fullWidth
        className={(!isCameraLoading && !cameraError && availableCameras.length > 1) ? "sm:col-span-2" : ""}
      >
        {isCameraLoading || cameraError ? "뒤로" : "취소"}
      </ActionButton>
    </div>
  );
};
