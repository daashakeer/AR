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
import type { CaptureResult } from '../ar/captureTypes';

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
  captureResult: CaptureResult | null;
  isCapturing: boolean;
  onScanGarment: () => void;
  onCapture: () => void;
  onRetake: () => void;
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
  captureResult,
  isCapturing,
  onScanGarment,
  onCapture,
  onRetake,
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
  const [downloaded, setDownloaded] = useState(false);

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

  const handleDownload = async () => {
    if (!captureResult?.imageDataUrl) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `trouser_image_${timestamp}.jpg`;

    try {
      // 1. Convert base64 dataUrl to binary Blob (required for Android Chrome download)
      const parts = captureResult.imageDataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const imgBlob = new Blob([u8arr], { type: mime });

      // 2. Try native Web Share API (opens Android "Save to Device", "Photos", or share)
      const nav = navigator as unknown as {
        canShare?: (data: unknown) => boolean;
        share?: (data: unknown) => Promise<void>;
      };
      if (typeof File !== 'undefined' && typeof nav.share === 'function') {
        const file = new File([imgBlob], filename, { type: mime });
        if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
          try {
            await nav.share({
              files: [file],
              title: 'Trouser Photo & AR Measurement',
              text: `Camera Distance Z: ${captureResult.Z_m !== null ? captureResult.Z_m.toFixed(3) + 'm' : 'N/A'} | fx: ${captureResult.fx_pixels !== null ? captureResult.fx_pixels.toFixed(1) + 'px' : 'N/A'}`,
            });
            setDownloaded(true);
            setTimeout(() => setDownloaded(false), 2500);
            return;
          } catch (e: unknown) {
            if ((e as Error)?.name === 'AbortError') {
              return; // User dismissed share sheet
            }
          }
        }
      }

      // 3. Fallback: Standard Blob URL anchor download
      const imgUrl = URL.createObjectURL(imgBlob);
      const link = document.createElement('a');
      link.href = imgUrl;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (link.parentElement) document.body.removeChild(link);
        URL.revokeObjectURL(imgUrl);
      }, 5000);

      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2500);
    } catch (err) {
      console.error('[HUD] Download error:', err);
      // Fallback: open image in a new tab so user can long-press to save
      const win = window.open();
      if (win) {
        win.document.write(`<img src="${captureResult.imageDataUrl}" style="max-width:100%;height:auto;"/>`);
      }
    }
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
            👖 Point camera at flat-laid trousers — Auto Measuring
          </div>
        </div>
      )}

      {/* ── AI Scanning In-Progress Animation ───────────────────────────── */}
      {isScanningGarment && (
        <div className="garment-scanning-overlay">
          <div className="scanning-box">
            <div className="scanning-laser" />
            <div className="scanning-spinner" />
            <h3>Measuring Waistband…</h3>
            <p>HRNet Predicting Left & Right Waist Points</p>
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

      {/* ── AI Garment Waist Measurement Result Card ────────────────────── */}
      {mode === 'garment' && garmentMetrics && !isScanningGarment && (
        <div className="hud-result-wrap">
          <div className="hud-result-card garment-result-card">
            <div className="result-header">
              <span className="result-badge">✓ Auto-Measured by HRNet</span>
              <span className="result-orientation-badge">👖 Trouser Waist</span>
            </div>

            <div className="garment-primary-size">
              <span className="size-label">Flat Waistband Width</span>
              <span className="size-number">{garmentMetrics.waistWidthCm.toFixed(1)} cm</span>
              <span className="metric-sub" style={{ fontSize: '1rem', color: '#94a3b8' }}>
                ({garmentMetrics.waistWidthInches.toFixed(1)} in) · Est. Size {garmentMetrics.recommendedSize}
              </span>
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

      {/* ── Capture Result Panel ──────────────────────────────────────── */}
      {captureResult && (
        <div className="capture-panel">
          <div className="capture-panel-header">
            <span className="capture-badge">
              {captureResult.distanceSource === 'simulator' ? '🎮 Simulator Capture' : '📷 Captured Frame'}
            </span>
            <div className="capture-header-actions">
              <button className="capture-download-btn" onClick={handleDownload}>
                {downloaded ? '✓ Saved!' : '💾 Download'}
              </button>
              <button className="capture-retake-btn" onClick={onRetake}>🔄 Retake</button>
            </div>
          </div>

          {/* Image preview */}
          {captureResult.imageDataUrl ? (
            <img
              className="capture-preview"
              src={captureResult.imageDataUrl}
              alt="Captured trouser frame"
            />
          ) : (
            <div className="capture-no-image">⚠️ No image available</div>
          )}

          {/* Distance */}
          <div className="capture-meta-row">
            <span className="capture-meta-label">Z (camera → plane)</span>
            <span className={`capture-meta-value ${captureResult.Z_m === null ? 'meta-warn' : ''}`}>
              {captureResult.Z_m !== null
                ? `${captureResult.Z_m.toFixed(3)} m`
                : 'N/A — no plane detected'}
            </span>
          </div>
          <div className="capture-meta-row">
            <span className="capture-meta-label">Distance source</span>
            <span className="capture-meta-value capture-source-tag">
              {captureResult.distanceSource ?? 'none'}
            </span>
          </div>

          {/* Focal lengths */}
          <div className="capture-meta-row">
            <span className="capture-meta-label">fx (pixels)</span>
            <span className={`capture-meta-value ${captureResult.fx_pixels === null ? 'meta-warn' : ''}`}>
              {captureResult.fx_pixels !== null ? captureResult.fx_pixels.toFixed(1) : 'N/A'}
            </span>
          </div>
          <div className="capture-meta-row">
            <span className="capture-meta-label">fy (pixels)</span>
            <span className={`capture-meta-value ${captureResult.fy_pixels === null ? 'meta-warn' : ''}`}>
              {captureResult.fy_pixels !== null ? captureResult.fy_pixels.toFixed(1) : 'N/A'}
            </span>
          </div>
          <div className="capture-meta-row">
            <span className="capture-meta-label">Intrinsics source</span>
            <span className="capture-meta-value capture-source-tag">
              {captureResult.intrinsicsSource ?? 'none'}
            </span>
          </div>

          {/* Image dimensions */}
          <div className="capture-meta-row">
            <span className="capture-meta-label">Image size</span>
            <span className="capture-meta-value">
              {captureResult.imageWidth > 0
                ? `${captureResult.imageWidth} × ${captureResult.imageHeight} px`
                : 'N/A'}
            </span>
          </div>

          {/* Timestamp */}
          <div className="capture-meta-row">
            <span className="capture-meta-label">Captured at</span>
            <span className="capture-meta-value" style={{ fontSize: '0.7rem' }}>
              {new Date(captureResult.capturedAt).toLocaleTimeString()}
            </span>
          </div>

          {/* Reliability note */}
          <div className="capture-reliability-note">
            {captureResult.reliabilityNote}
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

        {/* Capture Image button — visible in both modes when no capture in progress */}
        {!captureResult && (
          <button
            className="hud-btn hud-btn-capture"
            onClick={onCapture}
            disabled={isCapturing}
            title="Capture the current camera frame with distance and calibration data"
          >
            {isCapturing ? '⏳ Capturing…' : '📷 Capture Image'}
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
