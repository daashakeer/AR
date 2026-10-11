import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  ArSession,
  MeasurementStep,
  TrackingStatus,
  AppError,
  CameraGuidance,
} from '../ar/ArSession';
import { ArSimulator } from '../ar/ArSimulator';
import { ReferenceHud } from './ReferenceHud';
import { DebugPanel } from './DebugPanel';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';
import type { CaptureResult } from '../ar/captureTypes';

interface Props {
  capabilities: DeviceCapabilities;
  isSimulator?: boolean;
  onExit: () => void;
}

export const ArView: React.FC<Props> = ({ capabilities, isSimulator = false, onExit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ArSession | ArSimulator | null>(null);

  const [step, setStep] = useState<MeasurementStep>('idle');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('detecting');
  const [guidance, setGuidance] = useState<CameraGuidance | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  // planeValid is true once we've ever had tracking=good and step>=ready,
  // and stays true for the remainder of the session (until retake).
  const [planeValid, setPlaneValid] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    // Reset state on each session start
    setStep('idle');
    setTrackingStatus('detecting');
    setGuidance(null);
    setError(null);
    setPlaneValid(false);

    const callbacks = {
      onTrackingStatus: (s: TrackingStatus) => setTrackingStatus(s),
      onStep: (st: MeasurementStep) => {
        setStep(st);
        // Once step reaches 'ready' or beyond, mark plane as valid (latched)
        if (st === 'ready' || st === 'place-a' || st === 'place-b' || st === 'measured') {
          setPlaneValid(true);
        }
      },
      onPointA: () => {},
      onPointB: () => {},
      onPointsChange: () => {},
      onLiveDistance: () => {},
      onDistance: () => {},
      onOrientation: () => {},
      onGuidance: (g: CameraGuidance) => setGuidance(g),
      onCapture: (result: CaptureResult) => {
        setCaptureResult(result);
      },
      onError: (e: AppError) => setError(e),
      onEnd: () => onExit(),
    };

    const activeSession = isSimulator
      ? new ArSimulator(canvas, callbacks)
      : new ArSession(canvas, callbacks);

    sessionRef.current = activeSession;
    activeSession.start(overlay);

    return () => {
      activeSession.end();
      sessionRef.current = null;
    };
  }, [isSimulator, sessionKey, onExit]);

  const handleCapture = useCallback(async () => {
    if (!sessionRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      await sessionRef.current.captureImage();
    } catch (err) {
      console.error('[ArView] captureImage failed:', err);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const handleRetake = useCallback(() => {
    setCaptureResult(null);
    setPlaneValid(false);
    setSessionKey((k) => k + 1);
  }, []);

  const handleExit = useCallback(() => {
    sessionRef.current?.end();
    onExit();
  }, [onExit]);

  return (
    <div className="ar-root">
      <canvas ref={canvasRef} className="ar-canvas" />
      <div ref={overlayRef} className="ar-overlay">
        <ReferenceHud
          step={step}
          trackingStatus={trackingStatus}
          guidance={guidance}
          error={error}
          isSimulator={isSimulator}
          isCapturing={isCapturing}
          planeValid={planeValid || isSimulator}
          captureResult={captureResult}
          onCapture={handleCapture}
          onRetake={handleRetake}
          onExit={handleExit}
          onDebug={() => setShowDebug((v) => !v)}
        />

        {showDebug && (
          <DebugPanel
            caps={capabilities}
            step={step}
            trackingStatus={trackingStatus}
            pointA={null}
            pointB={null}
            distanceMeters={null}
            liveDistanceMeters={null}
            orientation={null}
            guidance={guidance}
            isSimulator={isSimulator}
            onClose={() => setShowDebug(false)}
          />
        )}
      </div>
    </div>
  );
};

