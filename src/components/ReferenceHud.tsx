import React from 'react';
import type { MeasurementStep, TrackingStatus, AppError, CameraGuidance } from '../ar/ArSession';
import type { CaptureResult } from '../ar/captureTypes';
import { ReferenceMeasurePanel } from './ReferenceMeasurePanel';

interface Props {
  step: MeasurementStep;
  trackingStatus: TrackingStatus;
  guidance: CameraGuidance | null;
  error: AppError | null;
  isSimulator: boolean;
  isCapturing: boolean;
  planeValid: boolean;
  captureResult: CaptureResult | null;
  onCapture: () => void;
  onRetake: () => void;
  onExit: () => void;
  onDebug: () => void;
}

const STEP_INSTRUCTIONS: Partial<Record<MeasurementStep, string>> = {
  idle: 'Initialising AR…',
  detecting: 'Move phone slowly to detect a flat surface',
  ready: 'Surface tracked — tap Capture Image to automatically measure full-width X-distance',
};

const TRACKING_LABEL: Record<TrackingStatus, string> = {
  detecting: 'Scanning…',
  good: 'Tracking: Good ✓',
  lost: 'Tracking lost — move device to recover',
};

const ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': '🚫 Camera permission denied. Allow camera access and reload.',
  'ar-unsupported': '⚠️ WebXR AR is not available in this browser.',
  'session-failed': '⚠️ Could not start AR session.',
  'session-interrupted': '⚠️ AR session ended unexpectedly.',
  'camera-unavailable': '📷 No rear camera available.',
  unknown: '⚠️ Unexpected error.',
};

export const ReferenceHud: React.FC<Props> = ({
  step,
  trackingStatus,
  guidance,
  error,
  isSimulator,
  isCapturing,
  planeValid,
  captureResult,
  onCapture,
  onRetake,
  onExit,
  onDebug,
}) => {
  if (captureResult) {
    return (
      <div className="hud hud-reference-post">
        <div className="hud-top">
          <button type="button" className="hud-btn-icon" onClick={onExit} aria-label="Exit">
            ✕
          </button>
          <span className="hud-title-pill">Slyte Reference Measure</span>
          <button type="button" className="hud-btn-icon" onClick={onDebug} aria-label="Debug">
            ⚙
          </button>
        </div>
        <ReferenceMeasurePanel
          capture={captureResult}
          captureId={captureResult.captureId}
          onRetake={onRetake}
        />
      </div>
    );
  }

  return (
    <div className="hud">
      <div className="hud-top">
        <button type="button" className="hud-btn-icon" onClick={onExit} aria-label="Exit">
          ✕
        </button>
        <span className="hud-title-pill">Slyte Reference Measure</span>
        <button type="button" className="hud-btn-icon" onClick={onDebug} aria-label="Debug">
          ⚙
        </button>
      </div>

      <div className="hud-status-row">
        <div className={`hud-tracking ${isCapturing ? 'calculating' : trackingStatus}`}>
          <span className="tracking-dot" />
          {isCapturing ? 'Capturing camera frame…' : TRACKING_LABEL[trackingStatus]}
        </div>
        <div className={`hud-plane-badge ${planeValid ? 'ok' : ''}`}>
          Plane: {planeValid ? 'detected ✓' : 'scanning…'}
        </div>
      </div>

      {isSimulator && (
        <div className="hud-simulator-banner">
          <span>🎮 Simulator — image is a 3D render, not a real camera</span>
        </div>
      )}

      {error && <div className="hud-error-banner">{ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown}</div>}

      {guidance && trackingStatus === 'good' && !error && (
        <div className={`hud-guidance ${guidance.status}`}>{guidance.message}</div>
      )}

      {!error && step !== 'idle' && (
        <div className="hud-instruction-wrap">
          <div className="hud-instruction">{STEP_INSTRUCTIONS[step] ?? 'Ready'}</div>
        </div>
      )}

      <div className="hud-bottom">
        <button
          type="button"
          className="hud-btn hud-btn-capture"
          onClick={onCapture}
          disabled={isCapturing || (!isSimulator && !planeValid)}
          title={
            !isSimulator && !planeValid
              ? 'Wait for plane detection before capture'
              : 'Capture rear-camera image with AR pose metadata'
          }
        >
          {isCapturing ? '⏳ Capturing…' : '📷 Capture Image'}
        </button>
        <p className="hud-privacy">
          {isSimulator
            ? 'Desktop simulator for geometry testing only'
            : 'WebXR AR + separate rear-camera JPEG (not canvas screenshot)'}
        </p>
      </div>
    </div>
  );
};
