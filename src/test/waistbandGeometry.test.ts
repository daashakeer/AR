import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  deriveIntrinsicsFromMatrix,
  computeCameraRay,
  intersectRayWithPlane,
  calculateTiltCorrectedWaistWidth,
} from '../ar/waistbandGeometry.ts';

test('1. deriveIntrinsicsFromMatrix extracts fx, fy, cx, cy correctly', () => {
  const W = 1920;
  const H = 1080;
  const fx_expected = 1450.0;
  const fy_expected = 1450.0;
  const cx_expected = 960.0;
  const cy_expected = 540.0;

  // OpenGL projection matrix:
  // m[0] = 2 * fx / W
  // m[5] = 2 * fy / H
  // m[8] = (2 * cx - W) / W = 0
  // m[9] = (H - 2 * cy) / H = 0
  const m = new Array(16).fill(0);
  m[0] = (2 * fx_expected) / W;
  m[5] = (2 * fy_expected) / H;
  m[8] = 0;
  m[9] = 0;
  m[10] = -1.002;
  m[11] = -1.0;
  m[14] = -0.2;

  const intrinsics = deriveIntrinsicsFromMatrix(m, W, H);
  assert.ok(intrinsics !== null);
  assert.ok(Math.abs(intrinsics.fx_pixels - fx_expected) < 1e-3);
  assert.ok(Math.abs(intrinsics.fy_pixels - fy_expected) < 1e-3);
  assert.ok(Math.abs(intrinsics.cx_pixels - cx_expected) < 1e-3);
  assert.ok(Math.abs(intrinsics.cy_pixels - cy_expected) < 1e-3);
});

test('2. computeCameraRay generates correct 3D ray direction in world space', () => {
  const W = 1920;
  const H = 1080;
  const intrinsics = {
    fx_pixels: 1000,
    fy_pixels: 1000,
    cx_pixels: 960,
    cy_pixels: 540,
  };
  const cameraPosition = { x: 0, y: 1.0, z: 0 };
  // Identity rotation: camera looks down -Z, +X right, +Y up
  const cameraQuaternion = { x: 0, y: 0, z: 0, w: 1 };

  // Center pixel (960, 540) -> should shoot directly down -Z
  const centerRay = computeCameraRay(960, 540, intrinsics, cameraPosition, cameraQuaternion);
  assert.ok(centerRay !== null);
  assert.ok(Math.abs(centerRay.direction.x) < 1e-5);
  assert.ok(Math.abs(centerRay.direction.y) < 1e-5);
  assert.ok(Math.abs(centerRay.direction.z - (-1)) < 1e-5);

  // Right pixel (1960, 540): u - cx = +1000 -> x_cam = 1, z_cam = -1 -> normalized [1/sqrt(2), 0, -1/sqrt(2)]
  const rightRay = computeCameraRay(1960, 540, intrinsics, cameraPosition, cameraQuaternion);
  assert.ok(rightRay !== null);
  assert.ok(Math.abs(rightRay.direction.x - Math.SQRT1_2) < 1e-5);
  assert.ok(Math.abs(rightRay.direction.z - (-Math.SQRT1_2)) < 1e-5);
});

test('3. intersectRayWithPlane calculates exact intersection point', () => {
  // Ray origin at (0, 1.0, 0) pointing directly down (0, -1, 0)
  const ray = {
    origin: { x: 0, y: 1.0, z: 0 },
    direction: { x: 0, y: -1.0, z: 0 },
  };
  // Horizontal plane at Y = 0 with normal (0, 1, 0)
  const planePos = { x: 0, y: 0, z: 0 };
  const planeNorm = { x: 0, y: 1, z: 0 };

  const result = intersectRayWithPlane(ray, planePos, planeNorm);
  assert.ok(result.valid);
  assert.ok(result.point !== null);
  assert.ok(Math.abs(result.point.x) < 1e-5);
  assert.ok(Math.abs(result.point.y) < 1e-5);
  assert.ok(Math.abs(result.point.z) < 1e-5);
  assert.ok(Math.abs(result.t! - 1.0) < 1e-5);
});

test('4. intersectRayWithPlane rejects parallel ray and ray pointing away', () => {
  const planePos = { x: 0, y: 0, z: 0 };
  const planeNorm = { x: 0, y: 1, z: 0 };

  // Parallel ray: pointing along +X (dot(n, d) == 0)
  const parallelRay = {
    origin: { x: 0, y: 1.0, z: 0 },
    direction: { x: 1.0, y: 0, z: 0 },
  };
  const parallelRes = intersectRayWithPlane(parallelRay, planePos, planeNorm);
  assert.equal(parallelRes.valid, false);

  // Ray pointing upwards (+Y): plane is at Y=0, so t < 0 (behind camera)
  const awayRay = {
    origin: { x: 0, y: 1.0, z: 0 },
    direction: { x: 0, y: 1.0, z: 0 },
  };
  const awayRes = intersectRayWithPlane(awayRay, planePos, planeNorm);
  assert.equal(awayRes.valid, false);
});

test('5. calculateTiltCorrectedWaistWidth computes true physical width across flat surface', () => {
  // Scenario: Camera placed at (0, 0.50m, 0) looking straight down onto floor Y = 0.
  // Focal length fx = fy = 1000px, image 1920x1080, cx = 960, cy = 540.
  // Pants lying flat on floor Y = 0.
  // True waist width = 0.40 m (40.0 cm).
  // Left waist point at X = -0.20m, right waist point at X = +0.20m.
  // At distance Z = 0.50m:
  // u_left = cx + fx * (X / Z) = 960 + 1000 * (-0.20 / 0.50) = 960 - 400 = 560
  // u_right = cx + fx * (X / Z) = 960 + 1000 * (+0.20 / 0.50) = 960 + 400 = 1360
  // Both at v = 540 (middle horizontal line).

  // Camera pointing straight down: pitch -90 degrees around X axis
  // Three.js: -Z is camera look direction. To look down (-Y in world), rotate around X by -90 deg.
  const euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(euler);

  const pose = {
    position: { x: 0, y: 0.50, z: 0 },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    cameraMatrix: [],
    cameraMatrixInverse: [],
  };

  const intrinsics = {
    fx_pixels: 1000,
    fy_pixels: 1000,
    cx_pixels: 960,
    cy_pixels: 540,
    imageWidth: 1920,
    imageHeight: 1080,
    projectionMatrix: [],
    intrinsicsSource: 'webxr-projection' as const,
  };

  const plane = {
    planePosition: { x: 0, y: 0, z: 0 },
    planeNormal: { x: 0, y: 1.0, z: 0 }, // normal pointing straight up
    planeQuaternion: { x: 0, y: 0, z: 0, w: 1 },
    planeTransform: [],
    planeSource: 'webxr-hittest' as const,
    planeTrackingValid: true,
  };

  const landmarks = {
    waistLeft: { u: 560, v: 540 },
    waistRight: { u: 1360, v: 540 },
    landmarkSource: 'hrnet-ai' as const,
    landmarksValid: true,
  };

  const result = calculateTiltCorrectedWaistWidth({
    pose,
    intrinsics,
    plane,
    landmarks,
  });

  assert.equal(result.measurementValid, true);
  assert.equal(result.measurementStatus, 'valid');
  assert.ok(result.waistWidthMeters !== null);
  // Verify 40.0 cm width with high numerical precision
  assert.ok(Math.abs(result.waistWidthCm! - 40.0) < 0.05, `Expected 40.0 cm, got ${result.waistWidthCm}`);
  assert.ok(Math.abs(result.waistWidthInches! - (40.0 / 2.54)) < 0.05);
  // Tilt should be ~0 deg (straight down)
  assert.ok(Math.abs(result.tiltAngleDeg! - 0) < 1.0);
});

test('6. calculateTiltCorrectedWaistWidth warns on extreme tilt > 75 degrees', () => {
  // Rotate camera almost parallel to floor (tilt 80 deg)
  const euler = new THREE.Euler(-Math.PI / 2 + (80 * Math.PI / 180), 0, 0, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(euler);

  const pose = {
    position: { x: 0, y: 1.0, z: 0 },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    cameraMatrix: [],
    cameraMatrixInverse: [],
  };

  const intrinsics = {
    fx_pixels: 1000,
    fy_pixels: 1000,
    cx_pixels: 960,
    cy_pixels: 540,
    imageWidth: 1920,
    imageHeight: 1080,
    projectionMatrix: [],
    intrinsicsSource: 'webxr-projection' as const,
  };

  const plane = {
    planePosition: { x: 0, y: 0, z: -2.0 },
    planeNormal: { x: 0, y: 1.0, z: 0 },
    planeQuaternion: { x: 0, y: 0, z: 0, w: 1 },
    planeTransform: [],
    planeSource: 'webxr-hittest' as const,
    planeTrackingValid: true,
  };

  const landmarks = {
    waistLeft: { u: 900, v: 540 },
    waistRight: { u: 1020, v: 540 },
    landmarkSource: 'hrnet-ai' as const,
    landmarksValid: true,
  };

  const result = calculateTiltCorrectedWaistWidth({
    pose,
    intrinsics,
    plane,
    landmarks,
  });

  assert.ok(result.tiltAngleDeg! > 75.0);
  assert.ok(result.measurementWarnings.some(w => w.includes('Extreme camera tilt')));
});
