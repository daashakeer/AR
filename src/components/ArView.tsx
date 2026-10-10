import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  ArSession,
  MeasurementStep,
  TrackingStatus,
  AppError,
  CameraGuidance,
} from '../ar/ArSession';
import { ArSimulator } from '../ar/ArSimulator';
import { HUD, SavedMeasurement } from './HUD';
import { DebugPanel } from './DebugPanel';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';
import type { Point3D, LineOrientation } from '../utils/distance';
import type { Unit } from '../utils/units';
import { feedback } from '../utils/feedback';

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

  // Start AR session or Simulator once canvas and overlay are mounted
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    let activeSession: ArSession | ArSimulator;

    const callbacks = {
      onTrackingStatus: (s: TrackingStatus) => setTrackingStatus(s),
      onStep: (st: MeasurementStep) => setStep(st),
      onPointA: (p: Point3D) => setPointA(p),
      onPointB: (p: Point3D) => setPointB(p),
      onPointsChange: (pts: Point3D[]) => setPointsCount(pts.length),
      onLiveDistance: (d: number | null) => setLiveDistanceMeters(d),
      onDistance: (d: number) => {
        setDistanceMeters(d);
        // Automatically save to measurement history
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
      onError: (e: AppError) => setError(e),
      onEnd: () => onExit(),
    };

    if (isSimulator) {
      activeSession = new ArSimulator(canvas, callbacks);
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
  }, [isSimulator]);

  const handleReset = useCallback(() => {
    sessionRef.current?.reset();
    setPointA(null);
    setPointB(null);
    setPointsCount(0);
    setDistanceMeters(null);
    setLiveDistanceMeters(null);
    setOrientation(null);
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
