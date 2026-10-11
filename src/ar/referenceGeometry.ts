import * as THREE from 'three';
import { euclideanDistance, type Point3D } from '../utils/distance';
import {
  computeCameraRay,
  deriveIntrinsicsFromMatrix,
  intersectRayWithPlane,
} from './waistbandGeometry';
import type {
  CameraIntrinsicsData,
  CameraPoseData,
  TrouserPlaneData,
  WaistbandLandmarks,
} from './captureTypes';
import { detectGarmentLandmarks } from '../utils/garmentApi';

export interface PixelPoint {
  u: number;
  v: number;
}

export interface WorldDisplacement {
  dx: number;
  dy: number;
  dz: number;
  magnitudeMeters: number;
}

export type AutoMeasurementMethod =
  | 'garment-boundary-hrnet'
  | 'garment-boundary-synthetic'
  | 'unavailable';

export interface AutoXMeasurementResult {
  /** Leftmost horizontal boundary in original image pixel coordinates (origin top-left) */
  leftmostPixelX: number | null;
  /** Rightmost horizontal boundary in original image pixel coordinates (origin top-left) */
  rightmostPixelX: number | null;
  /** fullXPixelDistance = rightmostPixelX - leftmostPixelX */
  fullXPixelDistance: number | null;
  /** Vertical coordinates of the boundary landmarks for ray projection */
  leftmostPixelPoint: PixelPoint | null;
  rightmostPixelPoint: PixelPoint | null;
  /** Leftmost boundary in 3D world space */
  leftmostWorldPoint: Point3D | null;
  /** Rightmost boundary in 3D world space */
  rightmostWorldPoint: Point3D | null;
  /** Real-world Euclidean distance between leftmost and rightmost world points in metres */
  fullXDistanceMeters: number | null;
  /** Displacement vector in world space */
  displacementWorld: WorldDisplacement | null;
  imageWidth: number;
  imageHeight: number;
  valid: boolean;
  method: AutoMeasurementMethod;
  detectionSource: string | null;
  measurementAreaDefinition: string;
  warnings: string[];
}

/**
 * Derives camera tilt angle relative to plane normal and emits perspective warnings.
 */
function tiltWarningDeg(
  pose: CameraPoseData,
  plane: TrouserPlaneData
): { tiltAngleDeg: number; warnings: string[] } {
  const warnings: string[] = [];
  const camQuat = new THREE.Quaternion(
    pose.quaternion.x,
    pose.quaternion.y,
    pose.quaternion.z,
    pose.quaternion.w
  );
  const opticalAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat).normalize();
  const planeNorm = new THREE.Vector3(
    plane.planeNormal!.x,
    plane.planeNormal!.y,
    plane.planeNormal!.z
  ).normalize();
  const cosTilt = Math.abs(opticalAxis.dot(planeNorm));
  const tiltAngleDeg = Math.acos(Math.min(1, Math.max(0, cosTilt))) * (180 / Math.PI);

  if (tiltAngleDeg > 55) {
    warnings.push(
      `Camera is tilted ${tiltAngleDeg.toFixed(1)}° from surface normal. High perspective foreshortening may reduce planar boundary accuracy.`
    );
  }
  if (plane.planeSource === 'webxr-hittest') {
    warnings.push(
      'Reference plane derived from AR hit-test. Ensure the detected garment rests flat on this surface.'
    );
  }
  return { tiltAngleDeg, warnings };
}

/**
 * Computes the automatic horizontal X-distance across the garment/measurement boundary.
 *
 * 1. Pixel distance:
 *    leftmostPixelX = min(u_left, u_right)
 *    rightmostPixelX = max(u_left, u_right)
 *    fullXPixelDistance = rightmostPixelX - leftmostPixelX
 *
 * 2. World-space distance:
 *    Projects camera rays through leftmost and rightmost boundary points,
 *    intersects with detected physical AR surface plane,
 *    calculates real-world Euclidean distance in metres.
 *
 * 3. Strict physical scene validation:
 *    If boundaries cannot be identified in the physical scene, returns null with explanation.
 *    Never assumes whole image width represents physical object width.
 */
export function computeAutoXMeasurement(params: {
  landmarks: WaistbandLandmarks | null;
  imageWidth: number;
  imageHeight: number;
  pose: CameraPoseData | null;
  intrinsics: CameraIntrinsicsData | null;
  plane: TrouserPlaneData | null;
  trackingValid: boolean;
}): AutoXMeasurementResult {
  const warnings: string[] = [];
  const imageWidth = params.imageWidth;
  const imageHeight = params.imageHeight;

  // 1. Boundary identification check
  if (!params.landmarks || !params.landmarks.landmarksValid) {
    return {
      leftmostPixelX: null,
      rightmostPixelX: null,
      fullXPixelDistance: null,
      leftmostPixelPoint: null,
      rightmostPixelPoint: null,
      leftmostWorldPoint: null,
      rightmostWorldPoint: null,
      fullXDistanceMeters: null,
      displacementWorld: null,
      imageWidth,
      imageHeight,
      valid: false,
      method: 'unavailable',
      detectionSource: null,
      measurementAreaDefinition:
        'Automatic physical garment boundary across flat waistband edges.',
      warnings: [
        'Physical boundaries could not be identified automatically in this frame. Generic floor-plane extent is insufficient without distinct target garment boundaries.',
      ],
    };
  }

  const pA = params.landmarks.waistLeft;
  const pB = params.landmarks.waistRight;

  // Order boundary endpoints horizontally: leftmost is smaller u, rightmost is larger u
  const isALeft = pA.u <= pB.u;
  const leftPoint: PixelPoint = isALeft ? { u: pA.u, v: pA.v } : { u: pB.u, v: pB.v };
  const rightPoint: PixelPoint = isALeft ? { u: pB.u, v: pB.v } : { u: pA.u, v: pA.v };

  const leftmostPixelX = leftPoint.u;
  const rightmostPixelX = rightPoint.u;
  const fullXPixelDistance = rightmostPixelX - leftmostPixelX;

  const method: AutoMeasurementMethod =
    params.landmarks.landmarkSource === 'hrnet-ai'
      ? 'garment-boundary-hrnet'
      : 'garment-boundary-synthetic';

  // 2. Camera pose & intrinsics check
  if (
    !params.pose ||
    !params.intrinsics ||
    params.intrinsics.fx_pixels === null ||
    params.intrinsics.fy_pixels === null ||
    params.intrinsics.cx_pixels === null ||
    params.intrinsics.cy_pixels === null
  ) {
    warnings.push(
      'Real-world distance unavailable: camera pose or optical intrinsics are missing.'
    );
    return {
      leftmostPixelX,
      rightmostPixelX,
      fullXPixelDistance,
      leftmostPixelPoint: leftPoint,
      rightmostPixelPoint: rightPoint,
      leftmostWorldPoint: null,
      rightmostWorldPoint: null,
      fullXDistanceMeters: null,
      displacementWorld: null,
      imageWidth,
      imageHeight,
      valid: false,
      method: 'unavailable',
      detectionSource: params.landmarks.landmarkSource,
      measurementAreaDefinition:
        'Automatic physical garment boundary across flat waistband edges.',
      warnings,
    };
  }

  // 3. AR Plane geometry check
  if (
    !params.plane?.planeTrackingValid ||
    !params.plane.planePosition ||
    !params.plane.planeNormal
  ) {
    warnings.push(
      'Real-world distance unavailable: no valid physical AR plane tracked at capture time.'
    );
    return {
      leftmostPixelX,
      rightmostPixelX,
      fullXPixelDistance,
      leftmostPixelPoint: leftPoint,
      rightmostPixelPoint: rightPoint,
      leftmostWorldPoint: null,
      rightmostWorldPoint: null,
      fullXDistanceMeters: null,
      displacementWorld: null,
      imageWidth,
      imageHeight,
      valid: false,
      method: 'unavailable',
      detectionSource: params.landmarks.landmarkSource,
      measurementAreaDefinition:
        'Automatic physical garment boundary across flat waistband edges.',
      warnings,
    };
  }

  const ik = {
    fx_pixels: params.intrinsics.fx_pixels,
    fy_pixels: params.intrinsics.fy_pixels,
    cx_pixels: params.intrinsics.cx_pixels,
    cy_pixels: params.intrinsics.cy_pixels,
  };

  // 4. Construct camera rays
  const rayLeft = computeCameraRay(
    leftPoint.u,
    leftPoint.v,
    ik,
    params.pose.position,
    params.pose.quaternion
  );
  const rayRight = computeCameraRay(
    rightPoint.u,
    rightPoint.v,
    ik,
    params.pose.position,
    params.pose.quaternion
  );

  if (!rayLeft || !rayRight) {
    warnings.push('Could not construct 3D camera rays from detected boundary pixels.');
    return {
      leftmostPixelX,
      rightmostPixelX,
      fullXPixelDistance,
      leftmostPixelPoint: leftPoint,
      rightmostPixelPoint: rightPoint,
      leftmostWorldPoint: null,
      rightmostWorldPoint: null,
      fullXDistanceMeters: null,
      displacementWorld: null,
      imageWidth,
      imageHeight,
      valid: false,
      method,
      detectionSource: params.landmarks.landmarkSource,
      measurementAreaDefinition:
        'Automatic physical garment boundary across flat waistband edges.',
      warnings,
    };
  }

  // 5. Intersect rays with AR plane
  const interLeft = intersectRayWithPlane(
    rayLeft,
    params.plane.planePosition,
    params.plane.planeNormal
  );
  const interRight = intersectRayWithPlane(
    rayRight,
    params.plane.planePosition,
    params.plane.planeNormal
  );

  if (!interLeft.valid || !interLeft.point) {
    warnings.push(`Leftmost boundary: ${interLeft.warning ?? 'ray–plane intersection failed'}`);
  }
  if (!interRight.valid || !interRight.point) {
    warnings.push(`Rightmost boundary: ${interRight.warning ?? 'ray–plane intersection failed'}`);
  }

  if (!interLeft.valid || !interLeft.point || !interRight.valid || !interRight.point) {
    return {
      leftmostPixelX,
      rightmostPixelX,
      fullXPixelDistance,
      leftmostPixelPoint: leftPoint,
      rightmostPixelPoint: rightPoint,
      leftmostWorldPoint: null,
      rightmostWorldPoint: null,
      fullXDistanceMeters: null,
      displacementWorld: null,
      imageWidth,
      imageHeight,
      valid: false,
      method,
      detectionSource: params.landmarks.landmarkSource,
      measurementAreaDefinition:
        'Automatic physical garment boundary across flat waistband edges.',
      warnings,
    };
  }

  const leftmostWorldPoint: Point3D = interLeft.point;
  const rightmostWorldPoint: Point3D = interRight.point;

  // 6. Real-world Euclidean distance between corresponding 3D boundaries
  const fullXDistanceMeters = euclideanDistance(leftmostWorldPoint, rightmostWorldPoint);
  const dx = rightmostWorldPoint.x - leftmostWorldPoint.x;
  const dy = rightmostWorldPoint.y - leftmostWorldPoint.y;
  const dz = rightmostWorldPoint.z - leftmostWorldPoint.z;

  const tilt = tiltWarningDeg(params.pose, params.plane);
  warnings.push(...tilt.warnings);

  if (params.intrinsics.intrinsicsSource === 'fov-derived') {
    warnings.push('Camera intrinsics estimated from sensor FOV, not factory WebXR calibration.');
  }

  return {
    leftmostPixelX,
    rightmostPixelX,
    fullXPixelDistance,
    leftmostPixelPoint: leftPoint,
    rightmostPixelPoint: rightPoint,
    leftmostWorldPoint,
    rightmostWorldPoint,
    fullXDistanceMeters,
    displacementWorld: {
      dx,
      dy,
      dz,
      magnitudeMeters: fullXDistanceMeters,
    },
    imageWidth,
    imageHeight,
    valid: true,
    method,
    detectionSource: params.landmarks.landmarkSource,
    measurementAreaDefinition:
      'Automatic physical garment boundary across flat waistband edges.',
    warnings,
  };
}

/**
 * Asynchronously detects physical garment boundaries on the captured frame.
 * Calls HRNet backend if available, or extracts pre-detected simulator boundaries.
 */
export async function detectAutomaticBoundaries(
  imageDataUrl: string,
  imageWidth: number,
  imageHeight: number,
  existingLandmarks?: WaistbandLandmarks | null
): Promise<WaistbandLandmarks | null> {
  // If pre-calibrated boundaries exist (e.g. from simulator frame)
  if (existingLandmarks && existingLandmarks.landmarksValid) {
    return existingLandmarks;
  }

  if (!imageDataUrl || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  // Attempt real AI boundary detection using HRNet service with fast 1.5s timeout
  try {
    const res = await detectGarmentLandmarks(imageDataUrl, { timeoutMs: 1500 });
    if (res.success && res.landmarks?.waist_left && res.landmarks?.waist_right) {
      const uL = res.landmarks.waist_left.pixel_x ?? res.landmarks.waist_left.x * imageWidth;
      const vL = res.landmarks.waist_left.pixel_y ?? res.landmarks.waist_left.y * imageHeight;
      const uR = res.landmarks.waist_right.pixel_x ?? res.landmarks.waist_right.x * imageWidth;
      const vR = res.landmarks.waist_right.pixel_y ?? res.landmarks.waist_right.y * imageHeight;

      return {
        waistLeft: { u: Math.min(Math.max(uL, 0), imageWidth), v: Math.min(Math.max(vL, 0), imageHeight) },
        waistRight: { u: Math.min(Math.max(uR, 0), imageWidth), v: Math.min(Math.max(vR, 0), imageHeight) },
        landmarkSource: 'hrnet-ai',
        landmarksValid: true,
      };
    }
  } catch (err) {
    console.warn('[AutoBoundary] HRNet inference service not reachable:', err);
  }

  return null;
}

/** Position of an image pixel within an object-fit: contain layout box (0–1 relative to container). */
export function mapImagePointToContainerFraction(
  u: number,
  v: number,
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): { left: number; top: number } | null {
  if (imageWidth <= 0 || imageHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }
  const imgAspect = imageWidth / imageHeight;
  const boxAspect = containerWidth / containerHeight;

  let renderedW: number;
  let renderedH: number;
  let offsetX: number;
  let offsetY: number;

  if (imgAspect > boxAspect) {
    renderedW = containerWidth;
    renderedH = containerWidth / imgAspect;
    offsetX = 0;
    offsetY = (containerHeight - renderedH) / 2;
  } else {
    renderedH = containerHeight;
    renderedW = containerHeight * imgAspect;
    offsetX = (containerWidth - renderedW) / 2;
    offsetY = 0;
  }

  const localX = (u / imageWidth) * renderedW;
  const localY = (v / imageHeight) * renderedH;

  return {
    left: (offsetX + localX) / containerWidth,
    top: (offsetY + localY) / containerHeight,
  };
}

/** Scale intrinsics derived for one resolution to another (uniform scale per axis). */
export function scaleIntrinsicsToResolution(
  intrinsics: {
    fx_pixels: number;
    fy_pixels: number;
    cx_pixels: number;
    cy_pixels: number;
  },
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number
): { fx_pixels: number; fy_pixels: number; cx_pixels: number; cy_pixels: number } {
  const sx = toWidth / fromWidth;
  const sy = toHeight / fromHeight;
  return {
    fx_pixels: intrinsics.fx_pixels * sx,
    fy_pixels: intrinsics.fy_pixels * sy,
    cx_pixels: intrinsics.cx_pixels * sx,
    cy_pixels: intrinsics.cy_pixels * sy,
  };
}

export function intrinsicsFromProjectionForImage(
  projectionMatrix: number[],
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number
): CameraIntrinsicsData | null {
  const base = deriveIntrinsicsFromMatrix(projectionMatrix, viewportWidth, viewportHeight);
  if (!base) return null;
  const scaled =
    viewportWidth === imageWidth && viewportHeight === imageHeight
      ? base
      : scaleIntrinsicsToResolution(base, viewportWidth, viewportHeight, imageWidth, imageHeight);

  return {
    fx_pixels: scaled.fx_pixels,
    fy_pixels: scaled.fy_pixels,
    cx_pixels: scaled.cx_pixels,
    cy_pixels: scaled.cy_pixels,
    imageWidth,
    imageHeight,
    projectionMatrix,
    intrinsicsSource: 'webxr-projection',
  };
}

export function createCaptureId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
