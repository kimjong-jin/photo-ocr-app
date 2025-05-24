
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


export const CameraView: React.FC<CameraViewProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(true);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null; // Explicitly clear srcObject from video element
      videoRef.current.load(); // Reset the video element
    }
  }, []);

  useEffect(() => {
    const currentVideoRef = videoRef.current; // Capture for cleanup

    async function setupCamera() {
      setIsCameraLoading(true);
      setCameraError(null);
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera API not available in this browser.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) { // Check if component is still mounted
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => { // Ensure metadata is loaded before playing
            if (videoRef.current) { // Double check due to async nature
              videoRef.current.play().catch(playError => {
                console.error("Error playing video stream:", playError);
                setCameraError("Failed to play video stream. " + (playError.message || ""));
                stopStream(); // Stop stream if play fails
              });
            }
          };
          streamRef.current = stream;
        } else {
           // This case means the component unmounted before stream was set or play started
           stream.getTracks().forEach(track => track.stop());
        }
      } catch (err: any) {
        console.error("Error accessing camera:", err);
        let detailedErrorMessage = "Failed to access camera.";
        if (err.name === 'NotFoundError' || (err.message && err.message.toLowerCase().includes("requested device not found"))) {
          detailedErrorMessage = "No camera was found. Please ensure a camera is connected, enabled in your system settings, and not in use by another application. Also, check that your browser has permission to access the camera for this site.";
          console.info("Tip: To debug available media devices, you can run `navigator.mediaDevices.enumerateDevices().then(devices => console.log(devices))` in your browser's developer console.");
        } else if (err.name === 'NotAllowedError' || (err.message && err.message.toLowerCase().includes("permission denied"))) {
          detailedErrorMessage = "Camera access was denied. Please grant camera permissions in your browser settings for this site and ensure no other application is blocking access.";
        } else if (err.name === 'NotReadableError') {
            detailedErrorMessage = "The camera is currently in use by another application or a hardware error occurred. Please close other applications that might be using the camera and try again.";
        } else if (err.message) {
          detailedErrorMessage = `An unexpected error occurred: ${err.message}`;
        }
        
        if (detailedErrorMessage === "Failed to access camera." && !(err.name === 'NotFoundError' || err.name === 'NotAllowedError' || err.name === 'NotReadableError')) {
             detailedErrorMessage += " Please check system settings, browser permissions, and ensure no other application is using the camera."
        }

        setCameraError(detailedErrorMessage);
        stopStream(); // Ensure stream is stopped on error
      } finally {
        setIsCameraLoading(false);
      }
    }
    setupCamera();

    return () => {
      stopStream();
      // Ensure srcObject is cleared on unmount if videoRef was set
      if (currentVideoRef) {
        currentVideoRef.srcObject = null;
      }
    };
  }, [stopStream]); // stopStream is stable due to useCallback with empty deps

  const handleCapture = useCallback(() => {
    if (videoRef.current && videoRef.current.readyState >= videoRef.current.HAVE_METADATA && videoRef.current.videoWidth > 0) { 
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        
        canvas.toBlob(blob => {
          if (blob) {
            const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
            onCapture(file, base64, 'image/png');
          } else {
            setCameraError("Failed to create image blob from canvas.");
          }
        }, 'image/png');
      } else {
        setCameraError("Failed to get 2D context from canvas for capture.");
      }
      stopStream(); // Stop stream after capture
    } else {
        setCameraError("Camera not ready, no video stream, or video dimensions are zero. Cannot capture.");
    }
  }, [onCapture, stopStream]);

  return (
    <div className="space-y-4 flex flex-col items-center">
      {isCameraLoading && (
        <div className="w-full aspect-video bg-slate-700 rounded-lg flex items-center justify-center">
          <Spinner /> <span className="ml-2 text-slate-300">Starting camera...</span>
        </div>
      )}
      {cameraError && !isCameraLoading && (
        <div className="w-full p-4 bg-red-700/30 border border-red-500 text-red-300 rounded-lg text-center">
          <p className="font-semibold">Camera Error:</p>
          <p className="text-sm mt-1 whitespace-pre-wrap">{cameraError}</p>
        </div>
      )}
      <video
        ref={videoRef}
        className={`w-full aspect-video bg-slate-900 rounded-lg shadow-md ${isCameraLoading || cameraError ? 'hidden' : 'block'}`}
        playsInline 
        muted 
        // autoPlay removed to rely on onloadedmetadata and explicit play()
      />
      {!isCameraLoading && !cameraError && (
        <div className="flex space-x-3 w-full">
          <ActionButton onClick={handleCapture} icon={<CaptureIcon />} fullWidth>
            Capture
          </ActionButton>
          <ActionButton onClick={onClose} variant="secondary" icon={<CancelIcon />} fullWidth>
            Cancel
          </ActionButton>
        </div>
      )}
       { (isCameraLoading || cameraError) && (
         <ActionButton onClick={onClose} variant="secondary" icon={<CancelIcon />} fullWidth>
            Back
          </ActionButton>
       )}
    </div>
  );
};
