import React, { useState, useEffect, useRef } from 'react';
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
import type {
  CaptureResult,
  CameraPoseData,
  CameraIntrinsicsData,
  TrouserPlaneData,
  WaistbandLandmarks,
  WaistbandWidthResult,
} from '../ar/captureTypes';
import { calculateTiltCorrectedWaistWidth } from '../ar/waistbandGeometry';

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
  onCaptureUpdate?: (result: CaptureResult) => void;
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
  onCaptureUpdate,
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [metaBlobUrl, setMetaBlobUrl] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);

  const allUnits = distanceMeters !== null ? formatAllUnits(distanceMeters) : null;
  const isDetecting = step === 'detecting' || step === 'idle';

  // Create persistent Blob URLs whenever a capture result arrives
  useEffect(() => {
    if (!captureResult?.imageDataUrl) {
      setBlobUrl(null);
      setMetaBlobUrl(null);
      return;
    }

    let imgUrl: string | null = null;
    let metaUrl: string | null = null;

    try {
      const parts = captureResult.imageDataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const imgBlob = new Blob([u8arr], { type: mime });
      imgUrl = URL.createObjectURL(imgBlob);
      setBlobUrl(imgUrl);

      const metaData = {
        capturedAt: captureResult.capturedAt,
        imageWidth: captureResult.imageWidth,
        imageHeight: captureResult.imageHeight,
        Z_m: captureResult.Z_m,
        distanceSource: captureResult.distanceSource,
        distanceValid: captureResult.distanceValid ?? (captureResult.Z_m !== null),
        distanceDefinition: captureResult.distanceDefinition ?? 'perpendicular-camera-to-plane',
        fx_pixels: captureResult.fx_pixels,
        fy_pixels: captureResult.fy_pixels,
        cx_pixels: captureResult.cx_pixels ?? null,
        cy_pixels: captureResult.cy_pixels ?? null,
        intrinsicsSource: captureResult.intrinsicsSource,
        intrinsics: captureResult.intrinsics ?? {
          fx_pixels: captureResult.fx_pixels,
          fy_pixels: captureResult.fy_pixels,
          cx_pixels: captureResult.cx_pixels ?? null,
          cy_pixels: captureResult.cy_pixels ?? null,
          imageWidth: captureResult.imageWidth,
          imageHeight: captureResult.imageHeight,
          projectionMatrix: captureResult.projectionMatrix,
          intrinsicsSource: captureResult.intrinsicsSource,
        },
        cameraPose: captureResult.cameraPose,
        planePosition: captureResult.planePosition,
        planeNormal: captureResult.planeNormal,
        planeQuaternion: captureResult.planeQuaternion ?? null,
        planeTransform: captureResult.planeTransform ?? null,
        planeSource: captureResult.planeSource ?? (captureResult.distanceSource === 'simulator' ? 'simulator' : 'webxr-hittest'),
        planeTrackingValid: captureResult.planeTrackingValid ?? captureResult.trackingValid,
        projectionMatrix: captureResult.projectionMatrix,
        waistbandLandmarks: captureResult.waistbandLandmarks ?? null,
        waistbandWidthResult: captureResult.waistbandWidthResult ?? null,
        trackingValid: captureResult.trackingValid,
        reliabilityNote: captureResult.reliabilityNote,
      };
      const jsonBlob = new Blob([JSON.stringify(metaData, null, 2)], { type: 'application/json' });
      metaUrl = URL.createObjectURL(jsonBlob);
      setMetaBlobUrl(metaUrl);
    } catch (err) {
      console.warn('[HUD] Error creating blob URLs:', err);
      setBlobUrl(captureResult.imageDataUrl);
    }

    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      if (metaUrl) URL.revokeObjectURL(metaUrl);
    };
  }, [captureResult]);

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

  // Handler for capturing an actual crystal-clear camera photograph via device camera
  const handleCameraPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        let fx = captureResult?.fx_pixels ?? null;
        let fy = captureResult?.fy_pixels ?? null;
        if (captureResult?.projectionMatrix && captureResult.projectionMatrix[0] > 0) {
          fx = (captureResult.projectionMatrix[0] * w) / 2;
          fy = (captureResult.projectionMatrix[5] * h) / 2;
        }

        const updated: CaptureResult = {
          imageDataUrl: dataUrl,
          imageWidth: w,
          imageHeight: h,
          Z_m: captureResult?.Z_m ?? null,
          distanceSource: captureResult?.distanceSource ?? (mode === 'manual' ? 'webxr-hittest' : 'focus-distance'),
          distanceValid: (captureResult?.Z_m ?? null) !== null,
          distanceDefinition: captureResult?.distanceDefinition ?? 'perpendicular-camera-to-plane',
          fx_pixels: fx,
          fy_pixels: fy,
          cx_pixels: captureResult?.cx_pixels ?? (w / 2),
          cy_pixels: captureResult?.cy_pixels ?? (h / 2),
          intrinsicsSource: captureResult?.intrinsicsSource ?? 'webxr-projection',
          intrinsics: captureResult?.intrinsics ?? null,
          cameraPose: captureResult?.cameraPose ?? null,
          planePosition: captureResult?.planePosition ?? null,
          planeNormal: captureResult?.planeNormal ?? null,
          planeQuaternion: captureResult?.planeQuaternion ?? null,
          planeTransform: captureResult?.planeTransform ?? null,
          planeSource: captureResult?.planeSource ?? 'webxr-hittest',
          planeTrackingValid: captureResult?.planeTrackingValid ?? true,
          plane: captureResult?.plane ?? null,
          projectionMatrix: captureResult?.projectionMatrix ?? null,
          waistbandLandmarks: captureResult?.waistbandLandmarks ?? null,
          waistbandWidthResult: captureResult?.waistbandWidthResult ?? null,
          capturedAt: new Date().toISOString(),
          trackingValid: true,
          reliabilityNote:
            'Image: High-resolution photo from device camera | Z: ' +
            (captureResult?.Z_m !== null && captureResult?.Z_m !== undefined ? captureResult.Z_m.toFixed(3) + 'm' : 'Recorded AR distance'),
        };

        onCaptureUpdate?.(updated);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    // Reset input so same file or another photo can be snapped
    e.target.value = '';
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
        <div className={`hud-tracking ${isCapturing ? 'calculating' : trackingStatus}`}>
          <span className="tracking-dot" />
          {isCapturing ? 'Calculating Measurement… ⏳' : TRACKING_LABEL[trackingStatus]}
        </div>

        {guidance && trackingStatus === 'good' && !error && !isCapturing && (
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

      {/* ── AI Scanning / Measurement In-Progress Animation ────────────── */}
      {(isScanningGarment || isCapturing) && (
        <div className="garment-scanning-overlay">
          <div className="scanning-box">
            <div className="scanning-laser" />
            <div className="scanning-spinner" />
            <h3>{isCapturing ? 'Capturing & Measuring…' : 'Measuring Waistband…'}</h3>
            <p>{isCapturing ? 'Taking photo and computing 3D waistband measurement' : 'HRNet Predicting Left & Right Waist Points'}</p>
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

      {/* Hidden file input for native mobile camera photography */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleCameraPhotoSelect}
      />

      {/* ── Capture Result Panel ──────────────────────────────────────── */}
      {captureResult && (
        <div className="capture-panel">
          <div className="capture-panel-header">
            <span className="capture-badge">
              {captureResult.distanceSource === 'simulator' ? '🎮 Simulator Capture' : '📷 Captured Frame'}
            </span>
            <div className="capture-header-actions">
              <a
                className="capture-download-btn"
                href={blobUrl || captureResult.imageDataUrl}
                download={`trouser_image_${new Date().toISOString().slice(0, 10)}.jpg`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  setDownloaded(true);
                  setTimeout(() => setDownloaded(false), 2500);
                }}
              >
                {downloaded ? '✓ Saved!' : '💾 Download'}
              </a>
              {metaBlobUrl && (
                <a
                  className="capture-json-btn"
                  href={metaBlobUrl}
                  download={`trouser_metadata_${new Date().toISOString().slice(0, 10)}.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  📄 Data
                </a>
              )}
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

          {/* Button to snap a clear camera photo if live feed was black or dark */}
          <button
            className="capture-snap-camera-btn"
            onClick={() => cameraInputRef.current?.click()}
          >
            📸 Snap Clear Photo with Phone Camera
          </button>
          <p className="capture-save-tip">
            💡 Tap "Download" above, or long-press the picture to "Save Image"
          </p>

          {/* Waistband Width Result Card (if calculated) */}
          {captureResult.waistbandWidthResult && captureResult.waistbandWidthResult.waistWidthCm !== null && (
            <div className="capture-waist-card">
              <div className="capture-waist-badge">
                {captureResult.waistbandWidthResult.measurementStatus === 'valid'
                  ? '✓ Calibrated Waistband'
                  : captureResult.waistbandWidthResult.measurementStatus === 'approximate'
                  ? '⚠️ Approximate Waistband'
                  : '⚠️ Warning'}
              </div>
              <div className="capture-waist-main">
                <span className="capture-waist-val">
                  {captureResult.waistbandWidthResult.waistWidthCm.toFixed(1)} cm
                </span>
                <span className="capture-waist-sub">
                  ({captureResult.waistbandWidthResult.waistWidthInches?.toFixed(1)} in)
                </span>
              </div>
              {captureResult.waistbandWidthResult.tiltAngleDeg !== null && (
                <div className="capture-waist-tilt">
                  Camera Tilt: {captureResult.waistbandWidthResult.tiltAngleDeg.toFixed(1)}° from vertical
                </div>
              )}
              {captureResult.waistbandWidthResult.measurementWarnings.length > 0 && (
                <div className="capture-waist-warnings">
                  {captureResult.waistbandWidthResult.measurementWarnings.map((w, idx) => (
                    <div key={idx} className="capture-warn-item">⚠️ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Waistband Landmarks Info (if present) */}
          {captureResult.waistbandLandmarks && (
            <div className="capture-meta-row">
              <span className="capture-meta-label">Waistband Landmarks</span>
              <span className="capture-meta-value">
                L: ({Math.round(captureResult.waistbandLandmarks.waistLeft.u)}, {Math.round(captureResult.waistbandLandmarks.waistLeft.v)}) px ·
                R: ({Math.round(captureResult.waistbandLandmarks.waistRight.u)}, {Math.round(captureResult.waistbandLandmarks.waistRight.v)}) px
              </span>
            </div>
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
              {captureResult.distanceSource ?? 'none'} ({captureResult.distanceDefinition ?? 'perpendicular'})
            </span>
          </div>

          {/* Focal lengths & Principal point */}
          <div className="capture-meta-row">
            <span className="capture-meta-label">fx / fy (pixels)</span>
            <span className={`capture-meta-value ${captureResult.fx_pixels === null ? 'meta-warn' : ''}`}>
              {captureResult.fx_pixels !== null && captureResult.fy_pixels !== null
                ? `${captureResult.fx_pixels.toFixed(1)} / ${captureResult.fy_pixels.toFixed(1)} px`
                : 'N/A'}
            </span>
          </div>
          <div className="capture-meta-row">
            <span className="capture-meta-label">cx / cy (principal pt)</span>
            <span className="capture-meta-value">
              {captureResult.cx_pixels !== null && captureResult.cx_pixels !== undefined && captureResult.cy_pixels !== null && captureResult.cy_pixels !== undefined
                ? `${captureResult.cx_pixels.toFixed(1)} / ${captureResult.cy_pixels.toFixed(1)} px`
                : 'N/A'}
            </span>
          </div>
          <div className="capture-meta-row">
            <span className="capture-meta-label">Intrinsics source</span>
            <span className="capture-meta-value capture-source-tag">
              {captureResult.intrinsicsSource ?? 'none'}
            </span>
          </div>

          {/* Camera Pose Summary */}
          {captureResult.cameraPose && (
            <div className="capture-meta-row">
              <span className="capture-meta-label">Camera Pose (world)</span>
              <span className="capture-meta-value">
                Pos: [{captureResult.cameraPose.position.x.toFixed(2)}, {captureResult.cameraPose.position.y.toFixed(2)}, {captureResult.cameraPose.position.z.toFixed(2)}]
              </span>
            </div>
          )}

          {/* Surface Plane Summary */}
          {captureResult.planePosition && captureResult.planeNormal && (
            <div className="capture-meta-row">
              <span className="capture-meta-label">Surface Plane</span>
              <span className="capture-meta-value">
                N: [{captureResult.planeNormal.x.toFixed(2)}, {captureResult.planeNormal.y.toFixed(2)}, {captureResult.planeNormal.z.toFixed(2)}] · {captureResult.planeSource ?? 'tracked'}
              </span>
            </div>
          )}

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

        {/* Dual capture buttons — live capture and camera snapshot */}
        {!captureResult && (
          <div className="hud-capture-row">
            <button
              className="hud-btn hud-btn-capture"
              onClick={onCapture}
              disabled={isCapturing}
              title="Capture the current camera frame with distance and calibration data"
            >
              {isCapturing ? '⏳ Capturing…' : '📷 Capture Image'}
            </button>
            <button
              className="hud-btn hud-btn-snap"
              onClick={() => cameraInputRef.current?.click()}
              title="Take a photo with your phone camera"
            >
              📸 Snap Photo
            </button>
          </div>
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
