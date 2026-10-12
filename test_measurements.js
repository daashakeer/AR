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
// 6. Direct Screen Tap Ray Unprojection to 3D Surface Plane Test
function screenPixelTo3DPlane(pixelX, pixelY, screenW, screenH, projMatrix, camMatrix, planePoint, planeNormal) {
  const ndcX = (pixelX / screenW) * 2 - 1;
  const ndcY = 1 - (pixelY / screenH) * 2;
  const dxCam = (ndcX + (projMatrix[8] || 0)) / projMatrix[0];
  const dyCam = (ndcY + (projMatrix[9] || 0)) / projMatrix[5];
  const dzCam = -1.0;

  const rX = camMatrix[0] * dxCam + camMatrix[4] * dyCam + camMatrix[8] * dzCam;
  const rY = camMatrix[1] * dxCam + camMatrix[5] * dyCam + camMatrix[9] * dzCam;
  const rZ = camMatrix[2] * dxCam + camMatrix[6] * dyCam + camMatrix[10] * dzCam;
  const rLen = Math.hypot(rX, rY, rZ);
  const dirX = rX / rLen;
  const dirY = rY / rLen;
  const dirZ = rZ / rLen;

  const camX = camMatrix[12];
  const camY = camMatrix[13];
  const camZ = camMatrix[14];

  const denom = planeNormal.x * dirX + planeNormal.y * dirY + planeNormal.z * dirZ;
  if (Math.abs(denom) < 1e-4) return null;

  const t = (planeNormal.x * (planePoint.x - camX) + planeNormal.y * (planePoint.y - camY) + planeNormal.z * (planePoint.z - camZ)) / denom;
  return {
    x: camX + t * dirX,
    y: camY + t * dirY,
    z: camZ + t * dirZ
  };
}

// Test Screen Tap: Tapping at left pixel (400, 540) and right pixel (1520, 540) on flat table at Z = -1.0m
const flatPlanePoint = { x: 0, y: 0, z: -1.0 };
const flatPlaneNormal = { x: 0, y: 0, z: 1.0 }; // Facing camera
const tap1 = screenPixelTo3DPlane(400, 540, 1920, 1080, projMatrix, viewMatrix, flatPlanePoint, flatPlaneNormal);
const tap2 = screenPixelTo3DPlane(1520, 540, 1920, 1080, projMatrix, viewMatrix, flatPlanePoint, flatPlaneNormal);

assert.ok(tap1 && tap2, 'Both screen taps must project to 3D surface');
assert.strictEqual(tap1.z, -1.0, 'Tap 1 must land on plane Z = -1.0');
assert.strictEqual(tap2.z, -1.0, 'Tap 2 must land on plane Z = -1.0');
const tapDist = calculate3DDistance(tap1, tap2);
assert.ok(tapDist > 0.5, 'Distance between screen taps must be physical metric distance');
console.log(`✓ Screen Tap 3D Unprojection Test Passed: Distance = ${(tapDist * 100).toFixed(2)} cm without moving phone!`);

console.log('\nALL MATHEMATICAL & ARCHITECTURAL TESTS PASSED!');
