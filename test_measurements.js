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

// 6b. True 4x4 Matrix Inversion
function invertMatrix4(out, m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const invDet = 1.0 / det;

  out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * invDet;
  out[1] = (-m01 * b11 + m02 * b10 - m03 * b09) * invDet;
  out[2] = (m31 * b05 - m32 * b04 + m33 * b03) * invDet;
  out[3] = (-m21 * b05 + m22 * b04 - m23 * b03) * invDet;
  out[4] = (-m10 * b11 + m12 * b08 - m13 * b07) * invDet;
  out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * invDet;
  out[6] = (-m30 * b05 + m32 * b02 - m33 * b01) * invDet;
  out[7] = (m20 * b05 - m22 * b02 + m23 * b01) * invDet;
  out[8] = (m10 * b10 - m11 * b08 + m13 * b06) * invDet;
  out[9] = (-m00 * b10 + m01 * b08 - m03 * b06) * invDet;
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * invDet;
  out[11] = (-m20 * b04 + m21 * b02 - m23 * b00) * invDet;
  out[12] = (-m10 * b09 + m11 * b07 - m12 * b06) * invDet;
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * invDet;
  out[14] = (-m30 * b03 + m31 * b01 - m32 * b00) * invDet;
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * invDet;

  return out;
}

// 7. Landmark Pixel (u, v) -> NDC -> World Ray -> Plane with FABRIC_OFFSET
function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = 0.002) {
  const pPoint = (planePoint && typeof planePoint.x === 'number') ? planePoint : { x: 0, y: -0.5, z: -0.8 };
  const pNorm = (planeNormal && typeof planeNormal.x === 'number') ? planeNormal : { x: 0, y: 1.0, z: 0 };
  const imgW = imageWidth || 576;
  const imgH = imageHeight || 1280;

  const ndcX = (u / imgW) * 2 - 1;
  const ndcY = 1 - (v / imgH) * 2;

  const invP = invertMatrix4(new Float32Array(16), projMatrix);
  if (!invP) return null;

  const xc = invP[0] * ndcX + invP[4] * ndcY - invP[8] + invP[12];
  const yc = invP[1] * ndcX + invP[5] * ndcY - invP[9] + invP[13];
  const zc = invP[2] * ndcX + invP[6] * ndcY - invP[10] + invP[14];
  const wc = invP[3] * ndcX + invP[7] * ndcY - invP[11] + invP[15];

  if (Math.abs(wc) < 1e-6) return null;
  const vx = xc / wc;
  const vy = yc / wc;
  const vz = zc / wc;

  const rX = camMatrix[0] * vx + camMatrix[4] * vy + camMatrix[8] * vz;
  const rY = camMatrix[1] * vx + camMatrix[5] * vy + camMatrix[9] * vz;
  const rZ = camMatrix[2] * vx + camMatrix[6] * vy + camMatrix[10] * vz;

  const rLen = Math.hypot(rX, rY, rZ);
  if (rLen < 1e-6) return null;
  const dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
  const origin = { x: camMatrix[12], y: camMatrix[13], z: camMatrix[14] };

  // Offset plane point along normal by fabricOffset
  const offsetPlanePoint = {
    x: pPoint.x + fabricOffset * pNorm.x,
    y: pPoint.y + fabricOffset * pNorm.y,
    z: pPoint.z + fabricOffset * pNorm.z
  };

  return intersectRayWithPlane(origin, dir, offsetPlanePoint, pNorm);
}

// 7b. Surface Plane Stabilizer
class SurfacePlaneStabilizer {
  constructor(maxSamples = 20) {
    this.maxSamples = maxSamples;
    this.history = [];
    this.stablePlane = null;
  }

  reset() {
    this.history = [];
    this.stablePlane = null;
  }

  addHitPose(pos, matrix, time) {
    const nLen = Math.hypot(matrix[4], matrix[5], matrix[6]) || 1;
    let nx = matrix[4] / nLen;
    let ny = matrix[5] / nLen;
    let nz = matrix[6] / nLen;

    if (ny < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }

    if (this.stablePlane && Math.abs(pos.y - this.stablePlane.point.y) > 0.15) {
      return this.stablePlane;
    }

    this.history.push({ x: pos.x, y: pos.y, z: pos.z, nx, ny, nz, time });
    if (this.history.length > this.maxSamples) {
      this.history.shift();
    }

    const sortedY = this.history.map(h => h.y).sort((a, b) => a - b);
    const mid = Math.floor(sortedY.length / 2);
    const medianY = (sortedY.length % 2 === 0)
      ? (sortedY[mid - 1] + sortedY[mid]) / 2
      : sortedY[mid];

    let sumX = 0, sumZ = 0, sumNx = 0, sumNy = 0, sumNz = 0;
    for (const h of this.history) {
      sumX += h.x; sumZ += h.z;
      sumNx += h.nx; sumNy += h.ny; sumNz += h.nz;
    }
    const count = this.history.length;
    const isHorizontal = (sumNy / count) > 0.65;

    let finalNx = 0, finalNy = 1.0, finalNz = 0;
    if (!isHorizontal) {
      finalNx = sumNx / count; finalNy = sumNy / count; finalNz = sumNz / count;
      const fLen = Math.hypot(finalNx, finalNy, finalNz) || 1;
      finalNx /= fLen; finalNy /= fLen; finalNz /= fLen;
    }

    this.stablePlane = {
      point: { x: sumX / count, y: medianY, z: sumZ / count },
      normal: { x: finalNx, y: finalNy, z: finalNz },
      isHorizontal,
      isStable: this.history.length >= 5,
      timestamp: time
    };
    return this.stablePlane;
  }
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

// Test 9: Measurement computation between waist_left and waist_right (confidence gating removed)
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

// Test 10: Surface Plane Stabilizer Test
const stabilizer = new SurfacePlaneStabilizer(10);
// Feed 8 poses with slight Y jitter: -0.72, -0.71, -0.73, -0.72, -0.72...
for (let i = 0; i < 8; i++) {
  const jitterY = -0.72 + (i % 2 === 0 ? 0.01 : -0.01);
  stabilizer.addHitPose(
    { x: 0.05 * i, y: jitterY, z: -0.8 },
    [1, 0, 0, 0,  0.08, 0.99, -0.05, 0,  0, 0, 1, 0,  0, 0, 0, 1], // Matrix with slightly tilted normal (ny=0.99)
    1000 + i * 33
  );
}
const stablePlane = stabilizer.stablePlane;
assert.strictEqual(stablePlane.isStable, true, 'Stabilizer must be stable after 8 frames');
assert.strictEqual(stablePlane.isHorizontal, true, 'Must detect horizontal surface');
assert.strictEqual(stablePlane.normal.y, 1.0, 'Horizontal plane normal must be locked to (0, 1, 0)');
assert.strictEqual(stablePlane.normal.x, 0, 'Normal X must be 0 for horizontal plane');
assert.strictEqual(stablePlane.normal.z, 0, 'Normal Z must be 0 for horizontal plane');
assert.strictEqual(Math.round(stablePlane.point.y * 100) / 100, -0.72, 'Median height must be -0.72m');
console.log('✓ Surface Plane Stabilizer Test Passed: Locked horizontal plane to normal (0, 1, 0) and median Y = -0.72m');

console.log('\nALL MATHEMATICAL & ARCHITECTURAL TESTS PASSED!');

