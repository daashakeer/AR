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

      // Fast non-blocking check
      const res = await detectAutomaticBoundaries(
        capture.imageDataUrl,
        capture.imageWidth,
        capture.imageHeight,
        capture.waistbandLandmarks
      );
      if (!cancelled) {
        setDetectedLandmarks(res);
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

  return (
    <div className="reference-panel">
      {/* ── Top Bar: Quick Actions ── */}
      <div className="reference-panel-header">
        <span className="capture-badge">
          {measurement.valid ? '✓ Captured & Measured' : '📷 Frame Captured'}
        </span>
        <div className="capture-header-actions">
          {imgBlobUrl && capture.imageDataUrl && (
            <a
              className="capture-download-btn"
              href={imgBlobUrl}
              download={imageFilename}
              rel="noopener noreferrer"
            >
              💾 Image
            </a>
          )}
          {jsonBlobUrl && (
            <a
              className="capture-json-btn"
              href={jsonBlobUrl}
              download={`slyte-reference-${captureId.slice(0, 8)}.json`}
              rel="noopener noreferrer"
            >
              📄 JSON
            </a>
          )}
          <button type="button" className="capture-retake-btn" onClick={onRetake}>
            🔄 Retake
          </button>
        </div>
      </div>

      {/* ── Captured image preview ── */}
      {capture.imageDataUrl ? (
        <div
          ref={imgWrapRef}
          className="reference-image-wrap"
          role="img"
          aria-label="Captured scene preview"
        >
          <img
            className="capture-preview reference-image"
            src={capture.imageDataUrl}
            alt="Captured frame"
            draggable={false}
          />
          {measurement.leftmostPixelPoint && markerEl(measurement.leftmostPixelPoint, 'L')}
          {measurement.rightmostPixelPoint && markerEl(measurement.rightmostPixelPoint, 'R')}
        </div>
      ) : (
        <div className="capture-no-image">
          Frame captured from camera.
        </div>
      )}

      {/* ── Focused Primary Results Card ── */}
      <div className="reference-metrics" style={{ marginTop: '0.5rem' }}>
        <div className="reference-metric-section-title">
          🎯 Measurement Results
        </div>

        {/* 1. fx-pixels */}
        <div className="reference-metric-row highlight">
          <span>fx (pixels)</span>
          <strong className="val-ok">
            {capture.fx_pixels != null ? `${capture.fx_pixels.toFixed(1)} px` : '—'}
          </strong>
        </div>

        {/* 2. Real world distance between points */}
        <div className="reference-metric-row highlight">
          <span>Real-World Distance</span>
          <strong className={measurement.fullXDistanceMeters !== null ? 'val-ok' : 'val-unavail'}>
            {measurement.fullXDistanceMeters !== null
              ? `${measurement.fullXDistanceMeters.toFixed(4)} m (${(measurement.fullXDistanceMeters * 100).toFixed(1)} cm)`
              : 'unavailable'}
          </strong>
        </div>

        {/* Secondary helper metrics */}
        <div className="reference-metric-row">
          <span>Pixel span (ΔX)</span>
          <span>
            {measurement.fullXPixelDistance !== null
              ? `${measurement.fullXPixelDistance.toFixed(1)} px`
              : '—'}
          </span>
        </div>

        <div className="reference-metric-row">
          <span>Image resolution</span>
          <span>
            {capture.imageWidth > 0 ? `${capture.imageWidth} × ${capture.imageHeight} px` : '—'}
          </span>
        </div>
      </div>

      {/* ── Explanatory Warnings if plane or points unavailable ── */}
      {measurement.warnings.length > 0 && (
        <ul className="reference-warnings">
          {measurement.warnings.map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}

      {/* ── Optional Collapsible Details ── */}
      <button
        type="button"
        className="ref-point-btn"
        style={{ marginTop: '0.6rem', width: '100%', fontSize: '11px' }}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '▲ Hide Technical Details' : '▼ View Technical Details'}
      </button>

      {showAdvanced && (
        <div
          className="reference-metrics"
          style={{ marginTop: '0.25rem', background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="reference-metric-row">
            <span>fy (pixels)</span>
            <span>{capture.fy_pixels != null ? `${capture.fy_pixels.toFixed(1)} px` : '—'}</span>
          </div>
          <div className="reference-metric-row">
            <span>cx / cy</span>
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
          <div className="reference-metric-row">
            <span>Plane tracking</span>
            <span>{capture.planeTrackingValid ? '✓ Locked' : '✗ Unlocked'}</span>
          </div>
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
