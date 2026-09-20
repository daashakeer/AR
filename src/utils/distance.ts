/**
 * 3D distance math using real-world coordinates from WebXR.
 * All distances are in METERS (WebXR coordinate system unit).
 * No screen pixels are involved.
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
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

export function formatPoint(p: Point3D): string {
  return `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`;
}
