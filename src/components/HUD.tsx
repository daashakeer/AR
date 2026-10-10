import React, { useState } from 'react';
import type {
  MeasurementStep,
  TrackingStatus,
  AppError,
  CameraGuidance,
} from '../ar/ArSession';
import type { Unit } from '../utils/units';
import {
  formatPrimary,
  formatAllUnits,
  nextUnit,
  UNIT_DISPLAY,
} from '../utils/units';
import type { LineOrientation } from '../utils/distance';

export interface SavedMeasurement {
  id: string;
  timestamp: string;
  meters: number;
  orientation?: LineOrientation | null;
}

interface Props {
  step: MeasurementStep;
  trackingStatus: TrackingStatus;
  distanceMeters: number | null;
  liveDistanceMeters: number | null;
  orientation: LineOrientation | null;
  guidance: CameraGuidance | null;
  unit: Unit;
  error: AppError | null;
  pointsCount: number;
  isSimulator?: boolean;
  soundEnabled: boolean;
  history: SavedMeasurement[];
  onToggleSound: () => void;
  onUnitChange: (u: Unit) => void;
  onReset: () => void;
  onUndo: () => void;
  onExit: () => void;
  onDebug: () => void;
  onClearHistory: () => void;
}

const STEP_INSTRUCTIONS: Record<MeasurementStep, string> = {
  idle: 'Initialising…',
  detecting: 'Scanning for a surface…',
  'place-a': '✦  Tap to place Point A',
  'place-b': '✦  Move to Point B and tap',
  measured: 'Measurement complete',
};

const TRACKING_LABEL: Record<TrackingStatus, string> = {
  detecting: 'Scanning…',
  good: 'Tracking: Good ✓',
  lost: 'Tracking Lost',
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
  liveDistanceMeters,
  orientation,
  guidance,
  unit,
  error,
  pointsCount,
  isSimulator,
  soundEnabled,
  history,
  onToggleSound,
  onUnitChange,
  onReset,
  onUndo,
  onExit,
  onDebug,
  onClearHistory,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);

  const allUnits = distanceMeters !== null ? formatAllUnits(distanceMeters) : null;
  const isDetecting = step === 'detecting' || step === 'idle';

  const handleCopy = () => {
    if (distanceMeters === null) return;
    const text = formatPrimary(distanceMeters, unit);
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="hud">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="hud-top">
        <button className="hud-btn-icon" onClick={onExit} aria-label="Exit AR">
          ✕
        </button>

        <div className="hud-status-group">
          <div className={`hud-tracking ${trackingStatus}`}>
            <span className="tracking-dot" />
            {TRACKING_LABEL[trackingStatus]}
          </div>

          {/* Accuracy & distance guidance */}
          {guidance && trackingStatus === 'good' && !error && (
            <div className={`hud-guidance ${guidance.status}`}>
              {guidance.message}
            </div>
          )}
        </div>

        <div className="hud-top-right">
          <button
            className={`hud-btn-icon ${soundEnabled ? 'active' : ''}`}
            onClick={onToggleSound}
            aria-label="Toggle Sound"
            title={soundEnabled ? 'Sound ON' : 'Sound MUTED'}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          <button
            className={`hud-btn-icon ${showHistory ? 'active' : ''}`}
            onClick={() => setShowHistory((v) => !v)}
            aria-label="History"
            title="Measurement History"
          >
            📋
            {history.length > 0 && <span className="history-count">{history.length}</span>}
          </button>
          <button className="hud-btn-icon" onClick={onDebug} aria-label="Debug panel">
            ⚙
          </button>
        </div>
      </div>

      {/* ── Simulator Banner (if in simulator mode) ────────────────────── */}
      {isSimulator && (
        <div className="hud-simulator-banner">
          <span>🎮 3D AR Simulator Mode</span>
          <span className="simulator-help">Drag mouse to look • WASD to move • Click to measure</span>
        </div>
      )}

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
            <li>Point at a <strong>textured, flat surface</strong> (floor, desk, table)</li>
            <li>Make sure the area is <strong>well-lit</strong></li>
            <li><strong>Move slowly</strong> side to side</li>
            <li>Avoid <strong>featureless white walls or glass</strong></li>
          </ul>
        </div>
      )}

      {/* ── Live Distance & Level Pill (while stretching measuring tape) ── */}
      {!error && step === 'place-b' && liveDistanceMeters !== null && (
        <div className="hud-live-wrap">
          <div className="hud-live-pill">
            <span className="live-dot" />
            <span className="live-val">{formatPrimary(liveDistanceMeters, unit)}</span>
            {orientation && (
              <span className="live-orientation">{orientation.label}</span>
            )}
          </div>
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
            <div className="result-header">
              <span className="result-badge">✓ Measured</span>
              {orientation && (
                <span className="result-orientation-badge">{orientation.label}</span>
              )}
            </div>

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

            <div className="result-actions">
              <button
                className="result-copy-btn"
                onClick={handleCopy}
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
              <button
                className="result-unit-cycle"
                onClick={() => onUnitChange(nextUnit(unit))}
              >
                Unit: {UNIT_DISPLAY[unit]} ⟳
              </button>
            </div>

            <p className="result-disclaimer">
              {isSimulator
                ? 'Computed via virtual 3D room raycasting.'
                : 'Measurements are calibrated estimates via WebXR world tracking.'}
            </p>
          </div>
        </div>
      )}

      {/* ── History Drawer / Sheet ──────────────────────────────────────── */}
      {showHistory && (
        <div className="hud-history-drawer">
          <div className="history-header">
            <h3>Saved Measurements ({history.length})</h3>
            <div className="history-header-actions">
              {history.length > 0 && (
                <button className="history-clear-btn" onClick={onClearHistory}>Clear</button>
              )}
              <button className="history-close-btn" onClick={() => setShowHistory(false)}>✕</button>
            </div>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <p className="history-empty">No measurements saved yet.</p>
            ) : (
              history.map((item, idx) => (
                <div key={item.id} className="history-item">
                  <div className="history-item-left">
                    <span className="history-index">#{history.length - idx}</span>
                    <div>
                      <div className="history-value">{formatPrimary(item.meters, unit)}</div>
                      <div className="history-time">{item.timestamp} {item.orientation?.label ? `· ${item.orientation.label}` : ''}</div>
                    </div>
                  </div>
                  <button
                    className="history-copy-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(formatPrimary(item.meters, unit));
                    }}
                    title="Copy"
                  >
                    📋
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Bottom controls ─────────────────────────────────────────────── */}
      <div className="hud-bottom">
        {step === 'measured' && (
          <div className="hud-button-row">
            <button className="hud-btn hud-btn-secondary" onClick={onUndo}>
              ↶ Undo
            </button>
            <button className="hud-btn hud-btn-primary" onClick={onReset}>
              Measure Again
            </button>
          </div>
        )}

        {step === 'place-b' && (
          <div className="hud-button-row">
            <button className="hud-btn hud-btn-secondary" onClick={onUndo}>
              ↶ Undo Point A
            </button>
            <button className="hud-btn hud-btn-danger" onClick={onReset}>
              Reset
            </button>
          </div>
        )}

        {step === 'place-a' && pointsCount > 0 && (
          <button className="hud-btn hud-btn-danger" onClick={onReset}>
            Reset
          </button>
        )}

        <p className="hud-privacy">
          {isSimulator ? '🕹 Simulator running locally' : '🔒 Camera feed processed on-device'}
        </p>
      </div>
    </div>
  );
};
