/**
 * 3D distance and geometric calculations using real-world coordinates from WebXR.
 * All distances are in METERS (WebXR coordinate system unit).
 * No screen pixels are involved.
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface LineOrientation {
  angleDegrees: number;
  type: 'horizontal' | 'vertical' | 'sloped';
  label: string;
}

/**
 * Euclidean distance between two 3D world-space points.
 * Returns distance in METERS.
 */
export function euclideanDistance(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate the total cumulative distance across an ordered series of 3D points.
 */
export function calculatePathDistance(points: Point3D[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += euclideanDistance(points[i], points[i + 1]);
  }
  return total;
}

/**
 * Calculate each segment's distance along a polyline.
 */
export function calculateSegmentDistances(points: Point3D[]): number[] {
  if (points.length < 2) return [];
  const segments: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push(euclideanDistance(points[i], points[i + 1]));
  }
  return segments;
}

/**
 * Determine the physical orientation and inclination angle of a measurement line.
 * Compares vertical displacement (dy) against ground-plane horizontal displacement (sqrt(dx^2 + dz^2)).
 */
export function getLineOrientation(a: Point3D, b: Point3D): LineOrientation {
  const dx = b.x - a.x;
  const dy = Math.abs(b.y - a.y);
  const dz = b.z - a.z;
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);

  // Elevation angle from ground plane (0° = level horizontal, 90° = vertical wall/plumb)
  const angleRad = Math.atan2(dy, horizontalDist);
  const angleDeg = (angleRad * 180) / Math.PI;

  if (angleDeg <= 6) {
    return {
      angleDegrees: angleDeg,
      type: 'horizontal',
      label: `Horizontal (Level ${angleDeg.toFixed(1)}°)`,
    };
  } else if (angleDeg >= 84) {
    return {
      angleDegrees: angleDeg,
      type: 'vertical',
      label: `Vertical (Plumb ${angleDeg.toFixed(1)}°)`,
    };
  } else {
    return {
      angleDegrees: angleDeg,
      type: 'sloped',
      label: `Slope (${angleDeg.toFixed(1)}°)`,
    };
  }
}

export function formatPoint(p: Point3D): string {
  return `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`;
}
