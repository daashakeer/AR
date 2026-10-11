import type { CaptureResult } from './captureTypes';
import type { AutoXMeasurementResult, PixelPoint } from './referenceGeometry';
import type { Point3D } from '../utils/distance';

export const REFERENCE_EXPORT_SCHEMA = '1.0';

export interface ReferenceExportJson {
  schemaVersion: string;
  captureId: string;
  capturedAt: string;
  image: {
    filename: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  };
  cameraIntrinsics: {
    fx_pixels: number | null;
    fy_pixels: number | null;
    cx_pixels: number | null;
    cy_pixels: number | null;
    projectionMatrix: number[] | null;
    source: string | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
  };
  cameraPose: {
    positionWorld: { x: number; y: number; z: number } | null;
    quaternionWorld: { x: number; y: number; z: number; w: number } | null;
    cameraWorldMatrix: number[] | null;
    cameraViewMatrix: number[] | null;
    valid: boolean;
  };
  plane: {
    positionWorld: { x: number; y: number; z: number } | null;
    normalWorld: { x: number; y: number; z: number } | null;
    quaternionWorld: { x: number; y: number; z: number; w: number } | null;
    transform: number[] | null;
    source: string | null;
    valid: boolean;
  };
  automaticBoundaries: {
    leftmost: {
      pixelX: number | null;
      pixelPoint: PixelPoint | null;
      worldPoint: Point3D | null;
    };
    rightmost: {
      pixelX: number | null;
      pixelPoint: PixelPoint | null;
      worldPoint: Point3D | null;
    };
    measurementAreaDefinition: string;
    detectionSource: string | null;
  };
  measurements: {
    leftmostPixelX: number | null;
    rightmostPixelX: number | null;
    fullXPixelDistance: number | null;
    leftmostWorldPoint: Point3D | null;
    rightmostWorldPoint: Point3D | null;
    fullXDistanceMeters: number | null;
    displacementWorld: AutoXMeasurementResult['displacementWorld'];
    valid: boolean;
    method: string | null;
  };
  trackingValid: boolean;
  warnings: string[];
}

export function buildReferenceExportJson(params: {
  capture: CaptureResult;
  captureId: string;
  measurement: AutoXMeasurementResult;
}): ReferenceExportJson {
  const { capture, captureId, measurement } = params;
  const pose = capture.cameraPose;

  return {
    schemaVersion: REFERENCE_EXPORT_SCHEMA,
    captureId,
    capturedAt: capture.capturedAt,
    image: {
      filename: `slyte-reference-${captureId.slice(0, 8)}.jpg`,
      mimeType: 'image/jpeg',
      width: capture.imageWidth > 0 ? capture.imageWidth : null,
      height: capture.imageHeight > 0 ? capture.imageHeight : null,
    },
    cameraIntrinsics: {
      fx_pixels: capture.fx_pixels,
      fy_pixels: capture.fy_pixels,
      cx_pixels: capture.cx_pixels ?? null,
      cy_pixels: capture.cy_pixels ?? null,
      projectionMatrix: capture.projectionMatrix,
      source: capture.intrinsicsSource,
      viewportWidth: capture.xrViewportWidth ?? null,
      viewportHeight: capture.xrViewportHeight ?? null,
    },
    cameraPose: {
      positionWorld: pose?.position ?? null,
      quaternionWorld: pose?.quaternion ?? null,
      cameraWorldMatrix: pose?.cameraMatrix ?? null,
      cameraViewMatrix: pose?.cameraMatrixInverse ?? null,
      valid: Boolean(pose && capture.trackingValid),
    },
    plane: {
      positionWorld: capture.planePosition,
      normalWorld: capture.planeNormal,
      quaternionWorld: capture.planeQuaternion ?? null,
      transform: capture.planeTransform ?? null,
      source: capture.planeSource,
      valid: capture.planeTrackingValid,
    },
    automaticBoundaries: {
      leftmost: {
        pixelX: measurement.leftmostPixelX,
        pixelPoint: measurement.leftmostPixelPoint,
        worldPoint: measurement.leftmostWorldPoint,
      },
      rightmost: {
        pixelX: measurement.rightmostPixelX,
        pixelPoint: measurement.rightmostPixelPoint,
        worldPoint: measurement.rightmostWorldPoint,
      },
      measurementAreaDefinition: measurement.measurementAreaDefinition,
      detectionSource: measurement.detectionSource,
    },
    measurements: {
      leftmostPixelX: measurement.leftmostPixelX,
      rightmostPixelX: measurement.rightmostPixelX,
      fullXPixelDistance: measurement.fullXPixelDistance,
      leftmostWorldPoint: measurement.leftmostWorldPoint,
      rightmostWorldPoint: measurement.rightmostWorldPoint,
      fullXDistanceMeters: measurement.fullXDistanceMeters,
      displacementWorld: measurement.displacementWorld,
      valid: measurement.valid,
      method: measurement.valid ? measurement.method : null,
    },
    trackingValid: capture.trackingValid,
    warnings: [...measurement.warnings],
  };
}
