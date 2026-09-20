import React from 'react';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';
import type { TrackingStatus, MeasurementStep } from '../ar/ArSession';
import type { Point3D } from '../utils/distance';
import { formatPoint } from '../utils/distance';
import { formatAllUnits } from '../utils/units';

interface Props {
  caps: DeviceCapabilities;
  step: MeasurementStep;
  trackingStatus: TrackingStatus;
  pointA: Point3D | null;
  pointB: Point3D | null;
  distanceMeters: number | null;
  onClose: () => void;
}

export const DebugPanel: React.FC<Props> = ({
  caps,
  step,
  trackingStatus,
  pointA,
  pointB,
  distanceMeters,
  onClose,
}) => {
  const allUnits = distanceMeters !== null ? formatAllUnits(distanceMeters) : null;

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <span>🔧 Debug Info</span>
        <button className="debug-close" onClick={onClose} aria-label="Close debug panel">✕</button>
      </div>

      <div className="debug-body">
        <section>
          <h3>Device</h3>
          <Row label="Type" value={caps.deviceType} />
          <Row label="Browser" value={caps.browserName} />
          <Row label="Mobile" value={caps.isMobile ? 'Yes' : 'No'} />
        </section>

        <section>
          <h3>WebXR</h3>
          <Row label="WebXR API" value={caps.webXRSupported ? '✓ Yes' : '✗ No'} ok={caps.webXRSupported} />
          <Row label="Immersive AR" value={caps.arSupported ? '✓ Yes' : '✗ No'} ok={caps.arSupported} />
          <Row label="Camera" value={caps.hasCamera ? '✓ Yes' : '✗ No'} ok={caps.hasCamera} />
        </section>

        <section>
          <h3>Session</h3>
          <Row label="Step" value={step} />
          <Row
            label="Tracking"
            value={trackingStatus}
            ok={trackingStatus === 'good'}
          />
        </section>

        <section>
          <h3>Points (world space, meters)</h3>
          <Row label="Point A" value={pointA ? formatPoint(pointA) : '—'} mono />
          <Row label="Point B" value={pointB ? formatPoint(pointB) : '—'} mono />
        </section>

        {allUnits && (
          <section>
            <h3>Distance</h3>
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
