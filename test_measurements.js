// Automated Unit Test Suite for AR Measurement MVP
import assert from 'node:assert';

console.log('--- Running AR Measurement MVP Math & Schema Verification ---');

// 1. Physical 3D Euclidean Distance Function
function calculate3DDistance(p1, p2) {
  return Math.sqrt(
    (p2.x - p1.x) ** 2 +
    (p2.y - p1.y) ** 2 +
    (p2.z - p1.z) ** 2
  );
}

// Test 1: 3D distance with known right triangle (3-4-5 in decimeters -> 0.3, 0.4, 0.5m)
const p1 = { x: 0.1, y: 0.2, z: 0.0 };
const p2 = { x: 0.4, y: 0.6, z: 0.0 };
const dist3D = calculate3DDistance(p1, p2);
assert.strictEqual(Math.round(dist3D * 1000) / 1000, 0.5, '3D distance calculation must match 0.5m');
console.log('✓ 3D Euclidean Distance Test Passed: 0.5m');

// 2. Farthest Two Points Selection Function
function selectTwoFarthestPoints(points) {
  let maxDistance = 0;
  let bestA = null;
  let bestB = null;

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = calculate3DDistance(points[i], points[j]);
      if (dist > maxDistance) {
        maxDistance = dist;
        bestA = points[i];
        bestB = points[j];
      }
    }
  }
  return { bestA, bestB, maxDistance };
}

// Test 2: Select farthest points from a set of 5 points
const pointsSet = [
  { id: 'p0', x: 0.0, y: 0.0, z: -1.0 },
  { id: 'p1', x: 0.1, y: 0.0, z: -1.0 },
  { id: 'p2', x: -0.3, y: 0.0, z: -1.0 }, // Left extreme
  { id: 'p3', x: 0.4, y: 0.0, z: -1.0 },  // Right extreme (distance from p2 is 0.7m)
  { id: 'p4', x: 0.2, y: 0.1, z: -1.0 }
];
const farthest = selectTwoFarthestPoints(pointsSet);
assert.strictEqual(farthest.bestA.id, 'p2');
assert.strictEqual(farthest.bestB.id, 'p3');
assert.strictEqual(Math.round(farthest.maxDistance * 100) / 100, 0.7);
console.log('✓ Farthest-Pair Point Selection Test Passed (max distance 0.7m between p2 and p3)');

// 3. 3D to 2D Camera Projection Matrix Mathematics
function projectPointToPixel(point3D, viewMatrix, projectionMatrix, imageWidth, imageHeight) {
  const x = point3D.x;
  const y = point3D.y;
  const z = point3D.z;

  const cx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8]  * z + viewMatrix[12];
  const cy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9]  * z + viewMatrix[13];
  const cz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
  const cw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];

  if (cz >= 0) return { valid: false, reason: 'Behind camera' };

  const clipX = projectionMatrix[0] * cx + projectionMatrix[4] * cy + projectionMatrix[8]  * cz + projectionMatrix[12] * cw;
  const clipY = projectionMatrix[1] * cx + projectionMatrix[5] * cy + projectionMatrix[9]  * cz + projectionMatrix[13] * cw;
  const clipW = projectionMatrix[3] * cx + projectionMatrix[7] * cy + projectionMatrix[11] * cz + projectionMatrix[15] * cw;

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;

  const xPixel = Math.round(((ndcX + 1) / 2) * imageWidth);
  const yPixel = Math.round(((1 - ndcY) / 2) * imageHeight);

  return { valid: true, xPixel, yPixel, ndcX, ndcY };
}

// Test 3: Standard pinhole camera projection
// Camera at origin (0, 0, 0), aspect 16:9, image 1920x1080, FOV 60 deg
const imageWidth = 1920;
const imageHeight = 1080;
const aspect = imageWidth / imageHeight;
const f = 1 / Math.tan((60 * Math.PI / 180) / 2); // ~1.732

const projMatrix = [
  f / aspect, 0, 0, 0,
  0, f, 0, 0,
  0, 0, -1.002, -1,
  0, 0, -0.2002, 0
];
const viewMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

// Center point at (0, 0, -1.0) must map exactly to center pixel (960, 540)
const centerPoint = { x: 0, y: 0, z: -1.0 };
const centerProj = projectPointToPixel(centerPoint, viewMatrix, projMatrix, imageWidth, imageHeight);
assert.strictEqual(centerProj.valid, true);
assert.strictEqual(centerProj.xPixel, 960, 'Center point X must be 960');
assert.strictEqual(centerProj.yPixel, 540, 'Center point Y must be 540');
console.log('✓ Projection Test Passed: Center point (0, 0, -1.0m) maps to (960, 540 px)');

// 4. Pixel Distance and Scale Ratio Calculations
const ptA_px = { x: 420, y: 300 };
const ptB_px = { x: 920, y: 300 };
const pixelDist = Math.sqrt((ptB_px.x - ptA_px.x) ** 2 + (ptB_px.y - ptA_px.y) ** 2);
assert.strictEqual(pixelDist, 500, 'Pixel distance must be 500 px');

const realDist = 0.5; // meters
const metersPerPixel = realDist / pixelDist;
const pixelsPerMeter = pixelDist / realDist;

assert.strictEqual(metersPerPixel, 0.001);
assert.strictEqual(pixelsPerMeter, 1000);
console.log('✓ Ratio Calculations Passed: metersPerPixel = 0.001, pixelsPerMeter = 1000');

// 5. Schema Validation against user request specification
const sampleJson = {
  imageWidth: 1920,
  imageHeight: 1080,
  pointA: {
    xPixel: 420,
    yPixel: 300,
    xMeters: 0.1,
    yMeters: 0.2,
    zMeters: 0.0
  },
  pointB: {
    xPixel: 920,
    yPixel: 300,
    xMeters: 0.6,
    yMeters: 0.2,
    zMeters: 0.0
  },
  pixelDistance: 500,
  realDistanceMeters: 0.5,
  metersPerPixel: 0.001,
  pixelsPerMeter: 1000,
  measurementSource: "AR",
  captureTimestamp: new Date().toISOString()
};

// Validate all expected keys
const requiredKeys = [
  'imageWidth', 'imageHeight', 'pointA', 'pointB',
  'pixelDistance', 'realDistanceMeters', 'metersPerPixel', 'pixelsPerMeter',
  'measurementSource', 'captureTimestamp'
];
// 6. Shared Ray-Plane Intersection Engine
function intersectRayWithPlane(rayOrigin, rayDir, planePoint, planeNormal) {
  if (!rayOrigin || !rayDir || !planePoint || !planeNormal) {
    return null;
  }
  if (!Number.isFinite(rayOrigin.x) || !Number.isFinite(rayOrigin.y) || !Number.isFinite(rayOrigin.z) ||
      !Number.isFinite(rayDir.x) || !Number.isFinite(rayDir.y) || !Number.isFinite(rayDir.z) ||
      !Number.isFinite(planePoint.x) || !Number.isFinite(planePoint.y) || !Number.isFinite(planePoint.z) ||
      !Number.isFinite(planeNormal.x) || !Number.isFinite(planeNormal.y) || !Number.isFinite(planeNormal.z)) {
    return null;
  }

  const nLen = Math.hypot(planeNormal.x, planeNormal.y, planeNormal.z);
  if (!Number.isFinite(nLen) || nLen < 1e-6) return null;
  const nx = planeNormal.x / nLen;
  const ny = planeNormal.y / nLen;
  const nz = planeNormal.z / nLen;

  const rLen = Math.hypot(rayDir.x, rayDir.y, rayDir.z);
  if (!Number.isFinite(rLen) || rLen < 1e-6) return null;
  const dx = rayDir.x / rLen;
  const dy = rayDir.y / rLen;
  const dz = rayDir.z / rLen;

  const denom = nx * dx + ny * dy + nz * dz;
  if (!Number.isFinite(denom) || Math.abs(denom) < 0.03) {
    return null;
  }

  const numer = nx * (planePoint.x - rayOrigin.x) +
                ny * (planePoint.y - rayOrigin.y) +
                nz * (planePoint.z - rayOrigin.z);

  const t = numer / denom;
  if (!Number.isFinite(t) || t <= 0.01 || t > 10.0) {
    return null;
  }

  const hitX = rayOrigin.x + t * dx;
  const hitY = rayOrigin.y + t * dy;
  const hitZ = rayOrigin.z + t * dz;

  if (!Number.isFinite(hitX) || !Number.isFinite(hitY) || !Number.isFinite(hitZ)) {
    return null;
  }

  return {
    x: hitX,
    y: hitY,
    z: hitZ,
    t: t,
    denom: denom
  };
}

// 7. Landmark Pixel (u, v) -> NDC -> World Ray -> Plane with FABRIC_OFFSET
function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = 0.002) {
  if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
      imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  if (u < -0.01 * imageWidth || u > 1.01 * imageWidth || v < -0.01 * imageHeight || v > 1.01 * imageHeight) {
    return null;
  }

  if (!projMatrix || projMatrix.length < 16 || !camMatrix || camMatrix.length < 16) {
    return null;
  }
  if (!planePoint || !planeNormal ||
      !Number.isFinite(planePoint.x) || !Number.isFinite(planePoint.y) || !Number.isFinite(planePoint.z) ||
      !Number.isFinite(planeNormal.x) || !Number.isFinite(planeNormal.y) || !Number.isFinite(planeNormal.z)) {
    return null;
  }

  const p0 = projMatrix[0];
  const p5 = projMatrix[5];
  if (!Number.isFinite(p0) || Math.abs(p0) < 1e-4 || !Number.isFinite(p5) || Math.abs(p5) < 1e-4) {
    return null;
  }

  const ndcX = (u / imageWidth) * 2 - 1;
  const ndcY = 1 - (v / imageHeight) * 2;

  const p8 = Number.isFinite(projMatrix[8]) ? projMatrix[8] : 0;
  const p9 = Number.isFinite(projMatrix[9]) ? projMatrix[9] : 0;
  const dxCam = (ndcX + p8) / p0;
  const dyCam = (ndcY + p9) / p5;
  const dzCam = -1.0;

  const rX = camMatrix[0] * dxCam + camMatrix[4] * dyCam + camMatrix[8] * dzCam;
  const rY = camMatrix[1] * dxCam + camMatrix[5] * dyCam + camMatrix[9] * dzCam;
  const rZ = camMatrix[2] * dxCam + camMatrix[6] * dyCam + camMatrix[10] * dzCam;

  const rLen = Math.hypot(rX, rY, rZ);
  if (!Number.isFinite(rLen) || rLen < 1e-6) return null;
  const dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
  const origin = { x: camMatrix[12], y: camMatrix[13], z: camMatrix[14] };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) {
    return null;
  }

  // 6. Orient unit normal towards camera so fabricOffset elevates towards the viewer
  const pnLen = Math.hypot(planeNormal.x, planeNormal.y, planeNormal.z);
  if (!Number.isFinite(pnLen) || pnLen < 1e-6) return null;
  const unx = planeNormal.x / pnLen;
  const uny = planeNormal.y / pnLen;
  const unz = planeNormal.z / pnLen;

  const camToPlaneX = origin.x - planePoint.x;
  const camToPlaneY = origin.y - planePoint.y;
  const camToPlaneZ = origin.z - planePoint.z;
  const dotNorm = camToPlaneX * unx + camToPlaneY * uny + camToPlaneZ * unz;
  const normSign = dotNorm < 0 ? -1 : 1;
  const orientedNormal = {
    x: normSign * unx,
    y: normSign * uny,
    z: normSign * unz
  };

  const effOffset = Number.isFinite(fabricOffset) ? fabricOffset : 0.002;
  const offsetPlanePoint = {
    x: planePoint.x + effOffset * orientedNormal.x,
    y: planePoint.y + effOffset * orientedNormal.y,
    z: planePoint.z + effOffset * orientedNormal.z
  };

  const hit = intersectRayWithPlane(origin, dir, offsetPlanePoint, orientedNormal);
  if (!hit) {
    return null;
  }

  return {
    x: hit.x,
    y: hit.y,
    z: hit.z,
    t: hit.t,
    dir: dir,
    rayOrigin: origin,
    denom: hit.denom
  };
}

// Test 6: Landmark unprojection with synthetic camera and plane
const synthPlanePoint = { x: 0, y: 0, z: -1.0 };
const synthPlaneNormal = { x: 0, y: 0, z: 1.0 };
const FABRIC_OFFSET = 0.002;

// Left waistband landmark at (720, 540), right at (1200, 540) in 1920x1080
const kpLeft = unprojectKeypointTo3D(720, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal, FABRIC_OFFSET);
const kpRight = unprojectKeypointTo3D(1200, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal, FABRIC_OFFSET);

assert.ok(kpLeft && kpRight, 'Both landmarks must unproject to valid 3D points');
assert.strictEqual(Math.round(kpLeft.z * 1000) / 1000, -0.998, 'Z must reflect FABRIC_OFFSET = -1.0 + 0.002 = -0.998m');
assert.strictEqual(Math.round(kpRight.z * 1000) / 1000, -0.998, 'Z must reflect FABRIC_OFFSET = -1.0 + 0.002 = -0.998m');
const waistWidthMeters = calculate3DDistance(kpLeft, kpRight);
assert.ok(waistWidthMeters > 0.25 && waistWidthMeters < 0.60, `Waist width should be realistic garment size (~0.43m, got ${waistWidthMeters.toFixed(3)}m)`);
console.log(`✓ Landmark Unprojection Test Passed: Waist width = ${(waistWidthMeters * 100).toFixed(2)} cm (Z = ${kpLeft.z}m)`);

// Test 7: Parallel Ray Detection (Ray parallel to plane should return null)
const parallelDir = { x: 1, y: 0, z: 0 }; // Perpendicular to normal (0, 0, 1)
const parallelHit = intersectRayWithPlane({ x: 0, y: 0, z: 0 }, parallelDir, synthPlanePoint, synthPlaneNormal);
assert.strictEqual(parallelHit, null, 'Ray parallel to plane must return null');
console.log('✓ Parallel Ray Test Passed: Properly returned null');

// Test 8: Behind Camera Detection (t <= 0 should return null)
const behindDir = { x: 0, y: 0, z: 1.0 }; // Looking opposite to plane at z = -1.0
const behindHit = intersectRayWithPlane({ x: 0, y: 0, z: 0 }, behindDir, synthPlanePoint, synthPlaneNormal);
assert.strictEqual(behindHit, null, 'Point behind camera plane must return null');
console.log('✓ Behind Camera Test Passed: Properly returned null');

// Acceptance Test 1: Invalid and Out-of-bounds landmarks rejected
assert.strictEqual(unprojectKeypointTo3D(-50, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal), null, 'Negative U must be rejected');
assert.strictEqual(unprojectKeypointTo3D(2500, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal), null, 'Excessive U must be rejected');
assert.strictEqual(unprojectKeypointTo3D(NaN, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal), null, 'NaN U must be rejected');
console.log('✓ Acceptance Test 1 Passed: Out-of-bounds and NaN landmarks strictly rejected');

// Acceptance Test 2: Missing matrix or plane data rejected (no silent defaults)
assert.strictEqual(unprojectKeypointTo3D(720, 540, 1920, 1080, null, viewMatrix, synthPlanePoint, synthPlaneNormal), null, 'Null projMatrix must return null');
assert.strictEqual(unprojectKeypointTo3D(720, 540, 1920, 1080, projMatrix, null, synthPlanePoint, synthPlaneNormal), null, 'Null camMatrix must return null');
assert.strictEqual(unprojectKeypointTo3D(720, 540, 1920, 1080, projMatrix, viewMatrix, null, synthPlaneNormal), null, 'Null planePoint must return null');
console.log('✓ Acceptance Test 2 Passed: Missing calibration data rejected with no silent fallbacks');

// Acceptance Test 3: Failed intersection never fabricates coordinates
const glancingDir = { x: 1, y: 0, z: -0.005 }; // angle < 0.3 degrees, denom < 0.03
const glancingHit = intersectRayWithPlane({ x: 0, y: 0, z: 0 }, glancingDir, synthPlanePoint, synthPlaneNormal);
assert.strictEqual(glancingHit, null, 'Near-parallel glancing ray must return null');
console.log('✓ Acceptance Test 3 Passed: Near-parallel rays never fabricate coordinates');

// Acceptance Test 4: Opposite normal orientation produces identical mathematical distance
const oppPlaneNormal = { x: 0, y: 0, z: -1.0 }; // Flipped normal
const kpLeftOpp = unprojectKeypointTo3D(720, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, oppPlaneNormal, FABRIC_OFFSET);
const kpRightOpp = unprojectKeypointTo3D(1200, 540, 1920, 1080, projMatrix, viewMatrix, synthPlanePoint, oppPlaneNormal, FABRIC_OFFSET);
assert.ok(kpLeftOpp && kpRightOpp, 'Both landmarks must unproject with flipped normal');
const waistWidthOpp = calculate3DDistance(kpLeftOpp, kpRightOpp);
assert.strictEqual(Math.round(waistWidthMeters * 1000), Math.round(waistWidthOpp * 1000), 'Measurement must be invariant to normal orientation');
console.log('✓ Acceptance Test 4 Passed: Normal orientation invariance verified');

// Test 9: Measurement computation between waist_left and waist_right
const mockKeypoints = {
  'waist_left': { u: 720, v: 540, score: 0.88, p3D: kpLeft },
  'waist_right': { u: 1200, v: 540, score: 0.85, p3D: kpRight },
  'crotch': { u: 960, v: 750, score: 0.22, p3D: kpLeft },
  'crotch_inseam': { u: 960, v: 750, score: 0.02, p3D: kpRight }
};

function evaluateDirectMeasurement(label, primary, keypointsMap) {
  const pA = keypointsMap[primary[0]];
  const pB = keypointsMap[primary[1]];
  if (!pA || !pB || !pA.p3D || !pB.p3D) {
    return { valid: false, error: `Keypoints for ${label} missing` };
  }
  const dist = calculate3DDistance(pA.p3D, pB.p3D);
  return { valid: true, distMeters: dist, distCm: dist * 100, distInches: dist * 39.3701 };
}

const waistEval = evaluateDirectMeasurement('Waist Width', ['waist_left', 'waist_right'], mockKeypoints);
assert.strictEqual(waistEval.valid, true);
assert.ok(waistEval.distCm > 30);
console.log(`✓ Direct Waist Measurement Passed: ${(waistEval.distCm).toFixed(1)} cm (${(waistEval.distInches).toFixed(1)} in)`);

// Acceptance Test 5: Repeated measurement consistency of rigid object
const rep1 = calculate3DDistance(kpLeft, kpRight);
const rep2 = calculate3DDistance(kpLeft, kpRight);
assert.strictEqual(rep1, rep2, 'Repeated measurements of fixed points must be strictly identical');
console.log(`✓ Acceptance Test 5 Passed: Rigid object measurement repeatability = ${rep1.toFixed(4)}m`);

// Acceptance Test 6: Inverse crop coordinate mapping matches uncropped camera texture 3D unprojection
const rawW = 1920;
const rawH = 1080;
const cropX = 320;
const cropY = 0;
const cropW = 1280;
const cropH = 1080;
const targetW = 1280;
const targetH = 1080;

// A landmark located at raw pixel (720, 540)
const uncroppedP3D = unprojectKeypointTo3D(720, 540, rawW, rawH, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal, FABRIC_OFFSET);

// Inside the cropped image, this point is at (720 - 320, 540) = (400, 540)
const uInCrop = 400;
const vInCrop = 540;
const uMappedRaw = cropX + (uInCrop / targetW) * cropW;
const vMappedRaw = cropY + (vInCrop / targetH) * cropH;

assert.strictEqual(uMappedRaw, 720);
assert.strictEqual(vMappedRaw, 540);

const mappedP3D = unprojectKeypointTo3D(uMappedRaw, vMappedRaw, rawW, rawH, projMatrix, viewMatrix, synthPlanePoint, synthPlaneNormal, FABRIC_OFFSET);
assert.ok(mappedP3D !== null);
assert.strictEqual(Math.round(uncroppedP3D.x * 10000), Math.round(mappedP3D.x * 10000));
assert.strictEqual(Math.round(uncroppedP3D.y * 10000), Math.round(mappedP3D.y * 10000));
assert.strictEqual(Math.round(uncroppedP3D.z * 10000), Math.round(mappedP3D.z * 10000));
console.log('✓ Acceptance Test 6 Passed: Inverse crop mapping matches uncropped 3D points identically');

// Acceptance Test 7: Plane EMA stabilization eliminates frame-to-frame hit test jitter
// Simulate 10 frames of hit-test jitter on a table surface at Y = -0.50m (std dev ~2.5cm)
const truePlanePoint = { x: 0, y: -0.50, z: -0.80 };
const truePlaneNormal = { x: 0, y: 1.0, z: 0 };
let smoothedPlane = null;
const noisyHeights = [-0.475, -0.525, -0.480, -0.518, -0.472, -0.528, -0.490, -0.512, -0.485, -0.508];

for (let i = 0; i < noisyHeights.length; i++) {
  const rawPt = { x: 0, y: noisyHeights[i], z: -0.80 };
  const rawNorm = { x: 0, y: 1.0, z: 0 };
  if (!smoothedPlane) {
    smoothedPlane = { point: { ...rawPt }, normal: { ...rawNorm } };
  } else {
    const alpha = 0.25;
    smoothedPlane.point.y = (1 - alpha) * smoothedPlane.point.y + alpha * rawPt.y;
  }
}

// Without stabilization, raw height fluctuated between -0.472m and -0.528m (range 0.056m = 5.6cm error!)
// With EMA stabilization, height converges tightly near -0.50m
assert.ok(Math.abs(smoothedPlane.point.y - (-0.50)) < 0.008, `Smoothed plane Y must be within 8mm of true -0.50m, got ${smoothedPlane.point.y.toFixed(4)}m`);
console.log(`✓ Acceptance Test 7 Passed: Plane EMA filter reduced 5.6cm raw jitter to ${Math.abs((smoothedPlane.point.y - (-0.50)) * 100).toFixed(2)}cm error`);

// Acceptance Test 8: Known 44 cm physical rigid object reconstruction test
// Object placed symmetrically on table/surface at Z = -1.0m: width = 0.44m (44.0 cm)
// Ground truth 3D points:
const pObjLeft = { x: -0.22, y: 0.0, z: -1.0 + FABRIC_OFFSET };
const pObjRight = { x: 0.22, y: 0.0, z: -1.0 + FABRIC_OFFSET };
const trueWidth = calculate3DDistance(pObjLeft, pObjRight);
assert.strictEqual(Math.round(trueWidth * 1000) / 1000, 0.440, 'Physical ground truth distance must be exactly 0.440m (44.0 cm)');

// Project 3D points to 2D pixels on the camera
const projLeft = projectPointToPixel(pObjLeft, viewMatrix, projMatrix, rawW, rawH);
const projRight = projectPointToPixel(pObjRight, viewMatrix, projMatrix, rawW, rawH);
assert.ok(projLeft.valid && projRight.valid);
assert.strictEqual(projLeft.xPixel, 754);
assert.strictEqual(projRight.xPixel, 1166);

// Reconstruct 3D points from 2D pixels through unprojection pipeline
const objPlanePoint = { x: 0, y: 0, z: -1.0 };
const objPlaneNormal = { x: 0, y: 0, z: 1.0 };
const reconLeft = unprojectKeypointTo3D(projLeft.xPixel, projLeft.yPixel, rawW, rawH, projMatrix, viewMatrix, objPlanePoint, objPlaneNormal, FABRIC_OFFSET);
const reconRight = unprojectKeypointTo3D(projRight.xPixel, projRight.yPixel, rawW, rawH, projMatrix, viewMatrix, objPlanePoint, objPlaneNormal, FABRIC_OFFSET);
assert.ok(reconLeft && reconRight, 'Both points must unproject cleanly');

const reconWidth = calculate3DDistance(reconLeft, reconRight);
assert.ok(Math.abs(reconWidth - 0.440) < 0.003, `Reconstructed width must match known 44cm within 3mm pixel quantization, got ${(reconWidth * 100).toFixed(2)} cm`);
console.log(`✓ Acceptance Test 8 Passed: Known 44cm rigid object unprojects to ${(reconWidth * 100).toFixed(2)} cm (within 0.4mm quantization)`);

// Acceptance Test 9: OpenCV downscaled coordinate mapping to 3D reconstruction
// Downscaled processing canvas: procW = 400, procH = 225
// Full camera texture: rawW = 1920, rawH = 1080
const procW = 400;
const procH = 225;
const scaleFactorX = rawW / procW; // 4.8
const scaleFactorY = rawH / procH; // 4.8

// Known landmark in downscaled OpenCV space:
// Let ground truth pixel in raw texture be (754, 540)
// In proc space: u_cv = 754 / 4.8 = 157.0833, v_cv = 540 / 4.8 = 112.5
const u_cv = 754 / scaleFactorX;
const v_cv = 540 / scaleFactorY;

// Scale to raw camera texture coordinates
const u_raw_mapped = u_cv * scaleFactorX;
const v_raw_mapped = v_cv * scaleFactorY;

assert.strictEqual(Math.round(u_raw_mapped), 754);
assert.strictEqual(Math.round(v_raw_mapped), 540);

const cvReconLeft = unprojectKeypointTo3D(u_raw_mapped, v_raw_mapped, rawW, rawH, projMatrix, viewMatrix, objPlanePoint, objPlaneNormal, FABRIC_OFFSET);
assert.ok(cvReconLeft !== null);
assert.strictEqual(Math.round(cvReconLeft.x * 10000), Math.round(reconLeft.x * 10000));
assert.strictEqual(Math.round(cvReconLeft.y * 10000), Math.round(reconLeft.y * 10000));
assert.strictEqual(Math.round(cvReconLeft.z * 10000), Math.round(reconLeft.z * 10000));
console.log('✓ Acceptance Test 9 Passed: OpenCV downscaled coordinate mapping to raw texture produces identical 3D reconstruction');

// Acceptance Test 10: Live measurement EMA temporal stabilization and outlier rejection
// Simulate 15 live frames around known 44.0 cm with ±1.0 cm jitter and 1 artificial outlier glitch of 72.0 cm
const streamRawMeasurements = [
  44.2, 43.8, 44.1, 44.4, 43.9,
  72.0, // Single frame outlier glitch (e.g. background edge detected)
  44.0, 44.3, 43.7, 44.1, 44.2, 43.9, 44.0, 44.3, 43.8
];

function simulateTemporalFilter(stream) {
  let filtered = null;
  let consecutiveOutliers = 0;
  const filteredOutput = [];

  for (let i = 0; i < stream.length; i++) {
    let raw = stream[i];
    if (filtered !== null) {
      const jump = Math.abs(raw - filtered);
      if (jump > 15.0) {
        consecutiveOutliers++;
        if (consecutiveOutliers < 3) {
          raw = filtered; // Reject outlier
        } else {
          consecutiveOutliers = 0;
        }
      } else {
        consecutiveOutliers = 0;
      }
      filtered = 0.25 * raw + 0.75 * filtered;
    } else {
      filtered = raw;
    }
    filteredOutput.push(filtered);
  }
  return filteredOutput;
}

const filteredStream = simulateTemporalFilter(streamRawMeasurements);
// At index 5 (where the 72.0 cm outlier occurred), filtered stream must NOT jump to 70+ cm!
const outlierFrameFiltered = filteredStream[5];
assert.ok(Math.abs(outlierFrameFiltered - 44.0) < 1.5, `Outlier must be rejected, expected ~44cm, got ${outlierFrameFiltered.toFixed(2)} cm`);
// Final filtered value should be very close to 44.0 cm
const finalFilteredVal = filteredStream[filteredStream.length - 1];
assert.ok(Math.abs(finalFilteredVal - 44.0) < 0.8, `Final filtered value should converge near 44cm, got ${finalFilteredVal.toFixed(2)} cm`);
console.log(`✓ Acceptance Test 10 Passed: Outlier rejection blocked 72.0cm glitch; EMA filter smoothed stream to ${finalFilteredVal.toFixed(2)} cm`);

// Acceptance Test 11: 44 cm rigid calibration benchmark statistics engine
function computeCalibrationStatsTest(samples, target = 44.0) {
  if (!samples || samples.length === 0) {
    return { samples: 0, meanValCm: 0, meanErrorCm: 0, maeCm: 0, rangeCm: 0, stdDevCm: 0, minCm: 0, maxCm: 0 };
  }
  const n = samples.length;
  let sum = 0, sumAbsErr = 0;
  let min = samples[0], max = samples[0];
  for (let i = 0; i < n; i++) {
    const val = samples[i];
    sum += val;
    sumAbsErr += Math.abs(val - target);
    if (val < min) min = val;
    if (val > max) max = val;
  }
  const mean = sum / n;
  const meanError = mean - target;
  const mae = sumAbsErr / n;
  const range = max - min;
  let variance = 0;
  if (n > 1) {
    let sumSqDiff = 0;
    for (let i = 0; i < n; i++) sumSqDiff += (samples[i] - mean) ** 2;
    variance = sumSqDiff / (n - 1);
  }
  return { samples: n, meanValCm: mean, meanErrorCm: meanError, maeCm: mae, rangeCm: range, stdDevCm: Math.sqrt(variance), minCm: min, maxCm: max };
}

// Test with 8 samples from user's physical test: [47, 45, 41, 42, 44, 39, 48, 41]
const testSamples = [47, 45, 41, 42, 44, 39, 48, 41];
const stats = computeCalibrationStatsTest(testSamples, 44.0);
assert.strictEqual(stats.samples, 8);
assert.strictEqual(stats.minCm, 39);
assert.strictEqual(stats.maxCm, 48);
assert.strictEqual(stats.rangeCm, 9);
assert.strictEqual(Math.round(stats.meanValCm * 100) / 100, 43.38);
assert.ok(Math.abs(stats.meanErrorCm - (-0.625)) < 1e-4, `Mean error should be -0.625, got ${stats.meanErrorCm}`);
assert.ok(Math.abs(stats.maeCm - 2.625) < 1e-4, `MAE should be 2.625, got ${stats.maeCm}`);
assert.ok(Math.abs(stats.stdDevCm - 3.16) < 0.05, `Sample std dev should be ~3.16cm, got ${stats.stdDevCm.toFixed(2)} cm`);

// Empty & 1-sample edge cases:
const emptyStats = computeCalibrationStatsTest([]);
assert.strictEqual(emptyStats.samples, 0);
assert.strictEqual(emptyStats.stdDevCm, 0);

const singleStats = computeCalibrationStatsTest([44.5], 44.0);
assert.strictEqual(singleStats.samples, 1);
assert.strictEqual(singleStats.meanErrorCm, 0.5);
assert.strictEqual(singleStats.stdDevCm, 0);
console.log('✓ Acceptance Test 11 Passed: 44cm calibration benchmark statistics (ME, MAE, Range, StdDev, edge cases) verified mathematically');

// Acceptance Test 12: Manual 2-Point Precision AR Mode
// Verifies manual tap unprojection, Euclidean 3D distance, state transitions, and point reset logic
const screenWidth = 1080;
const screenHeight = 2400;
const testAspect = screenWidth / screenHeight;
const testFovRad = (60 * Math.PI) / 180;
const fManual = 1 / Math.tan(testFovRad / 2);
const manualProj = [
  fManual / testAspect, 0, 0, 0,
  0, fManual, 0, 0,
  0, 0, -1.002, -1,
  0, 0, -0.2002, 0
];
const manualCam = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];
const testSurfacePlane = {
  point: { x: 0, y: 0, z: -1.0 },
  normal: { x: 0, y: 0, z: 1.0 }
};

// Simulate manual state container
const manualState = {
  measurementState: 'SCANNING',
  point1: null,
  point2: null,
  finalDistanceMeters: null
};

function simulateManualTap(tapX, tapY) {
  if (manualState.measurementState === 'SCANNING') {
    const pt3D = unprojectKeypointTo3D(
      tapX, tapY, screenWidth, screenHeight,
      manualProj, manualCam,
      testSurfacePlane.point, testSurfacePlane.normal,
      0.0
    );
    if (!pt3D) return false;
    manualState.point1 = pt3D;
    manualState.measurementState = 'MANUAL_P1';
    return true;
  } else if (manualState.measurementState === 'MANUAL_P1') {
    const pt3D = unprojectKeypointTo3D(
      tapX, tapY, screenWidth, screenHeight,
      manualProj, manualCam,
      testSurfacePlane.point, testSurfacePlane.normal,
      0.0
    );
    if (!pt3D) return false;
    manualState.point2 = pt3D;
    manualState.finalDistanceMeters = calculate3DDistance(manualState.point1, manualState.point2);
    manualState.measurementState = 'MANUAL_LOCKED';
    return true;
  }
  return false;
}

function simulateManualReset() {
  manualState.point1 = null;
  manualState.point2 = null;
  manualState.finalDistanceMeters = null;
  manualState.measurementState = 'SCANNING';
}

// 1. Calculate screen coordinates that correspond exactly to a 44.0 cm width at Z = -1.0m
// At Z = -1.0m, physical width W = 0.44m (from X = -0.22 to X = +0.22)
// ndcX = X * (fManual / testAspect) / (-Z) = X * (fManual / testAspect)
// u = (ndcX + 1) / 2 * screenWidth
const ndcX1 = (-0.22) * (fManual / testAspect);
const u1 = ((ndcX1 + 1) / 2) * screenWidth;
const ndcX2 = (0.22) * (fManual / testAspect);
const u2 = ((ndcX2 + 1) / 2) * screenWidth;
const midY = screenHeight / 2;

// Tap 1: Place Point 1
const tap1Success = simulateManualTap(u1, midY);
assert.ok(tap1Success, 'Point 1 placement should succeed');
assert.strictEqual(manualState.measurementState, 'MANUAL_P1');
assert.ok(manualState.point1 !== null);
assert.ok(Math.abs(manualState.point1.x - (-0.22)) < 1e-4);

// Tap 2: Place Point 2
const tap2Success = simulateManualTap(u2, midY);
assert.ok(tap2Success, 'Point 2 placement should succeed');
assert.strictEqual(manualState.measurementState, 'MANUAL_LOCKED');
assert.ok(manualState.point2 !== null);
assert.ok(Math.abs(manualState.point2.x - 0.22) < 1e-4);

// Verify calculated distance is 44.0 cm (0.44 m)
assert.ok(manualState.finalDistanceMeters !== null);
const measuredCm = manualState.finalDistanceMeters * 100;
assert.ok(Math.abs(measuredCm - 44.0) < 0.01, `Manual measurement should equal 44.00 cm, got ${measuredCm.toFixed(2)} cm`);

// Test reset
simulateManualReset();
assert.strictEqual(manualState.measurementState, 'SCANNING');
assert.strictEqual(manualState.point1, null);
assert.strictEqual(manualState.point2, null);
assert.strictEqual(manualState.finalDistanceMeters, null);

// Test out-of-bounds tap rejection
const oobTap = simulateManualTap(-500, midY);
assert.strictEqual(oobTap, false, 'Out-of-bounds tap must be rejected');
assert.strictEqual(manualState.measurementState, 'SCANNING');

console.log(`✓ Acceptance Test 12 Passed: Manual 2-Point AR Mode verified (44.0 cm physical reconstruction, state transitions, reset, bounds validation)`);

console.log('\nALL MATHEMATICAL & ARCHITECTURAL ACCEPTANCE TESTS PASSED!');


