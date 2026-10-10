import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  ArSession,
  MeasurementStep,
  TrackingStatus,
  AppError,
  CameraGuidance,
} from '../ar/ArSession';
import { ArSimulator } from '../ar/ArSimulator';
import { MobileCameraSession } from '../ar/MobileCameraSession';
import { HUD, SavedMeasurement, MeasurementMode } from './HUD';
import { DebugPanel } from './DebugPanel';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';
import type { Point3D, LineOrientation } from '../utils/distance';
import type { Unit } from '../utils/units';
import type { GarmentMetrics } from '../ar/garmentMeasure';
import type { CaptureResult } from '../ar/captureTypes';
import { feedback } from '../utils/feedback';

interface Props {
  capabilities: DeviceCapabilities;
  isSimulator?: boolean;
  initialMode?: MeasurementMode;
  onExit: () => void;
}

export const ArView: React.FC<Props> = ({
  capabilities,
  isSimulator = false,
  initialMode = 'manual',
  onExit,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ArSession | ArSimulator | MobileCameraSession | null>(null);

  const [mode, setMode] = useState<MeasurementMode>(initialMode);
  const [step, setStep] = useState<MeasurementStep>('idle');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('detecting');
  const [pointA, setPointA] = useState<Point3D | null>(null);
  const [pointB, setPointB] = useState<Point3D | null>(null);
  const [pointsCount, setPointsCount] = useState<number>(0);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [liveDistanceMeters, setLiveDistanceMeters] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<LineOrientation | null>(null);
  const [guidance, setGuidance] = useState<CameraGuidance | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [unit, setUnit] = useState<Unit>('cm');
  const [showDebug, setShowDebug] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [history, setHistory] = useState<SavedMeasurement[]>([]);

  // Garment Auto-Measure State
  const [garmentMetrics, setGarmentMetrics] = useState<GarmentMetrics | null>(null);
  const [isScanningGarment, setIsScanningGarment] = useState<boolean>(false);

  // Image capture state
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Start AR session or Simulator once canvas and overlay are mounted
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    let activeSession: ArSession | ArSimulator | MobileCameraSession;

    const callbacks = {
      onTrackingStatus: (s: TrackingStatus) => setTrackingStatus(s),
      onStep: (st: MeasurementStep) => setStep(st),
      onPointA: (p: Point3D) => setPointA(p),
      onPointB: (p: Point3D) => setPointB(p),
      onPointsChange: (pts: Point3D[]) => setPointsCount(pts.length),
      onLiveDistance: (d: number | null) => setLiveDistanceMeters(d),
      onDistance: (d: number) => {
        setDistanceMeters(d);
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setHistory((prev) => [
          {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: timeStr,
            meters: d,
            orientation,
          },
          ...prev,
        ]);
      },
      onOrientation: (ori: LineOrientation | null) => setOrientation(ori),
      onGuidance: (g: CameraGuidance) => setGuidance(g),
      onGarmentMeasured: (metrics: GarmentMetrics) => {
        setGarmentMetrics(metrics);
        setDistanceMeters(metrics.waistWidthMeters);

        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setHistory((prev) => [
          {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: timeStr,
            meters: metrics.waistWidthMeters,
            garmentInfo: `Size ${metrics.recommendedSize} (${metrics.pantType})`,
          },
          ...prev,
        ]);
      },
      onGarmentScanning: (scanning: boolean) => setIsScanningGarment(scanning),
      onCapture: (result: CaptureResult) => setCaptureResult(result),
      onError: (e: AppError) => setError(e),
      onEnd: () => onExit(),
    };

    if (isSimulator) {
      activeSession = new ArSimulator(canvas, callbacks);
    } else if (mode === 'garment' || !capabilities.arSupported) {
      activeSession = new MobileCameraSession(canvas, callbacks);
    } else {
      activeSession = new ArSession(canvas, callbacks);
    }

    sessionRef.current = activeSession;
    activeSession.start(overlay);

    return () => {
      activeSession.end();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulator, mode, capabilities.arSupported]);

  const handleReset = useCallback(() => {
    sessionRef.current?.reset();
    setPointA(null);
    setPointB(null);
    setPointsCount(0);
    setDistanceMeters(null);
    setLiveDistanceMeters(null);
    setOrientation(null);
    setGarmentMetrics(null);
    setCaptureResult(null);
    setError(null);
  }, []);

  const handleUndo = useCallback(() => {
    sessionRef.current?.undoLastPoint();
    setDistanceMeters(null);
  }, []);

  const handleExit = useCallback(() => {
    sessionRef.current?.end();
    onExit();
  }, [onExit]);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      feedback.setSoundEnabled(next);
      return next;
    });
  }, []);

  const handleScanGarment = useCallback(async () => {
    if (!sessionRef.current) return;
    await sessionRef.current.scanGarment();
  }, []);

  const handleCapture = useCallback(async () => {
    if (!sessionRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      await sessionRef.current.captureImage();
      // result is delivered via the onCapture callback → setCaptureResult
    } catch (err) {
      console.error('[ArView] captureImage failed:', err);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const handleRetake = useCallback(() => {
    setCaptureResult(null);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return (
    <div className="ar-root">
      {/* 3D AR or Simulator Canvas */}
      <canvas ref={canvasRef} className="ar-canvas" />

      {/* DOM Overlay on top of AR Canvas */}
      <div ref={overlayRef} className="ar-overlay">
        <HUD
          mode={mode}
          onModeChange={setMode}
          step={step}
          trackingStatus={trackingStatus}
          distanceMeters={distanceMeters}
          liveDistanceMeters={liveDistanceMeters}
          orientation={orientation}
          guidance={guidance}
          unit={unit}
          error={error}
          pointsCount={pointsCount}
          isSimulator={isSimulator}
          soundEnabled={soundEnabled}
          history={history}
          garmentMetrics={garmentMetrics}
          isScanningGarment={isScanningGarment}
          captureResult={captureResult}
          isCapturing={isCapturing}
          onScanGarment={handleScanGarment}
          onCapture={handleCapture}
          onRetake={handleRetake}
          onToggleSound={handleToggleSound}
          onUnitChange={setUnit}
          onReset={handleReset}
          onUndo={handleUndo}
          onExit={handleExit}
          onDebug={() => setShowDebug((v) => !v)}
          onClearHistory={handleClearHistory}
        />

        {showDebug && (
          <DebugPanel
            caps={capabilities}
            step={step}
            trackingStatus={trackingStatus}
            pointA={pointA}
            pointB={pointB}
            distanceMeters={distanceMeters}
            liveDistanceMeters={liveDistanceMeters}
            orientation={orientation}
            guidance={guidance}
            isSimulator={isSimulator}
            onClose={() => setShowDebug(false)}
          />
        )}
      </div>
    </div>
  );
};
