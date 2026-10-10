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
import type { GarmentMetrics } from '../ar/garmentMeasure';

export type MeasurementMode = 'manual' | 'garment';

export interface SavedMeasurement {
  id: string;
  timestamp: string;
  meters: number;
  orientation?: LineOrientation | null;
  garmentInfo?: string;
}

interface Props {
  mode: MeasurementMode;
  onModeChange: (m: MeasurementMode) => void;
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
  garmentMetrics: GarmentMetrics | null;
  isScanningGarment: boolean;
  onScanGarment: () => void;
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
  mode,
  onModeChange,
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
  garmentMetrics,
  isScanningGarment,
  onScanGarment,
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
    let text = '';
    if (garmentMetrics) {
      text = `👖 Pant Sizing (${garmentMetrics.pantType}):\nRecommended Size: ${garmentMetrics.recommendedSize}\nWaist Width: ${garmentMetrics.waistWidthCm.toFixed(1)} cm (${garmentMetrics.waistWidthInches.toFixed(1)} in)\nInseam: ${garmentMetrics.inseamInches.toFixed(1)} in\nOutseam: ${garmentMetrics.outseamInches.toFixed(1)} in`;
    } else if (distanceMeters !== null) {
      text = formatPrimary(distanceMeters, unit);
    }
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

        {/* Mode Switcher */}
        <div className="hud-mode-pill">
          <button
            className={`hud-mode-btn ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => onModeChange('manual')}
          >
            📏 Manual
          </button>
          <button
            className={`hud-mode-btn ${mode === 'garment' ? 'active' : ''}`}
            onClick={() => onModeChange('garment')}
          >
            👖 AI Pant
          </button>
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

      {/* ── Tracking status badge ─────────────────────────────────────── */}
      <div className="hud-status-row">
        <div className={`hud-tracking ${trackingStatus}`}>
          <span className="tracking-dot" />
          {TRACKING_LABEL[trackingStatus]}
        </div>

        {guidance && trackingStatus === 'good' && !error && (
          <div className={`hud-guidance ${guidance.status}`}>
            {guidance.message}
          </div>
        )}
      </div>

      {/* ── Simulator Banner (if in simulator mode) ────────────────────── */}
      {isSimulator && (
        <div className="hud-simulator-banner">
          <span>🎮 3D AR Simulator Mode</span>
          <span className="simulator-help">Drag to look • WASD to move</span>
        </div>
      )}

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="hud-error-banner">
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown}
        </div>
      )}

      {/* ── AI Garment Viewfinder & Instruction Overlay ─────────────────── */}
      {mode === 'garment' && !error && !garmentMetrics && !isScanningGarment && (
        <div className="garment-viewfinder-wrap">
          <div className="garment-viewfinder">
            <span className="corner top-left" />
            <span className="corner top-right" />
            <span className="corner bottom-left" />
            <span className="corner bottom-right" />
            <div className="viewfinder-waist-guide">Waistband Line</div>
          </div>
          <div className="garment-guide-pill">
            👖 Frame flat-laid pant inside the box
          </div>
        </div>
      )}

      {/* ── AI Scanning In-Progress Animation ───────────────────────────── */}
      {isScanningGarment && (
        <div className="garment-scanning-overlay">
          <div className="scanning-box">
            <div className="scanning-laser" />
            <div className="scanning-spinner" />
            <h3>Analyzing Garment with AI…</h3>
            <p>SAM3 Segmentation + HRNet Landmark Detection</p>
          </div>
        </div>
      )}

      {/* ── Surface detection tips (shown while scanning surface) ───────── */}
      {!error && isDetecting && mode === 'manual' && (
        <div className="hud-tips-card">
          <p className="hud-tips-title">📡 Looking for a surface</p>
          <ul className="hud-tips-list">
            <li>Point at a <strong>textured, flat surface</strong> (floor, desk, table)</li>
            <li>Make sure the area is <strong>well-lit</strong></li>
            <li><strong>Move slowly</strong> side to side</li>
          </ul>
        </div>
      )}

      {/* ── Live Distance & Level Pill (Manual Mode) ────────────────────── */}
      {!error && mode === 'manual' && step === 'place-b' && liveDistanceMeters !== null && (
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

      {/* ── Manual Instruction pill ─────────────────────────────────────── */}
      {!error && mode === 'manual' && step !== 'measured' && !isDetecting && (
        <div className="hud-instruction-wrap">
          <div className="hud-instruction">
            {STEP_INSTRUCTIONS[step]}
          </div>
        </div>
      )}

      {/* ── AI Garment Sizing Result Card ───────────────────────────────── */}
      {mode === 'garment' && garmentMetrics && !isScanningGarment && (
        <div className="hud-result-wrap">
          <div className="hud-result-card garment-result-card">
            <div className="result-header">
              <span className="result-badge">✓ AI Measured</span>
              <span className="result-orientation-badge">👖 {garmentMetrics.pantType}</span>
            </div>

            <div className="garment-primary-size">
              <span className="size-label">Recommended Size</span>
              <span className="size-number">Size {garmentMetrics.recommendedSize}</span>
            </div>

            <div className="garment-metrics-grid">
              <div className="garment-metric-item">
                <span className="metric-title">Waist Width</span>
                <span className="metric-val">{garmentMetrics.waistWidthCm.toFixed(1)} cm</span>
                <span className="metric-sub">({garmentMetrics.waistWidthInches.toFixed(1)} in)</span>
              </div>
              <div className="garment-metric-item">
                <span className="metric-title">Inseam</span>
                <span className="metric-val">{garmentMetrics.inseamInches.toFixed(1)} in</span>
                <span className="metric-sub">({(garmentMetrics.inseamMeters * 100).toFixed(1)} cm)</span>
              </div>
              <div className="garment-metric-item">
                <span className="metric-title">Outseam</span>
                <span className="metric-val">{garmentMetrics.outseamInches.toFixed(1)} in</span>
                <span className="metric-sub">({(garmentMetrics.outseamMeters * 100).toFixed(1)} cm)</span>
              </div>
            </div>

            <div className="result-actions">
              <button className="result-copy-btn" onClick={handleCopy}>
                {copied ? '✓ Copied!' : '📋 Copy Sizing'}
              </button>
              <button className="result-unit-cycle" onClick={onReset}>
                Scan Another ⟳
              </button>
            </div>

            <p className="result-disclaimer">
              3D AR planar unprojection from Hugging Face HRNet landmarks.
            </p>
          </div>
        </div>
      )}

      {/* ── Manual Result Card ──────────────────────────────────────────── */}
      {mode === 'manual' && step === 'measured' && allUnits && !error && (
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
              <button className="result-copy-btn" onClick={handleCopy}>
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
                : 'Measurements calibrated via WebXR world tracking.'}
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
                      <div className="history-time">
                        {item.timestamp} {item.garmentInfo ? `· ${item.garmentInfo}` : item.orientation?.label ? `· ${item.orientation.label}` : ''}
                      </div>
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
        {mode === 'garment' && !garmentMetrics && (
          <button
            className="hud-btn hud-btn-primary garment-scan-btn"
            onClick={onScanGarment}
            disabled={isScanningGarment}
          >
            {isScanningGarment ? '⏳ AI Scanning…' : '📸 Scan Pant with AI'}
          </button>
        )}

        {mode === 'garment' && garmentMetrics && (
          <button className="hud-btn hud-btn-secondary" onClick={onReset}>
            Measure Another
          </button>
        )}

        {mode === 'manual' && step === 'measured' && (
          <div className="hud-button-row">
            <button className="hud-btn hud-btn-secondary" onClick={onUndo}>
              ↶ Undo
            </button>
            <button className="hud-btn hud-btn-primary" onClick={onReset}>
              Measure Again
            </button>
          </div>
        )}

        {mode === 'manual' && step === 'place-b' && (
          <div className="hud-button-row">
            <button className="hud-btn hud-btn-secondary" onClick={onUndo}>
              ↶ Undo Point A
            </button>
            <button className="hud-btn hud-btn-danger" onClick={onReset}>
              Reset
            </button>
          </div>
        )}

        {mode === 'manual' && step === 'place-a' && pointsCount > 0 && (
          <button className="hud-btn hud-btn-danger" onClick={onReset}>
            Reset
          </button>
        )}

        <p className="hud-privacy">
          {mode === 'garment'
            ? '🤖 HRNet & SAM3 running via Hugging Face API'
            : isSimulator ? '🕹 Simulator running locally' : '🔒 Camera feed processed on-device'}
        </p>
      </div>
    </div>
  );
};
