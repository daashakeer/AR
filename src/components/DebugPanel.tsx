import React from 'react';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';
import type { TrackingStatus, MeasurementStep, CameraGuidance } from '../ar/ArSession';
import type { Point3D, LineOrientation } from '../utils/distance';
import { formatPoint } from '../utils/distance';
import { formatAllUnits, formatPrimary } from '../utils/units';

interface Props {
  caps: DeviceCapabilities;
  step: MeasurementStep;
  trackingStatus: TrackingStatus;
  pointA: Point3D | null;
  pointB: Point3D | null;
  distanceMeters: number | null;
  liveDistanceMeters: number | null;
  orientation: LineOrientation | null;
  guidance: CameraGuidance | null;
  isSimulator?: boolean;
  onClose: () => void;
}

export const DebugPanel: React.FC<Props> = ({
  caps,
  step,
  trackingStatus,
  pointA,
  pointB,
  distanceMeters,
  liveDistanceMeters,
  orientation,
  guidance,
  isSimulator,
  onClose,
}) => {
  const allUnits = distanceMeters !== null ? formatAllUnits(distanceMeters) : null;

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <span>🔧 AR Diagnostics</span>
        <button className="debug-close" onClick={onClose} aria-label="Close debug panel">✕</button>
      </div>

      <div className="debug-body">
        <section>
          <h3>Session Mode</h3>
          <Row label="Engine" value={isSimulator ? '🎮 3D Simulator' : '⚡ WebXR Immersive AR'} ok={!isSimulator} />
          <Row label="Device" value={caps.deviceType} />
          <Row label="Browser" value={caps.browserName} />
        </section>

        <section>
          <h3>Tracking & Guidance</h3>
          <Row label="Step" value={step} />
          <Row
            label="Tracking"
            value={trackingStatus}
            ok={trackingStatus === 'good'}
          />
          {guidance && (
            <Row
              label="Range"
              value={`${guidance.distanceMeters.toFixed(2)}m (${guidance.status})`}
              ok={guidance.status === 'optimal'}
            />
          )}
          {orientation && (
            <Row label="Orientation" value={orientation.label} />
          )}
        </section>

        <section>
          <h3>Coordinates (World Space, Meters)</h3>
          <Row label="Point A" value={pointA ? formatPoint(pointA) : '—'} mono />
          <Row label="Point B" value={pointB ? formatPoint(pointB) : '—'} mono />
          {liveDistanceMeters !== null && (
            <Row label="Live Distance" value={formatPrimary(liveDistanceMeters, 'cm')} />
          )}
        </section>

        {allUnits && (
          <section>
            <h3>Final Distance</h3>
            <Row label="cm" value={allUnits.cm} />
            <Row label="m" value={allUnits.m} />
            <Row label="in" value={allUnits.inches} />
            <Row label="ft" value={allUnits.feet} />
            <Row label="ft+in" value={allUnits.feetInches} />
          </section>
        )}
      </div>
    </div>
  );
};

interface RowProps {
  label: string;
  value: string;
  ok?: boolean;
  mono?: boolean;
}

const Row: React.FC<RowProps> = ({ label, value, ok, mono }) => (
  <div className="debug-row">
    <span className="debug-label">{label}</span>
    <span
      className={`debug-value ${ok === true ? 'ok' : ok === false ? 'bad' : ''} ${mono ? 'mono' : ''}`}
    >
      {value}
    </span>
  </div>
);
