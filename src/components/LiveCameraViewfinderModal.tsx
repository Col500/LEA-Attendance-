import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CircleDot,
  Loader2,
  RefreshCw,
  SwitchCamera,
  X
} from 'lucide-react';

interface LiveCameraViewfinderModalProps {
  isOpen: boolean;
  title?: string;
  frameHintTop?: string;
  frameHintBottom?: string;
  onCaptureDataUrl: (dataUrl: string, dimensions: { width: number; height: number }) => void;
  onFallbackToNativeCamera: () => void;
  onClose: () => void;
}

export const LiveCameraViewfinderModal: React.FC<LiveCameraViewfinderModalProps> = ({
  isOpen,
  title = 'Register Camera',
  frameHintTop = 'Align vertical register page inside frame',
  frameHintBottom = 'Hold upright in clear lighting',
  onCaptureDataUrl,
  onFallbackToNativeCamera,
  onClose
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsVideoReady(false);
  };

  const startStream = async (mode: 'environment' | 'user') => {
    setIsCameraStarting(true);
    setIsVideoReady(false);
    setCameraError(null);
    stopStream();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'In-app live camera is not supported on this browser. You can use the Phone Camera App instead.'
        );
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
      } catch (constraintErr: any) {
        if (
          constraintErr?.name === 'OverconstrainedError' ||
          constraintErr?.name === 'ConstraintNotSatisfiedError'
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        } else {
          throw constraintErr;
        }
      }

      streamRef.current = stream;
      setFacingMode(mode);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => {
          console.warn('Video playback warning:', err);
        });
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        setHasMultipleCameras(true);
      }
    } catch (err: any) {
      let msg = 'Could not access camera. Please check camera permissions in your browser.';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg =
          'Camera permission was denied. Please allow camera access in your browser settings, or open the Phone Camera App.';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        msg = 'No camera hardware detected on this device.';
      } else if (err?.message) {
        msg = err.message;
      }
      setCameraError(msg);
    } finally {
      setIsCameraStarting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void startStream(facingMode);
    } else {
      stopStream();
      setCameraError(null);
    }
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    void startStream(nextMode);
  };

  const handleClose = () => {
    stopStream();
    setCameraError(null);
    onClose();
  };

  const handleSnap = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      setCameraError('Camera stream is still warming up. Please wait a moment and try again.');
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);

    stopStream();
    onClose();
    onCaptureDataUrl(dataUrl, { width, height });
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col justify-between">
      {/* Top Bar */}
      <div className="bg-slate-950/85 backdrop-blur-md px-4 py-3 flex items-center justify-between text-white border-b border-slate-800/80 z-20">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-xs font-bold tracking-wide text-white">
            {title} {facingMode === 'environment' ? '· Rear' : '· Front'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasMultipleCameras && (
            <button
              type="button"
              onClick={handleToggleFacingMode}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer active:scale-95"
              title="Switch camera"
            >
              <SwitchCamera className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Flip Camera</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            title="Close camera"
            aria-label="Close camera"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Video Viewport with 9:16 Register Framing Guide */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden p-4">
        {isCameraStarting && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 text-white gap-3 p-4 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            <p className="text-sm font-semibold">Starting camera...</p>
            <p className="text-xs text-slate-400 max-w-xs">
              Please allow camera permissions if prompted by your phone or browser.
            </p>
          </div>
        )}

        {cameraError ? (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950 p-6 text-center max-w-md mx-auto">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
              <CameraOff className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-white mb-1.5">Camera Access Needed</h4>
            <p className="text-xs text-slate-300 mb-5 leading-relaxed">{cameraError}</p>

            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onFallbackToNativeCamera();
                }}
                className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-md flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Camera className="w-4 h-4" />
                <span>Open Phone Camera</span>
              </button>
              <button
                type="button"
                onClick={() => void startStream(facingMode)}
                className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setIsVideoReady(true)}
              onPlaying={() => setIsVideoReady(true)}
              className="w-full h-full object-cover sm:object-contain"
            />

            {/* 9:16 Portrait Register Frame Overlay Guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <div className="w-[82vw] max-w-[350px] aspect-9/16 max-h-[75vh] border-2 border-dashed border-emerald-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.52)] flex flex-col items-center justify-between p-2.5">
                <div className="bg-slate-950/85 backdrop-blur-xs text-emerald-300 text-[11px] font-semibold px-3 py-1 rounded-full border border-emerald-500/40 shadow-sm text-center">
                  {frameHintTop}
                </div>

                <div className="bg-slate-950/85 backdrop-blur-xs text-slate-200 text-[11px] px-3 py-1 rounded-full border border-slate-700 shadow-sm text-center">
                  {frameHintBottom}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom Shutter Controls Bar */}
      <div className="bg-slate-950/95 backdrop-blur-md px-6 py-4 flex items-center justify-between z-20 border-t border-slate-800 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => {
            handleClose();
            onFallbackToNativeCamera();
          }}
          className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 font-medium cursor-pointer"
        >
          <Camera className="w-4 h-4 text-emerald-400" />
          <span>Phone App</span>
        </button>

        <button
          type="button"
          disabled={isCameraStarting || !isVideoReady || Boolean(cameraError)}
          onClick={handleSnap}
          className="w-16 h-16 rounded-full border-4 border-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all flex items-center justify-center shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          title="Snap Photo"
          aria-label="Snap Photo"
        >
          <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
            <CircleDot className="w-7 h-7 text-emerald-700" />
          </div>
        </button>

        <button
          type="button"
          onClick={handleClose}
          className="text-xs text-slate-400 hover:text-white font-medium cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
