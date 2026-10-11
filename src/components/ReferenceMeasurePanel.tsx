import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureResult, WaistbandLandmarks } from '../ar/captureTypes';
import {
  computeAutoXMeasurement,
  detectAutomaticBoundaries,
  mapImagePointToContainerFraction,
  type AutoXMeasurementResult,
  type PixelPoint,
} from '../ar/referenceGeometry';
import { buildReferenceExportJson } from '../ar/referenceExport';

interface Props {
  capture: CaptureResult;
  captureId: string;
  onRetake: () => void;
  onExportReady?: (json: object) => void;
}

/** Format a 3-component vector for display */
function fmtVec3(v: { x: number; y: number; z: number } | null, decimals = 4): string {
  if (!v) return '—';
  return `(${v.x.toFixed(decimals)}, ${v.y.toFixed(decimals)}, ${v.z.toFixed(decimals)})`;
}

/** Format a number safely */
function fmtNum(n: number | null | undefined, decimals = 4, unit = ''): string {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}${unit}`;
}

export const ReferenceMeasurePanel: React.FC<Props> = ({
  capture,
  captureId,
  onRetake,
  onExportReady,
}) => {
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const [jsonBlobUrl, setJsonBlobUrl] = useState<string | null>(null);
  const [imgBlobUrl, setImgBlobUrl] = useState<string | null>(null);
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectedLandmarks, setDetectedLandmarks] = useState<WaistbandLandmarks | null>(
    capture.waistbandLandmarks ?? null
  );

  // ResizeObserver for responsive boundary marker overlay
  useEffect(() => {
    const el = imgWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setWrapSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [capture.imageDataUrl]);

  // Run automatic boundary detection on capture frame if not already present
  useEffect(() => {
    let cancelled = false;

    async function runDetection() {
      if (capture.waistbandLandmarks) {
        setDetectedLandmarks(capture.waistbandLandmarks);
        return;
      }

      setIsDetecting(true);
      const res = await detectAutomaticBoundaries(
        capture.imageDataUrl,
        capture.imageWidth,
        capture.imageHeight,
        capture.waistbandLandmarks
      );
      if (!cancelled) {
        setDetectedLandmarks(res);
        setIsDetecting(false);
      }
    }

    runDetection();
    return () => {
      cancelled = true;
    };
  }, [capture]);

  // Compute automatic full horizontal X-distance
  const measurement: AutoXMeasurementResult = useMemo(
    () =>
      computeAutoXMeasurement({
        landmarks: detectedLandmarks,
        imageWidth: capture.imageWidth,
        imageHeight: capture.imageHeight,
        pose: capture.cameraPose,
        intrinsics: capture.intrinsics ?? null,
        plane: capture.plane ?? null,
        trackingValid: capture.trackingValid,
      }),
    [detectedLandmarks, capture]
  );

  // Build JSON export document
  const exportJson = useMemo(
    () =>
      buildReferenceExportJson({
        capture,
        captureId,
        measurement,
      }),
    [capture, captureId, measurement]
  );

  useEffect(() => {
    onExportReady?.(exportJson);
  }, [exportJson, onExportReady]);

  // Create persistent blob URLs for image and JSON downloads
  useEffect(() => {
    if (!capture.imageDataUrl) {
      setImgBlobUrl(null);
      setJsonBlobUrl(null);
      return;
    }

    let imgUrl: string | null = null;
    try {
      const parts = capture.imageDataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bstr = atob(parts[1]);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
      const imgBlob = new Blob([u8arr], { type: mime });
      imgUrl = URL.createObjectURL(imgBlob);
      setImgBlobUrl(imgUrl);
    } catch {
      setImgBlobUrl(capture.imageDataUrl);
    }

    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [capture.imageDataUrl]);

  useEffect(() => {
    if (!capture.imageDataUrl) return;
    let metaUrl: string | null = null;
    try {
      const jsonBlob = new Blob([JSON.stringify(exportJson, null, 2)], {
        type: 'application/json',
      });
      metaUrl = URL.createObjectURL(jsonBlob);
      setJsonBlobUrl(metaUrl);
    } catch {
      /* ignore */
    }
    return () => {
      if (metaUrl) URL.revokeObjectURL(metaUrl);
    };
  }, [exportJson, capture.imageDataUrl]);

  const imageFilename = exportJson.image.filename;

  // Render automatic boundary line and markers
  const markerEl = (p: PixelPoint, label: string) => {
    const frac =
      wrapSize.w > 0
        ? mapImagePointToContainerFraction(
            p.u,
            p.v,
            capture.imageWidth,
            capture.imageHeight,
            wrapSize.w,
            wrapSize.h
          )
        : null;
    if (!frac) return null;
    return (
      <span
        key={label}
        className={`ref-marker ref-marker-${label.toLowerCase()}`}
        style={{ left: `${frac.left * 100}%`, top: `${frac.top * 100}%` }}
        title={`${label} boundary (${Math.round(p.u)}px)`}
      >
        {label}
      </span>
    );
  };

  const pose = capture.cameraPose;
  const plane = capture.plane ?? null;
  const intrinsics = capture.intrinsics ?? null;

  return (
    <div className="reference-panel">
      {/* ── Header: status + download actions ────────────────────── */}
      <div className="reference-panel-header">
        <span className="capture-badge">
          {capture.imageCaptureSource === 'simulator-render'
            ? '🎮 Simulator Boundary Auto-Detection'
            : isDetecting
            ? '⏳ Detecting Boundary Extents…'
            : measurement.valid
            ? '✓ Automatic Boundary Locked'
            : '⚠️ Boundary Unidentified'}
        </span>
        <div className="capture-header-actions">
          {imgBlobUrl && capture.imageDataUrl && (
            <a
              className="capture-download-btn"
              href={imgBlobUrl}
              download={imageFilename}
              rel="noopener noreferrer"
            >
              💾 Download Image
            </a>
          )}
          {jsonBlobUrl && (
            <a
              className="capture-json-btn"
              href={jsonBlobUrl}
              download={`slyte-reference-${captureId.slice(0, 8)}.json`}
              rel="noopener noreferrer"
            >
              📄 Download JSON
            </a>
          )}
          <button type="button" className="capture-retake-btn" onClick={onRetake}>
            🔄 Retake
          </button>
        </div>
      </div>

      {/* ── Image preview with automatic boundary overlays ────────── */}
      {!capture.imageDataUrl ? (
        <div className="capture-no-image">
          Camera image unavailable. WebXR passthrough cannot be read from the Three.js canvas.
          Grant rear-camera permissions and retake.
        </div>
      ) : (
        <div
          ref={imgWrapRef}
          className="reference-image-wrap"
          role="img"
          aria-label="Captured scene with automatic X-distance boundary overlay"
        >
          <img
            className="capture-preview reference-image"
            src={capture.imageDataUrl}
            alt="Captured reference frame"
            draggable={false}
          />
          {measurement.leftmostPixelPoint && markerEl(measurement.leftmostPixelPoint, 'L')}
          {measurement.rightmostPixelPoint && markerEl(measurement.rightmostPixelPoint, 'R')}
        </div>
      )}

      {/* ── Automatic Measurement Output Banner ─────────────────────── */}
      <div className="reference-metrics">
        <div className="reference-metric-section-title">
          📏 Automatic Full-Width X-Distance
        </div>

        <div className="reference-metric-row highlight">
          <span>fullXPixelDistance</span>
          <strong>
            {measurement.fullXPixelDistance !== null
              ? `${measurement.fullXPixelDistance.toFixed(1)} px`
              : '—'}
          </strong>
        </div>

        <div className="reference-metric-row highlight">
          <span>fullXDistanceMeters</span>
          <strong className={measurement.fullXDistanceMeters !== null ? 'val-ok' : 'val-unavail'}>
            {measurement.fullXDistanceMeters !== null
              ? `${measurement.fullXDistanceMeters.toFixed(4)} m (${(measurement.fullXDistanceMeters * 100).toFixed(1)} cm)`
              : 'unavailable'}
          </strong>
        </div>

        <div className="reference-metric-row">
          <span>leftmostPixelX</span>
          <span>{fmtNum(measurement.leftmostPixelX, 1, ' px')}</span>
        </div>

        <div className="reference-metric-row">
          <span>rightmostPixelX</span>
          <span>{fmtNum(measurement.rightmostPixelX, 1, ' px')}</span>
        </div>

        {/* 3D World Positions */}
        <div className="reference-metric-row">
          <span>leftmostWorldPoint</span>
          <span className="mono">{fmtVec3(measurement.leftmostWorldPoint)}</span>
        </div>

        <div className="reference-metric-row">
          <span>rightmostWorldPoint</span>
          <span className="mono">{fmtVec3(measurement.rightmostWorldPoint)}</span>
        </div>

        {measurement.displacementWorld && (
          <div className="reference-metric-row">
            <span>Δx / Δy / Δz (world)</span>
            <span className="mono">
              {fmtNum(measurement.displacementWorld.dx, 4)} /{' '}
              {fmtNum(measurement.displacementWorld.dy, 4)} /{' '}
              {fmtNum(measurement.displacementWorld.dz, 4)} m
            </span>
          </div>
        )}

        <div className="reference-metric-section-title" style={{ marginTop: '0.75rem' }}>
          📷 Image &amp; Camera Intrinsics
        </div>

        <div className="reference-metric-row">
          <span>Image size</span>
          <span>
            {capture.imageWidth > 0 ? `${capture.imageWidth} × ${capture.imageHeight} px` : '—'}
          </span>
        </div>

        <div className="reference-metric-row">
          <span>fx / fy (px)</span>
          <span>
            {capture.fx_pixels != null && capture.fy_pixels != null
              ? `${capture.fx_pixels.toFixed(1)} / ${capture.fy_pixels.toFixed(1)}`
              : '—'}
          </span>
        </div>

        <div className="reference-metric-row">
          <span>cx / cy (px)</span>
          <span>
            {capture.cx_pixels != null && capture.cy_pixels != null
              ? `${capture.cx_pixels.toFixed(1)} / ${capture.cy_pixels.toFixed(1)}`
              : '—'}
          </span>
        </div>

        <div className="reference-metric-row">
          <span>Intrinsics source</span>
          <span>{capture.intrinsicsSource ?? '—'}</span>
        </div>

        <div className="reference-metric-section-title" style={{ marginTop: '0.75rem' }}>
          🌐 AR Tracking &amp; Plane Extent
        </div>

        <div className="reference-metric-row">
          <span>Pose / plane tracking</span>
          <span>
            {capture.trackingValid ? '✓ pose' : '✗ pose'} ·{' '}
            {capture.planeTrackingValid ? '✓ plane' : '✗ plane'}
          </span>
        </div>

        {plane?.planePosition && (
          <div className="reference-metric-row">
            <span>Plane position (world)</span>
            <span className="mono">{fmtVec3(plane.planePosition)}</span>
          </div>
        )}

        {plane?.planeNormal && (
          <div className="reference-metric-row">
            <span>Plane normal</span>
            <span className="mono">{fmtVec3(plane.planeNormal)}</span>
          </div>
        )}

        {pose?.position && (
          <div className="reference-metric-row">
            <span>Camera position (world)</span>
            <span className="mono">{fmtVec3(pose.position)}</span>
          </div>
        )}

        <div className="reference-metric-section-title" style={{ marginTop: '0.75rem' }}>
          🔍 Boundary Detection Details
        </div>

        <div className="reference-metric-row">
          <span>Measurement Area</span>
          <span style={{ fontSize: '0.76rem', maxWidth: '60%', textAlign: 'right' }}>
            {measurement.measurementAreaDefinition}
          </span>
        </div>

        <div className="reference-metric-row">
          <span>Detection Method</span>
          <span>{measurement.method}</span>
        </div>

        <div className="reference-metric-row">
          <span>Detection Source</span>
          <span>{measurement.detectionSource ?? 'none'}</span>
        </div>

        <div className="reference-metric-row">
          <span>Status</span>
          <span className={measurement.valid ? 'val-ok' : 'val-unavail'}>
            {measurement.valid ? '✓ valid' : 'unavailable'}
          </span>
        </div>
      </div>

      {/* ── Explanatory Warnings / Error Diagnostics ──────────────────── */}
      {measurement.warnings.length > 0 && (
        <ul className="reference-warnings">
          {measurement.warnings.map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}

      {/* ── Advanced Diagnostics (Collapsible) ───────────────────────── */}
      <button
        type="button"
        className="ref-point-btn"
        style={{ marginTop: '0.75rem', width: '100%' }}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '▲ Hide Advanced Matrix Diagnostics' : '▼ View 4x4 Matrices & Raw Metadata'}
      </button>

      {showAdvanced && (
        <div
          className="reference-metrics"
          style={{ marginTop: '0.25rem', background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="reference-metric-section-title">Projection Matrix (Column-Major)</div>
          {capture.projectionMatrix ? (
            <div className="reference-metric-row" style={{ flexDirection: 'column', gap: '0.1rem' }}>
              {[0, 1, 2, 3].map((row) => (
                <span key={row} className="mono" style={{ fontSize: '0.7rem' }}>
                  [{capture.projectionMatrix!.slice(row * 4, row * 4 + 4).map((v) => v.toFixed(5)).join(', ')}]
                </span>
              ))}
            </div>
          ) : (
            <div className="reference-metric-row">
              <span>Projection matrix</span>
              <span>—</span>
            </div>
          )}

          <div className="reference-metric-section-title" style={{ marginTop: '0.5rem' }}>
            Camera World Matrix
          </div>
          {pose?.cameraMatrix ? (
            <div className="reference-metric-row" style={{ flexDirection: 'column', gap: '0.1rem' }}>
              {[0, 1, 2, 3].map((row) => (
                <span key={row} className="mono" style={{ fontSize: '0.7rem' }}>
                  [{pose.cameraMatrix.slice(row * 4, row * 4 + 4).map((v) => v.toFixed(5)).join(', ')}]
                </span>
              ))}
            </div>
          ) : (
            <div className="reference-metric-row">
              <span>Camera world matrix</span>
              <span>—</span>
            </div>
          )}

          <div className="reference-metric-row">
            <span>Capture ID</span>
            <span className="mono" style={{ fontSize: '0.68rem', wordBreak: 'break-all' }}>
              {captureId}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
