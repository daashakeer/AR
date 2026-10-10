/**
 * waistbandGeometry.ts
 *
 * Implements rigorous 3D camera-ray construction, world transformation,
 * plane intersection, and tilt-corrected distance calculation for trouser waistband measurement.
 *
 * Mathematical Foundation:
 * 1. For a pixel (u, v) with origin at top-left:
 *      x_cam = (u - cx) / fx
 *      y_cam = -(v - cy) / fy   (inverting y since image v is top-down, camera Y is up)
 *      z_cam = -1.0             (camera looks down -Z in Three.js / OpenGL convention)
 *    Ray direction in camera space:
 *      d_cam = normalize(x_cam, y_cam, z_cam)
 *
 * 2. Ray direction in world space:
 *      d_world = cameraQuaternion * d_cam
 *      C_world = cameraPosition
 *
 * 3. Plane intersection parameter:
 *      t = dot(n, P - C) / dot(n, d_world)
 *    Intersection point:
 *      X = C + t * d_world
 *
 * 4. Waistband width:
 *      widthMeters = || X_left - X_right ||
 *      widthCm = widthMeters * 100
 *      widthInches = widthMeters / 0.0254
 */

import * as THREE from 'three';
import type {
  CameraPoseData,
  CameraIntrinsicsData,
  TrouserPlaneData,
  WaistbandLandmarks,
  WaistbandWidthResult,
} from './captureTypes';

export interface CameraRay {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number }; // unit vector in world space
}

export interface PlaneIntersectionResult {
  point: { x: number; y: number; z: number } | null;
  t: number | null;
  valid: boolean;
  warning?: string;
}

/**
 * Extracts calibrated focal lengths and principal point from a 4x4 column-major projection matrix.
 */
export function deriveIntrinsicsFromMatrix(
  projectionMatrix: number[],
  imageWidth: number,
  imageHeight: number
): { fx_pixels: number; fy_pixels: number; cx_pixels: number; cy_pixels: number } | null {
  if (!projectionMatrix || projectionMatrix.length < 16) return null;
  const m = projectionMatrix;
  if (m[0] <= 0 || m[5] <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;

  // In OpenGL / WebXR column-major projection:
  // m[0] = 2 * fx / W -> fx = m[0] * W / 2
  // m[5] = 2 * fy / H -> fy = m[5] * H / 2
  // m[8] = (2 * cx - W) / W -> cx = (m[8] + 1) * W / 2
  // m[9] = (H - 2 * cy) / H -> cy = (1 - m[9]) * H / 2 (accounting for top-left image origin)
  const fx_pixels = (m[0] * imageWidth) / 2;
  const fy_pixels = (m[5] * imageHeight) / 2;
  const cx_pixels = ((m[8] ?? 0) + 1) * (imageWidth / 2);
  const cy_pixels = (1 - (m[9] ?? 0)) * (imageHeight / 2);

  return { fx_pixels, fy_pixels, cx_pixels, cy_pixels };
}

/**
 * Constructs a world-space 3D ray from 2D pixel coordinates (u, v) and camera pose.
 */
export function computeCameraRay(
  u: number,
  v: number,
  intrinsics: { fx_pixels: number; fy_pixels: number; cx_pixels: number; cy_pixels: number },
  cameraPosition: { x: number; y: number; z: number },
  cameraQuaternion: { x: number; y: number; z: number; w: number }
): CameraRay | null {
  if (intrinsics.fx_pixels <= 0 || intrinsics.fy_pixels <= 0) return null;

  // 1. Ray in camera frame (Three.js/OpenGL: -Z forward, +X right, +Y up)
  // Pixel coordinates u, v have origin at top-left
  const x_cam = (u - intrinsics.cx_pixels) / intrinsics.fx_pixels;
  const y_cam = -(v - intrinsics.cy_pixels) / intrinsics.fy_pixels;
  const z_cam = -1.0;

  const len = Math.sqrt(x_cam * x_cam + y_cam * y_cam + 1.0);
  const dir_cam = new THREE.Vector3(x_cam / len, y_cam / len, z_cam / len);

  // 2. Transform ray direction to world space using camera orientation quaternion
  const q = new THREE.Quaternion(
    cameraQuaternion.x,
    cameraQuaternion.y,
    cameraQuaternion.z,
    cameraQuaternion.w
  );
  dir_cam.applyQuaternion(q).normalize();

  return {
    origin: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
    direction: { x: dir_cam.x, y: dir_cam.y, z: dir_cam.z },
  };
}

/**
 * Intersects a 3D ray with a detected plane.
 * Formula:
 *   t = dot(n, P - C) / dot(n, d)
 *   X = C + t * d
 */
export function intersectRayWithPlane(
  ray: CameraRay,
  planePosition: { x: number; y: number; z: number },
  planeNormal: { x: number; y: number; z: number }
): PlaneIntersectionResult {
  const d = new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z);
  const C = new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z);
  const P = new THREE.Vector3(planePosition.x, planePosition.y, planePosition.z);
  const n = new THREE.Vector3(planeNormal.x, planeNormal.y, planeNormal.z).normalize();

  // Denominator: dot(n, d)
  const denom = n.dot(d);

  // Check 1: nearly parallel ray (|dot(n, d)| < 1e-4) -> angle < 0.006 deg to plane
  if (Math.abs(denom) < 1e-4) {
    return {
      point: null,
      t: null,
      valid: false,
      warning: 'Ray is nearly parallel to the detected plane (glancing angle).',
    };
  }

  // Parameter t = dot(n, P - C) / dot(n, d)
  const toP = P.clone().sub(C);
  const t = toP.dot(n) / denom;

  // Check 2: intersection behind camera (t <= 0)
  if (t <= 0) {
    return {
      point: null,
      t,
      valid: false,
      warning: `Intersection lies behind camera (parameter t = ${t.toFixed(3)} <= 0).`,
    };
  }

  // Check 3: distance unreasonably large (> 50m)
  if (t > 50) {
    return {
      point: null,
      t,
      valid: false,
      warning: `Intersection distance exceeds realistic threshold (t = ${t.toFixed(1)}m > 50m).`,
    };
  }

  // Intersection point X = C + t * d
  const X = C.clone().add(d.clone().multiplyScalar(t));
  return {
    point: { x: X.x, y: X.y, z: X.z },
    t,
    valid: true,
  };
}

/**
 * Computes the tilt-corrected real-world waistband width from camera pose, intrinsics,
 * plane geometry, and 2D landmark coordinates.
 */
export function calculateTiltCorrectedWaistWidth(params: {
  pose: CameraPoseData | null;
  intrinsics: CameraIntrinsicsData | null;
  plane: TrouserPlaneData | null;
  landmarks: WaistbandLandmarks | null;
}): WaistbandWidthResult {
  const warnings: string[] = [];

  // Validation 1: Check landmarks
  if (!params.landmarks || !params.landmarks.landmarksValid) {
    return {
      waistWidthMeters: null,
      waistWidthCm: null,
      waistWidthInches: null,
      intersectionLeft: null,
      intersectionRight: null,
      tiltAngleDeg: null,
      measurementValid: false,
      measurementMethod: 'unavailable',
      measurementWarnings: ['Waistband landmarks not available or invalid.'],
      measurementStatus: 'unavailable',
    };
  }

  // Validation 2: Check pose
  if (!params.pose || !params.pose.position || !params.pose.quaternion) {
    return {
      waistWidthMeters: null,
      waistWidthCm: null,
      waistWidthInches: null,
      intersectionLeft: null,
      intersectionRight: null,
      tiltAngleDeg: null,
      measurementValid: false,
      measurementMethod: 'unavailable',
      measurementWarnings: ['Camera pose (position and orientation) is missing.'],
      measurementStatus: 'unavailable',
    };
  }

  // Validation 3: Check intrinsics
  if (
    !params.intrinsics ||
    params.intrinsics.fx_pixels === null ||
    params.intrinsics.fy_pixels === null ||
    params.intrinsics.cx_pixels === null ||
    params.intrinsics.cy_pixels === null
  ) {
    return {
      waistWidthMeters: null,
      waistWidthCm: null,
      waistWidthInches: null,
      intersectionLeft: null,
      intersectionRight: null,
      tiltAngleDeg: null,
      measurementValid: false,
      measurementMethod: 'unavailable',
      measurementWarnings: ['Camera intrinsics (focal length or principal point) are missing.'],
      measurementStatus: 'unavailable',
    };
  }

  // Validation 4: Check plane geometry
  if (
    !params.plane ||
    !params.plane.planePosition ||
    !params.plane.planeNormal ||
    !params.plane.planeTrackingValid
  ) {
    return {
      waistWidthMeters: null,
      waistWidthCm: null,
      waistWidthInches: null,
      intersectionLeft: null,
      intersectionRight: null,
      tiltAngleDeg: null,
      measurementValid: false,
      measurementMethod: 'unavailable',
      measurementWarnings: ['Detected surface plane is missing or tracking is invalid.'],
      measurementStatus: 'unavailable',
    };
  }

  // Calculate camera tilt angle relative to plane normal
  const camQuat = new THREE.Quaternion(
    params.pose.quaternion.x,
    params.pose.quaternion.y,
    params.pose.quaternion.z,
    params.pose.quaternion.w
  );
  // Optical axis points in camera -Z direction
  const opticalAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat).normalize();
  const planeNorm = new THREE.Vector3(
    params.plane.planeNormal.x,
    params.plane.planeNormal.y,
    params.plane.planeNormal.z
  ).normalize();

  // Angle between optical axis and -planeNormal (0 deg = looking straight down onto floor)
  const cosTilt = Math.abs(opticalAxis.dot(planeNorm));
  const tiltAngleDeg = Math.acos(Math.min(1.0, Math.max(0.0, cosTilt))) * (180 / Math.PI);

  if (tiltAngleDeg > 75) {
    warnings.push(
      `Extreme camera tilt (${tiltAngleDeg.toFixed(1)}° from normal). Keep camera between 15° and 60° for highest accuracy.`
    );
  }

  if (params.intrinsics.intrinsicsSource === 'fov-derived') {
    warnings.push('Camera intrinsics are estimated from sensor FOV, not factory WebXR calibration.');
  }

  if (params.plane.planeSource === 'floor-estimate') {
    warnings.push('Surface plane is an estimated floor level rather than an actively tracked hit-test plane.');
  }

  // Step 1: Compute camera rays for left and right waistband landmarks
  const rayLeft = computeCameraRay(
    params.landmarks.waistLeft.u,
    params.landmarks.waistLeft.v,
    {
      fx_pixels: params.intrinsics.fx_pixels,
      fy_pixels: params.intrinsics.fy_pixels,
      cx_pixels: params.intrinsics.cx_pixels,
      cy_pixels: params.intrinsics.cy_pixels,
    },
    params.pose.position,
    params.pose.quaternion
  );

  const rayRight = computeCameraRay(
    params.landmarks.waistRight.u,
    params.landmarks.waistRight.v,
    {
      fx_pixels: params.intrinsics.fx_pixels,
      fy_pixels: params.intrinsics.fy_pixels,
      cx_pixels: params.intrinsics.cx_pixels,
      cy_pixels: params.intrinsics.cy_pixels,
    },
    params.pose.position,
    params.pose.quaternion
  );

  if (!rayLeft || !rayRight) {
    return {
      waistWidthMeters: null,
      waistWidthCm: null,
      waistWidthInches: null,
      intersectionLeft: null,
      intersectionRight: null,
      tiltAngleDeg,
      measurementValid: false,
      measurementMethod: 'unavailable',
      measurementWarnings: ['Could not construct camera rays from landmark pixel coordinates.'],
      measurementStatus: 'unavailable',
    };
  }

  // Step 2: Intersect rays with the trouser surface plane
  const interLeft = intersectRayWithPlane(rayLeft, params.plane.planePosition, params.plane.planeNormal);
  const interRight = intersectRayWithPlane(rayRight, params.plane.planePosition, params.plane.planeNormal);

  if (!interLeft.valid || !interLeft.point) {
    warnings.push(`Left landmark ray failed: ${interLeft.warning || 'intersection invalid'}`);
  }
  if (!interRight.valid || !interRight.point) {
    warnings.push(`Right landmark ray failed: ${interRight.warning || 'intersection invalid'}`);
  }

  if (!interLeft.valid || !interLeft.point || !interRight.valid || !interRight.point) {
    return {
      waistWidthMeters: null,
      waistWidthCm: null,
      waistWidthInches: null,
      intersectionLeft: null,
      intersectionRight: null,
      tiltAngleDeg,
      measurementValid: false,
      measurementMethod: 'ray-plane-intersection',
      measurementWarnings: warnings,
      measurementStatus: 'unavailable',
    };
  }

  // Step 3: Calculate Euclidean distance between 3D intersection points
  const pL = new THREE.Vector3(interLeft.point.x, interLeft.point.y, interLeft.point.z);
  const pR = new THREE.Vector3(interRight.point.x, interRight.point.y, interRight.point.z);
  const waistWidthMeters = pL.distanceTo(pR);

  // Plausibility check for adult trousers (waist width between 0.15m and 1.50m)
  if (waistWidthMeters < 0.15 || waistWidthMeters > 1.50) {
    warnings.push(
      `Calculated waist width (${(waistWidthMeters * 100).toFixed(1)} cm) is outside typical trousers range (15–150 cm). Please verify framing.`
    );
  }

  const waistWidthCm = waistWidthMeters * 100;
  const waistWidthInches = waistWidthMeters / 0.0254;

  const isApproximate =
    params.intrinsics.intrinsicsSource === 'fov-derived' ||
    params.plane.planeSource === 'floor-estimate' ||
    tiltAngleDeg > 70;

  return {
    waistWidthMeters,
    waistWidthCm,
    waistWidthInches,
    intersectionLeft: interLeft.point,
    intersectionRight: interRight.point,
    tiltAngleDeg,
    measurementValid: true,
    measurementMethod: 'ray-plane-intersection',
    measurementWarnings: warnings,
    measurementStatus: isApproximate ? 'approximate' : 'valid',
  };
}
