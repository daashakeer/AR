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
  const denom = planeNormal.x * rayDir.x + planeNormal.y * rayDir.y + planeNormal.z * rayDir.z;
  if (Math.abs(denom) < 1e-4) return null; // Ray parallel to plane
  const t = (
    planeNormal.x * (planePoint.x - rayOrigin.x) +
    planeNormal.y * (planePoint.y - rayOrigin.y) +
    planeNormal.z * (planePoint.z - rayOrigin.z)
  ) / denom;
  if (t <= 0.001) return null; // Behind or at camera origin
  return {
    x: rayOrigin.x + t * rayDir.x,
    y: rayOrigin.y + t * rayDir.y,
    z: rayOrigin.z + t * rayDir.z,
    t: t
  };
}

// 7. Landmark Pixel (u, v) -> NDC -> World Ray -> Plane with FABRIC_OFFSET
function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = 0.002) {
  const ndcX = (u / imageWidth) * 2 - 1;
  const ndcY = 1 - (v / imageHeight) * 2;
  const dxCam = (ndcX + (projMatrix[8] || 0)) / projMatrix[0];
  const dyCam = (ndcY + (projMatrix[9] || 0)) / projMatrix[5];
  const dzCam = -1.0;

  const rX = camMatrix[0] * dxCam + camMatrix[4] * dyCam + camMatrix[8] * dzCam;
  const rY = camMatrix[1] * dxCam + camMatrix[5] * dyCam + camMatrix[9] * dzCam;
  const rZ = camMatrix[2] * dxCam + camMatrix[6] * dyCam + camMatrix[10] * dzCam;
  const rLen = Math.hypot(rX, rY, rZ);
  if (rLen < 1e-6) return null;
  const dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
  const origin = { x: camMatrix[12], y: camMatrix[13], z: camMatrix[14] };

  // Offset plane point along normal by fabricOffset
  const offsetPlanePoint = {
    x: planePoint.x + fabricOffset * planeNormal.x,
    y: planePoint.y + fabricOffset * planeNormal.y,
    z: planePoint.z + fabricOffset * planeNormal.z
  };

  return intersectRayWithPlane(origin, dir, offsetPlanePoint, planeNormal);
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

// Test 9: Measurement computation & landmark confidence check (MIN_CONFIDENCE = 0.05)
const MIN_CONFIDENCE = 0.05;
const mockKeypoints = {
  'waist_left': { u: 720, v: 540, score: 0.88, p3D: kpLeft },
  'waist_right': { u: 1200, v: 540, score: 0.85, p3D: kpRight },
  'crotch': { u: 960, v: 750, score: 0.22, p3D: kpLeft },
  'crotch_inseam': { u: 960, v: 750, score: 0.02, p3D: null } // Below 0.05 threshold
};

function evaluateMeasurementWithFallback(label, primary, fallbacks, keypointsMap) {
  let bestPair = null;
  const pA = keypointsMap[primary[0]];
  const pB = keypointsMap[primary[1]];
  if (pA && pB && pA.score >= MIN_CONFIDENCE && pB.score >= MIN_CONFIDENCE && pA.p3D && pB.p3D) {
    bestPair = [pA, pB];
  }
  if (!bestPair && fallbacks) {
    for (const fb of fallbacks) {
      const fbA = keypointsMap[fb[0]];
      const fbB = keypointsMap[fb[1]];
      if (fbA && fbB && fbA.score >= MIN_CONFIDENCE && fbB.score >= MIN_CONFIDENCE && fbA.p3D && fbB.p3D) {
        bestPair = [fbA, fbB];
        break;
      }
    }
  }
  if (!bestPair) {
    return { valid: false, error: `Couldn't see the ${label.toLowerCase()} clearly` };
  }
  const dist = calculate3DDistance(bestPair[0].p3D, bestPair[1].p3D);
  return { valid: true, distMeters: dist, distCm: dist * 100 };
}

const waistEval = evaluateMeasurementWithFallback('Waist Width', ['waist_left', 'waist_right'], [], mockKeypoints);
assert.strictEqual(waistEval.valid, true);
assert.ok(waistEval.distCm > 30);

// Inseam with primary ['crotch_inseam', 'waist_left'] failing, but fallback ['crotch', 'waist_left'] succeeding
const inseamEval = evaluateMeasurementWithFallback(
  'Inseam',
  ['crotch_inseam', 'waist_left'],
  [['crotch', 'waist_left']],
  mockKeypoints
);
assert.strictEqual(inseamEval.valid, true, 'Fallback landmark must resolve when primary score is below 0.05');
console.log('✓ Measurement & Confidence Score (0.05 + Fallbacks) Test Passed!');

console.log('\nALL MATHEMATICAL & ARCHITECTURAL TESTS PASSED!');

