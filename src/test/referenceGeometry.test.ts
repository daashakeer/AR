import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAutoXMeasurement,
  scaleIntrinsicsToResolution,
  intrinsicsFromProjectionForImage,
  mapImagePointToContainerFraction,
} from '../ar/referenceGeometry.ts';
import { buildReferenceExportJson, REFERENCE_EXPORT_SCHEMA } from '../ar/referenceExport.ts';
import type { CaptureResult } from '../ar/captureTypes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Automatic Pixel Distance & Boundaries
// ─────────────────────────────────────────────────────────────────────────────

test('computeAutoXMeasurement — horizontal pixel boundaries and distance', () => {
  const r = computeAutoXMeasurement({
    landmarks: {
      waistLeft: { u: 240, v: 540 },
      waistRight: { u: 780, v: 540 },
      landmarkSource: 'hrnet-ai',
      landmarksValid: true,
    },
    imageWidth: 1920,
    imageHeight: 1080,
    pose: null,
    intrinsics: null,
    plane: null,
    trackingValid: false,
  });

  assert.equal(r.leftmostPixelX, 240);
  assert.equal(r.rightmostPixelX, 780);
  assert.equal(r.fullXPixelDistance, 540);
  assert.equal(r.fullXDistanceMeters, null);
  assert.equal(r.valid, false);
});

test('computeAutoXMeasurement — orders leftmost and rightmost regardless of landmark naming', () => {
  // If landmarks are reversed in image u coordinate
  const r = computeAutoXMeasurement({
    landmarks: {
      waistLeft: { u: 920, v: 480 },
      waistRight: { u: 310, v: 480 },
      landmarkSource: 'test-synthetic',
      landmarksValid: true,
    },
    imageWidth: 1920,
    imageHeight: 1080,
    pose: null,
    intrinsics: null,
    plane: null,
    trackingValid: false,
  });

  assert.equal(r.leftmostPixelX, 310);
  assert.equal(r.rightmostPixelX, 920);
  assert.equal(r.fullXPixelDistance, 610);
});

test('computeAutoXMeasurement — returns null when physical boundaries are unidentified (never assumes full image width)', () => {
  const r = computeAutoXMeasurement({
    landmarks: null, // No boundaries detected in scene
    imageWidth: 1920,
    imageHeight: 1080,
    pose: {
      position: { x: 0, y: 1.5, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      cameraMatrix: [],
      cameraMatrixInverse: [],
    },
    intrinsics: {
      fx_pixels: 1450,
      fy_pixels: 1450,
      cx_pixels: 960,
      cy_pixels: 540,
      imageWidth: 1920,
      imageHeight: 1080,
      projectionMatrix: null,
      intrinsicsSource: 'webxr-projection',
    },
    plane: {
      planePosition: { x: 0, y: 0, z: -2 },
      planeNormal: { x: 0, y: 1, z: 0 },
      planeQuaternion: { x: 0, y: 0, z: 0, w: 1 },
      planeTransform: null,
      planeSource: 'webxr-hittest',
      planeTrackingValid: true,
    },
    trackingValid: true,
  });

  assert.equal(r.leftmostPixelX, null);
  assert.equal(r.rightmostPixelX, null);
  assert.equal(r.fullXPixelDistance, null);
  assert.equal(r.fullXDistanceMeters, null);
  assert.equal(r.valid, false);
  assert.ok(
    r.warnings.some((w) => w.toLowerCase().includes('boundaries')),
    'Must explain why boundaries were not identifiable'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Real-world X-Distance & Geometry
// ─────────────────────────────────────────────────────────────────────────────

test('computeAutoXMeasurement — calculates true real-world X distance between physical boundaries', () => {
  const r = computeAutoXMeasurement({
    landmarks: {
      waistLeft: { u: 400, v: 540 },
      waistRight: { u: 600, v: 540 },
      landmarkSource: 'hrnet-ai',
      landmarksValid: true,
    },
    imageWidth: 1920,
    imageHeight: 1080,
    pose: {
      position: { x: 0, y: 1.5, z: 0 },
      quaternion: { x: -0.383, y: 0, z: 0, w: 0.924 },
      cameraMatrix: [],
      cameraMatrixInverse: [],
    },
    intrinsics: {
      fx_pixels: 1450,
      fy_pixels: 1450,
      cx_pixels: 960,
      cy_pixels: 540,
      imageWidth: 1920,
      imageHeight: 1080,
      projectionMatrix: null,
      intrinsicsSource: 'webxr-projection',
    },
    plane: {
      planePosition: { x: 0, y: 0, z: -2 },
      planeNormal: { x: 0, y: 1, z: 0 },
      planeQuaternion: { x: 0, y: 0, z: 0, w: 1 },
      planeTransform: null,
      planeSource: 'webxr-hittest',
      planeTrackingValid: true,
    },
    trackingValid: true,
  });

  assert.equal(r.valid, true);
  assert.equal(r.fullXPixelDistance, 200);
  assert.ok(r.fullXDistanceMeters !== null);
  assert.ok(r.fullXDistanceMeters! > 0);
  assert.ok(r.leftmostWorldPoint !== null);
  assert.ok(r.rightmostWorldPoint !== null);
  assert.ok(r.displacementWorld !== null);
  assert.equal(r.method, 'garment-boundary-hrnet');
});

test('computeAutoXMeasurement — rejects world distance when plane tracking is invalid', () => {
  const r = computeAutoXMeasurement({
    landmarks: {
      waistLeft: { u: 400, v: 540 },
      waistRight: { u: 600, v: 540 },
      landmarkSource: 'hrnet-ai',
      landmarksValid: true,
    },
    imageWidth: 1920,
    imageHeight: 1080,
    pose: {
      position: { x: 0, y: 1.5, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      cameraMatrix: [],
      cameraMatrixInverse: [],
    },
    intrinsics: {
      fx_pixels: 1450,
      fy_pixels: 1450,
      cx_pixels: 960,
      cy_pixels: 540,
      imageWidth: 1920,
      imageHeight: 1080,
      projectionMatrix: null,
      intrinsicsSource: 'webxr-projection',
    },
    plane: null,
    trackingValid: false,
  });

  assert.equal(r.fullXPixelDistance, 200);
  assert.equal(r.fullXDistanceMeters, null);
  assert.equal(r.valid, false);
  assert.ok(r.warnings.some((w) => w.toLowerCase().includes('plane')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Intrinsics & Coordinate Utilities
// ─────────────────────────────────────────────────────────────────────────────

test('scaleIntrinsicsToResolution — doubles fx/cx when resolution doubles', () => {
  const scaled = scaleIntrinsicsToResolution(
    { fx_pixels: 1000, fy_pixels: 1000, cx_pixels: 960, cy_pixels: 540 },
    1920,
    1080,
    3840,
    2160
  );
  assert.ok(Math.abs(scaled.fx_pixels - 2000) < 1e-6);
  assert.ok(Math.abs(scaled.cx_pixels - 1920) < 1e-6);
});

test('intrinsicsFromProjectionForImage — derives and scales focal length', () => {
  const W = 1920;
  const H = 1080;
  const m = new Array(16).fill(0);
  m[0] = (2 * 1450) / W;
  m[5] = (2 * 1450) / H;
  m[10] = -1.002;
  m[11] = -1;
  m[14] = -0.2;
  const bundle = intrinsicsFromProjectionForImage(m, W, H, 3840, 2160);
  assert.ok(bundle);
  assert.ok(Math.abs(bundle!.fx_pixels - 2900) < 1);
  assert.equal(bundle!.intrinsicsSource, 'webxr-projection');
});

test('mapImagePointToContainerFraction inverts contain mapping — centre', () => {
  const frac = mapImagePointToContainerFraction(400, 200, 800, 400, 400, 400);
  assert.ok(frac);
  assert.ok(Math.abs(frac!.left - 0.5) < 0.02);
  assert.ok(Math.abs(frac!.top - 0.5) < 0.02);
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON Export Schema
// ─────────────────────────────────────────────────────────────────────────────

test('buildReferenceExportJson — automatic boundaries schema version and structure', () => {
  const capture: CaptureResult = {
    captureId: 'auto-cap-12345',
    imageCaptureSource: 'image-capture',
    imageDataUrl: '',
    imageWidth: 1920,
    imageHeight: 1080,
    Z_m: 1.2,
    distanceSource: 'webxr-hittest',
    distanceValid: true,
    distanceDefinition: 'perpendicular-camera-to-plane',
    fx_pixels: 1450,
    fy_pixels: 1450,
    cx_pixels: 960,
    cy_pixels: 540,
    intrinsicsSource: 'webxr-projection',
    cameraPose: null,
    planePosition: null,
    planeNormal: null,
    planeQuaternion: null,
    planeTransform: null,
    planeSource: null,
    planeTrackingValid: false,
    projectionMatrix: null,
    capturedAt: new Date().toISOString(),
    trackingValid: false,
    reliabilityNote: '',
  };

  const json = buildReferenceExportJson({
    capture,
    captureId: 'auto-cap-12345',
    measurement: {
      leftmostPixelX: 420,
      rightmostPixelX: 860,
      fullXPixelDistance: 440,
      leftmostPixelPoint: { u: 420, v: 540 },
      rightmostPixelPoint: { u: 860, v: 540 },
      leftmostWorldPoint: { x: -0.2, y: 0, z: -1 },
      rightmostWorldPoint: { x: 0.2, y: 0, z: -1 },
      fullXDistanceMeters: 0.4,
      displacementWorld: { dx: 0.4, dy: 0, dz: 0, magnitudeMeters: 0.4 },
      imageWidth: 1920,
      imageHeight: 1080,
      valid: true,
      method: 'garment-boundary-hrnet',
      detectionSource: 'hrnet-ai',
      measurementAreaDefinition: 'Automatic physical garment boundary across flat waistband edges.',
      warnings: [],
    },
  });

  assert.equal(json.schemaVersion, REFERENCE_EXPORT_SCHEMA);
  assert.equal(json.captureId, 'auto-cap-12345');
  assert.equal(json.measurements.leftmostPixelX, 420);
  assert.equal(json.measurements.rightmostPixelX, 860);
  assert.equal(json.measurements.fullXPixelDistance, 440);
  assert.equal(json.measurements.fullXDistanceMeters, 0.4);
  assert.equal(json.measurements.valid, true);
  assert.equal(json.automaticBoundaries.leftmost.pixelX, 420);
  assert.equal(json.automaticBoundaries.rightmost.pixelX, 860);
  assert.ok(json.image.filename.includes('auto-cap'));
});
