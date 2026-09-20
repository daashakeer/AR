import React from 'react';
import type { MeasurementStep, TrackingStatus, AppError } from '../ar/ArSession';
import type { Unit } from '../utils/units';
import { formatPrimary, formatAllUnits, nextUnit, UNIT_DISPLAY } from '../utils/units';

interface Props {
  step: MeasurementStep;
  trackingStatus: TrackingStatus;
  distanceMeters: number | null;
  unit: Unit;
  error: AppError | null;
  onUnitChange: (u: Unit) => void;
  onReset: () => void;
  onExit: () => void;
  onDebug: () => void;
}

const STEP_INSTRUCTIONS: Record<MeasurementStep, string> = {
  idle: 'Initialising…',
  detecting: 'Scanning for a surface…',
  'place-a': '✦  Tap to place Point A',
  'place-b': '✦  Move to Point B and tap.',
  measured: 'Measurement complete.',
};

const TRACKING_LABEL: Record<TrackingStatus, string> = {
  detecting: 'Scanning…',
  good: 'Tracking: Good ✓',
  lost: 'Move slowly',
};

const ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': '🚫 Camera permission denied. Please allow camera access and try again.',
  'ar-unsupported': '⚠️ AR is not supported on this device or browser.',
  'session-failed': '⚠️ Could not start AR session. Please try again.',
  'session-interrupted': '⚠️ AR session was interrupted.',
  'camera-unavailable': '📷 Camera is not available on this device.',
  unknown: '⚠️ An unexpected error occurred. Please try again.',
};

export const HUD: React.FC<Props> = ({
  step,
  trackingStatus,
  distanceMeters,
  unit,
  error,
  onUnitChange,
  onReset,
  onExit,
  onDebug,
}) => {
  const allUnits = distanceMeters !== null ? formatAllUnits(distanceMeters) : null;
  const isDetecting = step === 'detecting' || step === 'idle';

  return (
    <div className="hud">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="hud-top">
        <button className="hud-btn-icon" onClick={onExit} aria-label="Exit AR">
          ✕
        </button>

        <div className={`hud-tracking ${trackingStatus}`}>
          <span className="tracking-dot" />
          {TRACKING_LABEL[trackingStatus]}
        </div>

        <button className="hud-btn-icon" onClick={onDebug} aria-label="Debug panel">
          ⚙
        </button>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="hud-error-banner">
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown}
        </div>
      )}

      {/* ── Surface detection tips (shown while scanning) ────────────────── */}
      {!error && isDetecting && (
        <div className="hud-tips-card">
          <p className="hud-tips-title">📡 Looking for a surface</p>
          <ul className="hud-tips-list">
            <li>Point at a <strong>textured, flat surface</strong> (floor, table, desk)</li>
            <li>Make sure the area is <strong>well-lit</strong></li>
            <li><strong>Move slowly</strong> side to side</li>
            <li>Avoid <strong>plain white walls or glass</strong></li>
          </ul>
        </div>
      )}

      {/* ── Instruction pill ────────────────────────────────────────────── */}
      {!error && step !== 'measured' && !isDetecting && (
        <div className="hud-instruction-wrap">
          <div className="hud-instruction">
            {STEP_INSTRUCTIONS[step]}
          </div>
        </div>
      )}

      {/* ── Result card ─────────────────────────────────────────────────── */}
      {step === 'measured' && allUnits && !error && (
        <div className="hud-result-wrap">
          <div className="hud-result-card">
            <div className="result-primary">
              {formatPrimary(distanceMeters!, unit)}
            </div>
            <div className="result-secondary">
              {unit !== 'cm' && <span>{allUnits.cm}</span>}
              {unit !== 'm' && <span>{allUnits.m}</span>}
              {unit !== 'in' && unit !== 'ft' && (
                <span>{allUnits.feetInches}</span>
              )}
              {unit === 'ft' && <span>{allUnits.feetInches}</span>}
              {unit === 'in' && <span>{allUnits.feet}</span>}
            </div>
            <p className="result-disclaimer">
              Measurements are estimates and may vary depending on your device,
              lighting, surface and tracking conditions.
            </p>
          </div>
        </div>
      )}

      {/* ── Bottom controls ─────────────────────────────────────────────── */}
      <div className="hud-bottom">
        {step === 'measured' && (
          <>
            <button
              className="hud-btn hud-btn-secondary"
              onClick={() => onUnitChange(nextUnit(unit))}
            >
              Unit: {UNIT_DISPLAY[unit]}
            </button>
            <button className="hud-btn hud-btn-primary" onClick={onReset}>
              Measure Again
            </button>
          </>
        )}

        {(step === 'place-a' || step === 'place-b') && (
          <button className="hud-btn hud-btn-danger" onClick={onReset}>
            Reset
          </button>
        )}

        <p className="hud-privacy">
          🔒 Your camera feed stays on your device.
        </p>
      </div>
    </div>
  );
};
