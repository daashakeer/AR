import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  ArSession,
  MeasurementStep,
  TrackingStatus,
  AppError,
} from '../ar/ArSession';
import { HUD } from './HUD';
import { DebugPanel } from './DebugPanel';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';
import type { Point3D } from '../utils/distance';
import type { Unit } from '../utils/units';

interface Props {
  capabilities: DeviceCapabilities;
  onExit: () => void;
}

export const ArView: React.FC<Props> = ({ capabilities, onExit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ArSession | null>(null);

  const [step, setStep] = useState<MeasurementStep>('idle');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('detecting');
  const [pointA, setPointA] = useState<Point3D | null>(null);
  const [pointB, setPointB] = useState<Point3D | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [unit, setUnit] = useState<Unit>('cm');
  const [showDebug, setShowDebug] = useState(false);

  // Start AR session once canvas and overlay are mounted
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const arSession = new ArSession(canvas, {
      onTrackingStatus: setTrackingStatus,
      onStep: setStep,
      onPointA: (p) => setPointA(p),
      onPointB: (p) => setPointB(p),
      onDistance: (d) => setDistanceMeters(d),
      onError: (e) => setError(e),
      onEnd: () => onExit(),
    });

    sessionRef.current = arSession;
    arSession.start(overlay);

    return () => {
      arSession.end();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = useCallback(() => {
    sessionRef.current?.reset();
    setPointA(null);
    setPointB(null);
    setDistanceMeters(null);
    setError(null);
  }, []);

  const handleExit = useCallback(() => {
    sessionRef.current?.end();
    onExit();
  }, [onExit]);

  return (
    <div className="ar-root">
      {/*
        The canvas fills the entire viewport.
        Three.js / WebXR renders directly into it.
        In AR mode, the browser composites this over the camera feed.
      */}
      <canvas ref={canvasRef} className="ar-canvas" />

      {/*
        The overlay div is registered as the dom-overlay root.
        It floats on top of the AR canvas, receiving pointer events.
        All HUD controls live here so they appear in the AR experience.
      */}
      <div ref={overlayRef} className="ar-overlay">
        <HUD
          step={step}
          trackingStatus={trackingStatus}
          distanceMeters={distanceMeters}
          unit={unit}
          error={error}
          onUnitChange={setUnit}
          onReset={handleReset}
          onExit={handleExit}
          onDebug={() => setShowDebug((v) => !v)}
        />

        {showDebug && (
          <DebugPanel
            caps={capabilities}
            step={step}
            trackingStatus={trackingStatus}
            pointA={pointA}
            pointB={pointB}
            distanceMeters={distanceMeters}
            onClose={() => setShowDebug(false)}
          />
        )}
      </div>
    </div>
  );
};
