
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
      console.log("[CameraView] Stopping MediaStream tracks.");
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      console.log("[CameraView] Clearing video source.");
      videoRef.current.srcObject = null;
    }
    setIsStreamPlaying(false);
  }, []);

  const startStream = useCallback(async (newDeviceId: string) => {
    console.log(`[CameraView] startStream called for newDeviceId: ${newDeviceId}. videoRef.current available: ${!!videoRef.current}`);
    stopCurrentStream();

    let newIsFrontCameraValue = false;
    const selectedCamera = availableCameras.find(cam => cam.deviceId === newDeviceId);
    if (selectedCamera) {
        const label = selectedCamera.label.toLowerCase();
        newIsFrontCameraValue = label.includes('front') || label.includes('user');
        console.log(`[CameraView] Selected camera: ${selectedCamera.label}, Determined IsFront: ${newIsFrontCameraValue}`);
    }

    const constraints = { video: { deviceId: { exact: newDeviceId } } };
    console.log("[CameraView] Requesting media with constraints:", constraints);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("이 브라우저에서는 카메라 API를 사용할 수 없습니다.");
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[CameraView] MediaStream obtained:", stream);
      if (videoRef.current) {
        console.log(`[CameraView] Attaching stream to videoRef. current available: ${!!videoRef.current}`);
        videoRef.current.srcObject = stream;
        streamRef.current = stream; 
        setIsFrontCamera(newIsFrontCameraValue); 
      } else {
         console.warn("[CameraView] videoRef.current is null after obtaining stream. Stopping tracks and setting error.");
         stream.getTracks().forEach(track => track.stop());
         setCameraError("카메라 뷰를 초기화하는 중 내부 오류가 발생했습니다. (비디오 참조 실패)");
      }
    } catch (err: any) {
      console.error("[CameraView] Error accessing camera with deviceId", newDeviceId, err);
      let detailedErrorMessage = "카메라 접근에 실패했습니다.";
       if (err.name === 'NotFoundError' || (err.message && err.message.toLowerCase().includes("requested device not found"))) {
          detailedErrorMessage = "선택한 카메라를 찾을 수 없습니다. 연결이 끊어졌거나 더 이상 사용할 수 없는 카메라일 수 있습니다.";
        } else if (err.name === 'NotAllowedError' || (err.message && err.message.toLowerCase().includes("permission denied"))) {
          detailedErrorMessage = "카메라 접근이 거부되었습니다. 브라우저 설정에서 이 사이트에 대한 카메라 권한을 허용해주세요.";
        } else if (err.name === 'NotReadableError') {
            detailedErrorMessage = "카메라가 다른 애플리케이션에서 사용 중이거나 하드웨어 오류가 발생했습니다.";
        } else if (err.message) {
          detailedErrorMessage = `예상치 못한 오류가 발생했습니다: ${err.message}`;
        }
      setCameraError(detailedErrorMessage);
      stopCurrentStream();
    }
  }, [stopCurrentStream, availableCameras, setIsFrontCamera]);


  useEffect(() => {
    let didUnmount = false;
    setIsCameraLoading(true);
    setCameraError(null);

    const fetchAndSetInitialDevice = async () => {
      console.log("[CameraView] Effect 1: Fetching devices and setting initial device.");
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        if (!didUnmount) setCameraError("이 브라우저에서는 카메라 장치 목록 API를 사용할 수 없습니다.");
        if (!didUnmount) setIsCameraLoading(false);
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (didUnmount) return;

        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        console.log("[CameraView] Effect 1: Video devices found:", videoDevices);
        if (!didUnmount) setAvailableCameras(videoDevices);

        if (videoDevices.length === 0) {
          if (!didUnmount) setCameraError("카메라 장치를 찾을 수 없습니다. 카메라가 연결되어 있고 활성화되어 있는지 확인하세요.");
          if (!didUnmount) setIsCameraLoading(false);
          return;
        }

        let initialDevId = videoDevices[0].deviceId;
        const rearCamera = videoDevices.find(device =>
          device.label.toLowerCase().includes('back') ||
          device.label.toLowerCase().includes('rear') ||
          device.label.toLowerCase().includes('environment')
        );
        if (rearCamera) {
          initialDevId = rearCamera.deviceId;
          console.log("[CameraView] Effect 1: Preferred rear camera found:", rearCamera.label);
        } else {
          console.log("[CameraView] Effect 1: No specific rear camera found, using first video device:", videoDevices[0].label);
        }
        if (!didUnmount) setCurrentDeviceId(initialDevId);

      } catch (err: any) {
        console.error("[CameraView] Effect 1: Error enumerating devices:", err);
        if (!didUnmount) {
          setCameraError(`카메라 초기화 실패: ${err.message || "알 수 없는 오류"}`);
          setIsCameraLoading(false);
        }
      }
    };

    fetchAndSetInitialDevice();

    return () => {
      didUnmount = true;
      console.log("[CameraView] Effect 1: Unmount cleanup.");
    };
  }, []);


  useEffect(() => {
    let didUnmount = false;
    if (currentDeviceId) {
      console.log(`[CameraView] Effect 2: currentDeviceId changed to ${currentDeviceId}. Attempting to start stream.`);
      setIsCameraLoading(true);
      setCameraError(null); 
      setIsStreamPlaying(false);

      const doStartStream = async () => {
        await startStream(currentDeviceId);
        if (!didUnmount) {
           setIsCameraLoading(false);
        }
      };
      doStartStream();
    } else if (availableCameras.length > 0 && !currentDeviceId) {
        console.log("[CameraView] Effect 2: Cameras available, but no currentDeviceId selected. (e.g. initial state or cleared). Ensuring loading is false.");
        setIsCameraLoading(false);
    } else if (availableCameras.length === 0) {
        console.log("[CameraView] Effect 2: No cameras available. Ensuring loading is false.");
        setIsCameraLoading(false); 
    }
    return () => {
      didUnmount = true;
      console.log("[CameraView] Effect 2: Unmount cleanup for currentDeviceId effect.");
    };
  }, [currentDeviceId, startStream, availableCameras.length]); 

  useEffect(() => {
    return () => {
      console.log("[CameraView] Effect 3: Component unmounting. Stopping current stream.");
      stopCurrentStream();
    };
  }, [stopCurrentStream]);


  const handleCapture = useCallback(() => {
    if (videoRef.current && isStreamPlaying) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
       if (canvas.width === 0 || canvas.height === 0) {
        setCameraError("캡처 실패: 비디오 크기가 0입니다. 스트림을 다시 시작해 보세요.");
        return;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (isFrontCamera) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

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
      } else {
        setCameraError("캡처를 위한 캔버스에서 2D 컨텍스트를 가져오는 데 실패했습니다.");
      }
    } else {
        setCameraError("카메라가 준비되지 않았거나 비디오 스트림이 유효하지 않습니다. 캡처할 수 없습니다.");
    }
  }, [onCapture, isFrontCamera, isStreamPlaying]);

  const handleSwitchCamera = useCallback(async () => {
    if (availableCameras.length <= 1 || isCameraLoading) return;
    console.log("[CameraView] handleSwitchCamera called.");
    const currentIndex = availableCameras.findIndex(cam => cam.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % availableCameras.length;
    const nextDeviceId = availableCameras[nextIndex].deviceId;
    console.log(`[CameraView] Switching camera from ${currentDeviceId} to ${nextDeviceId}`);
    setCurrentDeviceId(nextDeviceId);
  }, [availableCameras, currentDeviceId, isCameraLoading]);

  return (
    <div className="space-y-4 flex flex-col items-center">
      {isCameraLoading && !cameraError && (
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
        key={currentDeviceId} 
        ref={videoRef}
        className={`w-full aspect-video bg-slate-900 rounded-lg shadow-md
                    ${isCameraLoading || cameraError ? 'hidden' : 'block'}
                    ${isFrontCamera ? 'transform scale-x-[-1]' : ''}
                  `}
        playsInline
        muted
        autoPlay
        onCanPlay={() => {
            if (videoRef.current) {
                videoRef.current.play().catch(playError => {
                    console.error("[CameraView] Error trying to play video:", playError);
                });
            }
        }}
        onPlaying={() => {
            console.log("[CameraView] onPlaying event fired.");
            setIsStreamPlaying(true);
            setCameraError(null);
        }}
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
