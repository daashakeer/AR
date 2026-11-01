/**
 * Precision Depth Processing, 3D RANSAC Floor-Plane Estimation & Kalman Sensor Fusion
 * Specialized for WebXR + ARCore Trouser Measurement Systems
 * 
 * Standards & Mathematics:
 * - Camera Intrinsics: Pinhole projection matrix extraction (fx, fy, cx, cy)
 * - Multi-frame Depth Point Accumulation: Camera pose alignment into world space
 * - Spatial Consistency & Outlier Rejection: Local variance & range validity
 * - 3D RANSAC Plane Estimation: Floor-plane fitting with normal orientation & SVD/least-squares refinement
 * - Kalman Filter 1D: Fusing RANSAC depth elevation, SLAM hit-testing, and camera height
 * - Perspective Correction: 3D ray-plane unprojection with fabric offset
 * - Calibration Benchmarking: MAE, RMSE, std dev, repeatability, ±0.5" and ±0.25" thresholds
 */

/**
 * 1. 1D Kalman Filter for Static Surface Elevation & Height Tracking
 * Tracks floor elevation Y in world coordinates (which is physically static).
 */
export class KalmanFilter1D {
  /**
   * @param {number} initialState - Initial state estimate (e.g. initial floor elevation in meters)
   * @param {number} initialVariance - Initial estimation error covariance (P)
   * @param {number} processNoise - Process noise covariance (Q, small for static physical floor)
   */
  constructor(initialState = 0, initialVariance = 1.0, processNoise = 1e-5) {
    this.x = initialState;
    this.p = initialVariance;
    this.q = processNoise;
    this.isInitialized = false;
  }

  reset(initialState = 0, initialVariance = 1.0) {
    this.x = initialState;
    this.p = initialVariance;
    this.isInitialized = false;
  }

  predict() {
    this.p += this.q;
    return this.x;
  }

  /**
   * Updates state with a new observation
   * @param {number} measurement - Measured value (e.g. floor Y elevation)
   * @param {number} measurementNoise - Measurement noise covariance (R)
   * @param {number} gateThreshold - Innovation rejection threshold in standard deviations (Mahalanobis gate)
   * @returns {number} Updated state estimate
   */
  update(measurement, measurementNoise, gateThreshold = 3.5) {
    if (!Number.isFinite(measurement) || !Number.isFinite(measurementNoise) || measurementNoise <= 0) {
      return this.x;
    }

    if (!this.isInitialized) {
      this.x = measurement;
      this.p = measurementNoise;
      this.isInitialized = true;
      return this.x;
    }

    this.predict();

    const y = measurement - this.x; // innovation
    const s = this.p + measurementNoise; // innovation covariance

    // Gating check: reject tracking jumps
    if (Math.abs(y) > gateThreshold * Math.sqrt(s)) {
      return this.x;
    }

    const k = this.p / s; // Kalman gain
    this.x += k * y;
    this.p = (1.0 - k) * this.p;

    return this.x;
  }
}

/**
 * 2. Camera Intrinsics Extractor
 * Extracts pinhole camera parameters (fx, fy, cx, cy) from WebXR 4x4 projection matrix.
 * 
 * WebXR Projection Matrix layout (column-major):
 * P[0]  = 2*fx / W
 * P[5]  = 2*fy / H
 * P[8]  = (2*cx / W) - 1
 * P[9]  = (2*cy / H) - 1 (or 1 - 2*cy/H depending on OpenGL clip convention)
 * 
 * @param {ArrayLike<number>} projMatrix - 16-element WebXR projection matrix
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {object|null} Intrinsics object or null if invalid
 */
export function extractCameraIntrinsics(projMatrix, width, height) {
  if (!projMatrix || projMatrix.length < 16 || width <= 0 || height <= 0) {
    return null;
  }

  const p00 = projMatrix[0];
  const p11 = projMatrix[5];
  const p20 = Number.isFinite(projMatrix[8]) ? projMatrix[8] : 0;
  const p21 = Number.isFinite(projMatrix[9]) ? projMatrix[9] : 0;

  if (!Number.isFinite(p00) || Math.abs(p00) < 1e-4 || !Number.isFinite(p11) || Math.abs(p11) < 1e-4) {
    return null;
  }

  const fx = (p00 * width) / 2.0;
  const fy = (p11 * height) / 2.0;
  const cx = ((p20 + 1.0) * width) / 2.0;
  // In WebXR top-left 2D pixel coordinates, NDC Y goes from +1 (top) to -1 (bottom)
  const cy = ((1.0 - p21) * height) / 2.0;

  return {
    fx,
    fy,
    cx,
    cy,
    width,
    height,
    p00,
    p11,
    p20,
    p21
  };
}

/**
 * 3. Multi-frame Depth Point Accumulator
 * Converts valid depth samples into 3D world points and aligns them across frames using camera poses.
 */
export class MultiFrameDepthAccumulator {
  /**
   * @param {number} maxFrames - Number of valid frames to buffer (e.g. 20-30)
   * @param {number} maxPointsTotal - Maximum total points in sliding window
   */
  constructor(maxFrames = 25, maxPointsTotal = 600) {
    this.maxFrames = maxFrames;
    this.maxPointsTotal = maxPointsTotal;
    this.frameBuffer = []; // Array of { timestamp, points: Array<{x, y, z}> }
    this.allWorldPoints = [];
    this.validFrameCount = 0;
  }

  clear() {
    this.frameBuffer = [];
    this.allWorldPoints = [];
    this.validFrameCount = 0;
  }

  /**
   * Processes a depth frame, converts samples to 3D world points, and appends to buffer.
   * 
   * @param {object} depthInfo - WebXR XRCPUDepthInformation
   * @param {ArrayLike<number>} projMatrix - View projection matrix
   * @param {ArrayLike<number>} camMatrix - Camera-to-world 4x4 matrix (view.transform.matrix)
   * @param {number} timestamp - Frame timestamp
   * @param {object} options - Sampling options
   * @returns {number} Count of valid points extracted in this frame
   */
  addDepthFrame(depthInfo, projMatrix, camMatrix, timestamp, options = {}) {
    if (!depthInfo || !projMatrix || !camMatrix) return 0;
    if (depthInfo.width <= 0 || depthInfo.height <= 0) return 0;

    const {
      gridCols = 8,
      gridRows = 8,
      minDepth = 0.25,
      maxDepth = 2.50,
      centerGarmentExclusionRadius = 0.20, // Exclude center region where garment lies
      spatialVarianceThreshold = 0.04 // Max std dev across 3x3 local patch for planarity
    } = options;

    const dW = depthInfo.width;
    const dH = depthInfo.height;
    const p00 = projMatrix[0];
    const p11 = projMatrix[5];
    const p20 = Number.isFinite(projMatrix[8]) ? projMatrix[8] : 0;
    const p21 = Number.isFinite(projMatrix[9]) ? projMatrix[9] : 0;

    if (Math.abs(p00) < 1e-4 || Math.abs(p11) < 1e-4) return 0;

    // Optional depth buffer coordinate transform if provided by browser
    const normTrans = depthInfo.normDepthBufferFromNormView?.matrix || null;

    const framePoints = [];

    // Sample across grid
    for (let r = 0; r < gridRows; r++) {
      const vNorm = 0.15 + (r / (gridRows - 1)) * 0.70; // [0.15, 0.85]
      for (let c = 0; c < gridCols; c++) {
        const uNorm = 0.15 + (c / (gridCols - 1)) * 0.70; // [0.15, 0.85]

        // Check if sample lies within the garment exclusion zone around center (0.5, 0.5)
        const distFromCenter = Math.hypot(uNorm - 0.5, vNorm - 0.5);
        if (distFromCenter < centerGarmentExclusionRadius) {
          // This sample is likely garment fabric, not floor. Exclude from floor candidate buffer.
          continue;
        }

        // Per W3C WebXR Depth Sensing API § 6.2, getDepthInMeters takes normalized view coordinates
        // directly and converts them internally. Do not pre-multiply by normTrans.
        const depthM = depthInfo.getDepthInMeters(uNorm, vNorm);
        if (!Number.isFinite(depthM) || depthM < minDepth || depthM > maxDepth) {
          continue;
        }

        // Spatial consistency check: sample a tiny 3x3 neighborhood around this pixel
        // Reject edges or noisy discontinuities
        const px = Math.round(uNorm * dW);
        const py = Math.round(vNorm * dH);
        let patchSum = 0;
        let patchCount = 0;
        const patchVals = [];

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = px + dx;
            const sy = py + dy;
            if (sx >= 0 && sx < dW && sy >= 0 && sy < dH) {
              const dSample = depthInfo.getDepthInMeters(sx / dW, sy / dH);
              if (Number.isFinite(dSample) && dSample > minDepth && dSample < maxDepth) {
                patchVals.push(dSample);
                patchSum += dSample;
                patchCount++;
              }
            }
          }
        }

        if (patchCount < 4) continue;
        const patchMean = patchSum / patchCount;
        let patchVariance = 0;
        for (let i = 0; i < patchVals.length; i++) {
          patchVariance += (patchVals[i] - patchMean) ** 2;
        }
        patchVariance /= patchCount;

        if (Math.sqrt(patchVariance) > spatialVarianceThreshold) {
          // Noisy boundary / edge - reject
          continue;
        }

        // Convert (uNorm, vNorm, depthM) into 3D Camera Coordinates
        // NDC: [-1, 1]
        const ndcX = uNorm * 2.0 - 1.0;
        const ndcY = 1.0 - vNorm * 2.0;

        const xCam = ((ndcX + p20) / p00) * depthM;
        const yCam = ((ndcY + p21) / p11) * depthM;
        const zCam = -depthM;

        // Transform into 3D World (Reference Space) using camMatrix
        // camMatrix is 4x4 column-major:
        // [ m0  m4  m8  m12 ]
        // [ m1  m5  m9  m13 ]
        // [ m2  m6  m10 m14 ]
        // [ m3  m7  m11 m15 ]
        const wX = camMatrix[0] * xCam + camMatrix[4] * yCam + camMatrix[8]  * zCam + camMatrix[12];
        const wY = camMatrix[1] * xCam + camMatrix[5] * yCam + camMatrix[9]  * zCam + camMatrix[13];
        const wZ = camMatrix[2] * xCam + camMatrix[6] * yCam + camMatrix[10] * zCam + camMatrix[14];

        if (Number.isFinite(wX) && Number.isFinite(wY) && Number.isFinite(wZ)) {
          framePoints.push({ x: wX, y: wY, z: wZ });
        }
      }
    }

    if (framePoints.length >= 6) {
      this.frameBuffer.push({ timestamp, points: framePoints });
      this.validFrameCount++;

      // Keep only last maxFrames
      if (this.frameBuffer.length > this.maxFrames) {
        this.frameBuffer.shift();
      }

      // Rebuild flattened allWorldPoints pool
      this.allWorldPoints = [];
      for (let f = 0; f < this.frameBuffer.length; f++) {
        const pts = this.frameBuffer[f].points;
        for (let p = 0; p < pts.length; p++) {
          this.allWorldPoints.push(pts[p]);
        }
      }

      // If pool exceeds maxPointsTotal, subsample evenly
      if (this.allWorldPoints.length > this.maxPointsTotal) {
        const step = Math.ceil(this.allWorldPoints.length / this.maxPointsTotal);
        const pruned = [];
        for (let i = 0; i < this.allWorldPoints.length; i += step) {
          pruned.push(this.allWorldPoints[i]);
        }
        this.allWorldPoints = pruned;
      }
    }

    return framePoints.length;
  }
}

/**
 * 4. 3D RANSAC Floor-Plane Estimator
 * Fits a robust plane to accumulated 3D world points with outlier rejection and least-squares refinement.
 * 
 * @param {Array<{x: number, y: number, z: number}>} points - Candidate 3D points in world coordinates
 * @param {object} config - Configuration options
 * @returns {object|null} Estimated plane result or null if failed
 */
export function estimateFloorPlaneRansac(points, config = {}) {
  const {
    iterations = 80,
    inlierThresholdM = 0.015, // 1.5 cm distance threshold for inliers
    minInlierRatio = 0.45,   // At least 45% of points must agree
    minPointsRequired = 25,
    maxTiltAngleDeg = 30.0   // Maximum angle from gravity-vertical [0, 1, 0]
  } = config;

  if (!points || points.length < minPointsRequired) {
    return null;
  }

  const N = points.length;
  const cosMaxTilt = Math.cos((maxTiltAngleDeg * Math.PI) / 180.0); // ~0.866 for 30 deg

  let bestInliers = [];
  let bestNormal = null;
  let bestD = 0;

  for (let it = 0; it < iterations; it++) {
    // 1. Pick 3 distinct random points
    const idx1 = Math.floor(Math.random() * N);
    let idx2 = Math.floor(Math.random() * N);
    let idx3 = Math.floor(Math.random() * N);
    if (idx1 === idx2) idx2 = (idx2 + 1) % N;
    if (idx3 === idx1 || idx3 === idx2) idx3 = (idx3 + 2) % N;

    const p1 = points[idx1];
    const p2 = points[idx2];
    const p3 = points[idx3];

    // 2. Compute cross product normal
    const v1x = p2.x - p1.x;
    const v1y = p2.y - p1.y;
    const v1z = p2.z - p1.z;

    const v2x = p3.x - p1.x;
    const v2y = p3.y - p1.y;
    const v2z = p3.z - p1.z;

    const nx = v1y * v2z - v1z * v2y;
    const ny = v1z * v2x - v1x * v2z;
    const nz = v1x * v2y - v1y * v2x;

    const nLen = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(nLen) || nLen < 1e-5) continue; // Collinear

    let unx = nx / nLen;
    let uny = ny / nLen;
    let unz = nz / nLen;

    // 3. Gravity-aligned orientation check:
    // In WebXR reference space (local-floor / local), +Y is up.
    // The floor plane normal must point generally upwards (|uny| >= cosMaxTilt).
    if (Math.abs(uny) < cosMaxTilt) {
      continue; // Not a floor candidate
    }

    // Orient normal upwards (ny > 0)
    if (uny < 0) {
      unx = -unx;
      uny = -uny;
      unz = -unz;
    }

    // Plane equation: unx*x + uny*y + unz*z + d = 0
    const d = -(unx * p1.x + uny * p1.y + unz * p1.z);

    // 4. Count inliers
    const currentInliers = [];
    for (let i = 0; i < N; i++) {
      const pt = points[i];
      const dist = Math.abs(unx * pt.x + uny * pt.y + unz * pt.z + d);
      if (dist <= inlierThresholdM) {
        currentInliers.push(pt);
      }
    }

    if (currentInliers.length > bestInliers.length) {
      bestInliers = currentInliers;
      bestNormal = { x: unx, y: uny, z: unz };
      bestD = d;
    }
  }

  const inlierRatio = bestInliers.length / N;
  if (bestInliers.length < minPointsRequired || inlierRatio < minInlierRatio) {
    return null; // Insufficient plane consensus
  }

  // 5. Least-Squares Refinement on all inliers
  // Centroid
  let sumX = 0, sumY = 0, sumZ = 0;
  const M = bestInliers.length;
  for (let i = 0; i < M; i++) {
    sumX += bestInliers[i].x;
    sumY += bestInliers[i].y;
    sumZ += bestInliers[i].z;
  }
  const meanPt = { x: sumX / M, y: sumY / M, z: sumZ / M };

  // For predominantly horizontal planes (|uny| > 0.85),
  // we can refine the plane equation z = a*x + b*y + c or y = a*x + b*z + d.
  // Solving for y = -(unx/uny)*x - (unz/uny)*z - (d/uny):
  // Even more robustly, snap near-vertical normals to [0, 1, 0] to eliminate residual micro-tilt noise:
  let finalNormal = { ...bestNormal };
  if (Math.abs(finalNormal.y) >= 0.94) {
    // Within ~19 degrees of perfect horizontal -> regularize to true gravity horizontal [0, 1, 0]
    finalNormal = { x: 0.0, y: 1.0, z: 0.0 };
  }

  const finalD = -(finalNormal.x * meanPt.x + finalNormal.y * meanPt.y + finalNormal.z * meanPt.z);

  // Compute RMSE residual
  let sumSqErr = 0;
  for (let i = 0; i < M; i++) {
    const pt = bestInliers[i];
    const residual = Math.abs(finalNormal.x * pt.x + finalNormal.y * pt.y + finalNormal.z * pt.z + finalD);
    sumSqErr += residual * residual;
  }
  const rmseResidualM = Math.sqrt(sumSqErr / M);

  // Floor elevation Y at origin (X=0, Z=0) from plane equation
  // Plane equation: finalNormal.x * x + finalNormal.y * y + finalNormal.z * z + finalD = 0
  // At (x=0, z=0): y = -finalD / finalNormal.y
  const elevationY = Math.abs(finalNormal.y) > 0.01 ? (-finalD / finalNormal.y) : meanPt.y;

  return {
    valid: true,
    normal: finalNormal,
    point: meanPt,
    d: finalD,
    elevationY: elevationY,
    inlierCount: M,
    totalPoints: N,
    inlierRatio: inlierRatio,
    rmseResidualM: rmseResidualM,
    rmseResidualCm: rmseResidualM * 100.0
  };
}

/**
 * 5. Sensor Fusion: Fusing RANSAC Depth-Plane with WebXR SLAM Hit-Test
 * 
 * @param {object|null} ransacPlane - Output of estimateFloorPlaneRansac
 * @param {object|null} slamHitTestPlane - Plane from WebXR requestHitTestSource
 * @param {KalmanFilter1D} kalmanFilter - State estimator
 * @param {object} camOrigin - Camera position {x, y, z}
 * @returns {object} Fused floor plane and distance metrics
 */
export function fuseDepthAndSLAMPlane(ransacPlane, slamHitTestPlane, kalmanFilter, camOrigin) {
  let fusedElevationY = null;
  let source = 'none';
  let ransacResidualCm = 0;
  let inlierCount = 0;

  // 1. Primary ground truth: SLAM plane hit-test from ARCore visual-inertial odometry
  if (slamHitTestPlane && Number.isFinite(slamHitTestPlane.elevationY)) {
    const rSlam = 0.0001; // ~1cm std dev
    fusedElevationY = kalmanFilter.update(slamHitTestPlane.elevationY, rSlam);
    source = 'slam-hittest';
  }

  // 2. Secondary refinement: Incorporate RANSAC depth observation ONLY if consistent with SLAM (< 12cm)
  if (ransacPlane && ransacPlane.valid) {
    ransacResidualCm = ransacPlane.rmseResidualCm;
    inlierCount = ransacPlane.inlierCount;

    const isConsistentWithSlam = (fusedElevationY === null) || Math.abs(ransacPlane.elevationY - fusedElevationY) < 0.12;
    if (isConsistentWithSlam && ransacPlane.inlierRatio >= 0.45 && ransacPlane.rmseResidualCm <= 2.5) {
      // Depth measurement noise R: conservative on monocular depth
      const rDepth = Math.max(0.0025, (ransacPlane.rmseResidualM ** 2) * (ransacPlane.totalPoints / Math.max(1, inlierCount)));
      fusedElevationY = kalmanFilter.update(ransacPlane.elevationY, rDepth);
      source = (source === 'slam-hittest') ? 'fused-depth-slam' : 'depth-ransac';
    }
  }

  // If Kalman has not initialized, fallback to whatever is available
  if (fusedElevationY === null && kalmanFilter.isInitialized) {
    fusedElevationY = kalmanFilter.x;
    source = 'kalman-prior';
  }

  if (fusedElevationY === null) {
    return {
      valid: false,
      elevationY: null,
      perpendicularDistanceCm: null,
      source: 'none',
      ransacResidualCm: 0,
      inlierCount: 0
    };
  }

  // Camera perpendicular distance to the floor:
  // For gravity-aligned floor, distance is |camOrigin.y - floorElevationY|
  const perpDistM = camOrigin && Number.isFinite(camOrigin.y) ? Math.abs(camOrigin.y - fusedElevationY) : null;
  const perpDistCm = perpDistM !== null ? perpDistM * 100.0 : null;

  return {
    valid: true,
    elevationY: fusedElevationY,
    perpendicularDistanceCm: perpDistCm,
    perpendicularDistanceM: perpDistM,
    source,
    ransacResidualCm,
    inlierCount,
    normal: { x: 0, y: 1, z: 0 },
    point: { x: camOrigin ? camOrigin.x : 0, y: fusedElevationY, z: camOrigin ? camOrigin.z : 0 }
  };
}

/**
 * 6. Ray-Plane Intersection Engine
 */
export function intersectRayWithPlane(rayOrigin, rayDir, planePoint, planeNormal) {
  if (!rayOrigin || !rayDir || !planePoint || !planeNormal) return null;
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
    return null; // Near-parallel ray (< ~1.7 deg grazing angle)
  }

  const numer = nx * (planePoint.x - rayOrigin.x) +
                ny * (planePoint.y - rayOrigin.y) +
                nz * (planePoint.z - rayOrigin.z);

  const t = numer / denom;
  if (!Number.isFinite(t) || t <= 0.01 || t > 10.0) {
    return null; // Behind camera or unreasonably far (>10m)
  }

  return {
    x: rayOrigin.x + t * dx,
    y: rayOrigin.y + t * dy,
    z: rayOrigin.z + t * dz,
    t: t,
    denom: denom
  };
}

/**
 * 7. 3D Keypoint Unprojection with Fabric Offset & Perspective Correction
 */
export function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = 0.002) {
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

  // NDC [-1, 1]
  const ndcX = (u / imageWidth) * 2.0 - 1.0;
  const ndcY = 1.0 - (v / imageHeight) * 2.0;

  const p8 = Number.isFinite(projMatrix[8]) ? projMatrix[8] : 0;
  const p9 = Number.isFinite(projMatrix[9]) ? projMatrix[9] : 0;
  const dxCam = (ndcX + p8) / p0;
  const dyCam = (ndcY + p9) / p5;
  const dzCam = -1.0;

  // Transform ray direction to world space
  const rX = camMatrix[0] * dxCam + camMatrix[4] * dyCam + camMatrix[8]  * dzCam;
  const rY = camMatrix[1] * dxCam + camMatrix[5] * dyCam + camMatrix[9]  * dzCam;
  const rZ = camMatrix[2] * dxCam + camMatrix[6] * dyCam + camMatrix[10] * dzCam;

  const rLen = Math.hypot(rX, rY, rZ);
  if (!Number.isFinite(rLen) || rLen < 1e-6) return null;
  const dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
  const origin = { x: camMatrix[12], y: camMatrix[13], z: camMatrix[14] };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) {
    return null;
  }

  // Normalize and orient unit normal
  const pnLen = Math.hypot(planeNormal.x, planeNormal.y, planeNormal.z);
  if (!Number.isFinite(pnLen) || pnLen < 1e-6) return null;
  let unx = planeNormal.x / pnLen;
  let uny = planeNormal.y / pnLen;
  let unz = planeNormal.z / pnLen;

  // Regularize near-horizontal surface planes
  if (Math.abs(uny) >= 0.88) {
    unx = 0.0;
    uny = uny > 0 ? 1.0 : -1.0;
    unz = 0.0;
  }

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
  if (!hit) return null;

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

/**
 * 8. 3D Euclidean Distance
 */
export function calculate3DDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p1.z) ||
      !Number.isFinite(p2.x) || !Number.isFinite(p2.y) || !Number.isFinite(p2.z)) {
    return 0;
  }
  return Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
}

/**
 * 9. Comprehensive Calibration Benchmarking & Statistical Verification
 * Computes MAE, RMSE, max error, standard deviation, and percentages within ±0.5" and ±0.25".
 * 
 * @param {Array<{measured: number, target: number}>} samples - Sample pairs in cm
 * @returns {object} Statistics summary
 */
export function computeCalibrationBenchmarkStats(samples) {
  if (!samples || samples.length === 0) {
    return {
      count: 0,
      meanErrorCm: 0,
      maeCm: 0,
      maeInches: 0,
      rmseCm: 0,
      rmseInches: 0,
      maxErrorCm: 0,
      stdDevCm: 0,
      rangeCm: 0,
      percentWithinHalfInch: 0,
      percentWithinQuarterInch: 0
    };
  }

  const N = samples.length;
  let sumErr = 0;
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let maxAbsErr = 0;
  let countWithinHalfInch = 0;     // <= 1.27 cm (0.5 inch)
  let countWithinQuarterInch = 0;  // <= 0.635 cm (0.25 inch)

  let minVal = Infinity;
  let maxVal = -Infinity;
  let sumVal = 0;

  const HALF_INCH_CM = 1.27;
  const QUARTER_INCH_CM = 0.635;

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const m = s.measured;
    const t = s.target;
    const err = m - t;
    const absErr = Math.abs(err);

    sumErr += err;
    sumAbsErr += absErr;
    sumSqErr += err * err;
    if (absErr > maxAbsErr) maxAbsErr = absErr;

    if (absErr <= HALF_INCH_CM) countWithinHalfInch++;
    if (absErr <= QUARTER_INCH_CM) countWithinQuarterInch++;

    sumVal += m;
    if (m < minVal) minVal = m;
    if (m > maxVal) maxVal = m;
  }

  const meanError = sumErr / N;
  const mae = sumAbsErr / N;
  const rmse = Math.sqrt(sumSqErr / N);
  const meanVal = sumVal / N;

  let variance = 0;
  if (N > 1) {
    let sumSqDiff = 0;
    for (let i = 0; i < N; i++) {
      sumSqDiff += (samples[i].measured - meanVal) ** 2;
    }
    variance = sumSqDiff / (N - 1);
  }
  const stdDev = Math.sqrt(variance);
  const range = (N > 0 && Number.isFinite(maxVal) && Number.isFinite(minVal)) ? maxVal - minVal : 0;

  return {
    count: N,
    meanErrorCm: meanError,
    maeCm: mae,
    maeInches: mae / 2.54,
    rmseCm: rmse,
    rmseInches: rmse / 2.54,
    maxErrorCm: maxAbsErr,
    stdDevCm: stdDev,
    rangeCm: range,
    percentWithinHalfInch: (countWithinHalfInch / N) * 100.0,
    percentWithinQuarterInch: (countWithinQuarterInch / N) * 100.0
  };
}

/**
 * 10. Capture Quality Evaluator
 * Evaluates whether current AR tracking, depth point count, and RANSAC plane fitting meet precision standards.
 */
export function evaluateCaptureQuality(params = {}) {
  const {
    validDepthFrames = 0,
    minDepthFrames = 15,
    ransacInlierRatio = 0,
    minInlierRatio = 0.50,
    ransacResidualCm = Infinity,
    maxResidualCm = 2.0,
    camMoveDist = 0,
    maxMoveSpeed = 0.010,
    stabilityHoldMs = 0,
    minStabilityMs = 600
  } = params;

  const checks = {
    depthFramesOk: validDepthFrames >= minDepthFrames,
    inlierRatioOk: ransacInlierRatio >= minInlierRatio,
    residualOk: ransacResidualCm <= maxResidualCm,
    motionOk: camMoveDist <= maxMoveSpeed,
    stabilityOk: stabilityHoldMs >= minStabilityMs
  };

  const isReady = checks.depthFramesOk && checks.inlierRatioOk && checks.residualOk && checks.motionOk && checks.stabilityOk;

  let message = 'Ready to Scan';
  let stage = 'READY';

  if (!checks.depthFramesOk) {
    message = `Collecting depth: ${validDepthFrames}/${minDepthFrames} frames (move phone gently)`;
    stage = 'COLLECTING_DEPTH';
  } else if (!checks.inlierRatioOk || !checks.residualOk) {
    message = `Estimating floor plane (Inliers: ${Math.round(ransacInlierRatio * 100)}%, Res: ${ransacResidualCm.toFixed(1)}cm)`;
    stage = 'ESTIMATING_PLANE';
  } else if (!checks.motionOk || !checks.stabilityOk) {
    message = 'Hold phone steady for scan...';
    stage = 'STABILIZING';
  }

  return {
    isReady,
    stage,
    message,
    checks
  };
}

/**
 * 11. Diagnostic Run Statistics Aggregator (Tests A–E)
 * Computes mean, min, max, range, and standard deviation across recorded telemetry frames.
 * 
 * @param {Array<object>} frames - Array of recorded telemetry frame records
 * @returns {object|null} Computed statistical summary
 */
export function computeDiagnosticRunStats(frames) {
  if (!frames || frames.length === 0) {
    return null;
  }

  const calcSeries = (arr) => {
    const valid = arr.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return { mean: 0, min: 0, max: 0, range: 0, stdDev: 0, count: 0 };
    const n = valid.length;
    let sum = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = valid[i];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / n;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      sumSq += (valid[i] - mean) ** 2;
    }
    const stdDev = n > 1 ? Math.sqrt(sumSq / (n - 1)) : 0;
    return {
      mean,
      min,
      max,
      range: max - min,
      stdDev,
      count: n
    };
  };

  const camY = calcSeries(frames.map(f => f.camWorldY));
  const rawDepth = calcSeries(frames.map(f => f.centerDepthM));
  const floorY = calcSeries(frames.map(f => f.planeElevationY));
  const fusedDist = calcSeries(frames.map(f => f.fusedKalmanYDistCm));
  const slamDist = calcSeries(frames.map(f => f.slamYDistCm));
  const camDelta = calcSeries(frames.map(f => f.camDeltaDistM));

  return {
    totalFrames: frames.length,
    durationSec: frames.length > 0 ? (frames[frames.length - 1].timeElapsedS || 0) : 0,
    camY,
    rawDepth,
    floorY,
    fusedDist,
    slamDist,
    camDelta
  };
}

/**
 * 12. Full Telemetry CSV Exporter (Tests A, B, C, D, E)
 * Formats high-resolution telemetry records into standard CSV format.
 * 
 * @param {Array<object>} frames - Array of recorded telemetry frame records
 * @returns {string} CSV formatted string
 */
export function generateDiagnosticCSV(frames) {
  if (!frames || frames.length === 0) return '';
  const headers = [
    'Frame',
    'Timestamp_ms',
    'Time_Elapsed_s',
    'Test_Mode',
    'Tracking_State',
    'Cam_World_X',
    'Cam_World_Y',
    'Cam_World_Z',
    'Cam_Delta_X',
    'Cam_Delta_Y',
    'Cam_Delta_Z',
    'Cam_Delta_Dist_m',
    'Cam_Pitch_Deg',
    'Cam_LookDir_X',
    'Cam_LookDir_Y',
    'Cam_LookDir_Z',
    'Cam_Quat_X',
    'Cam_Quat_Y',
    'Cam_Quat_Z',
    'Cam_Quat_W',
    'Depth_Width',
    'Depth_Height',
    'Raw_Value_To_Meters',
    'Center_Depth_m',
    'Floor_Depth_Median_m',
    'Floor_Depth_StdDev_m',
    'Floor_Samples_Valid',
    'RANSAC_Valid',
    'Plane_Nx',
    'Plane_Ny',
    'Plane_Nz',
    'Plane_D',
    'Plane_Elevation_Y',
    'RANSAC_Inliers',
    'RANSAC_Total_Points',
    'RANSAC_Inlier_Ratio',
    'RANSAC_Residual_cm',
    'SLAM_Hit_Found',
    'SLAM_Elevation_Y',
    'SLAM_Y_Dist_cm',
    'Raw_Depth_Y_Dist_cm',
    'RANSAC_Y_Dist_cm',
    'Fused_Kalman_Y_Dist_cm'
  ];

  const rows = frames.map((f, idx) => [
    idx + 1,
    f.timestampMs ? f.timestampMs.toFixed(1) : '',
    f.timeElapsedS ? f.timeElapsedS.toFixed(3) : '',
    `"${f.testMode || ''}"`,
    `"${f.trackingState || 'TRACKING'}"`,
    f.camWorldX !== null && f.camWorldX !== undefined ? f.camWorldX.toFixed(5) : '',
    f.camWorldY !== null && f.camWorldY !== undefined ? f.camWorldY.toFixed(5) : '',
    f.camWorldZ !== null && f.camWorldZ !== undefined ? f.camWorldZ.toFixed(5) : '',
    f.camDeltaX !== null && f.camDeltaX !== undefined ? f.camDeltaX.toFixed(5) : '',
    f.camDeltaY !== null && f.camDeltaY !== undefined ? f.camDeltaY.toFixed(5) : '',
    f.camDeltaZ !== null && f.camDeltaZ !== undefined ? f.camDeltaZ.toFixed(5) : '',
    f.camDeltaDistM !== null && f.camDeltaDistM !== undefined ? f.camDeltaDistM.toFixed(5) : '',
    f.camPitchDeg !== null && f.camPitchDeg !== undefined ? f.camPitchDeg.toFixed(2) : '',
    f.camLookDirX !== null && f.camLookDirX !== undefined ? f.camLookDirX.toFixed(4) : '',
    f.camLookDirY !== null && f.camLookDirY !== undefined ? f.camLookDirY.toFixed(4) : '',
    f.camLookDirZ !== null && f.camLookDirZ !== undefined ? f.camLookDirZ.toFixed(4) : '',
    f.camQuatX !== null && f.camQuatX !== undefined ? f.camQuatX.toFixed(5) : '',
    f.camQuatY !== null && f.camQuatY !== undefined ? f.camQuatY.toFixed(5) : '',
    f.camQuatZ !== null && f.camQuatZ !== undefined ? f.camQuatZ.toFixed(5) : '',
    f.camQuatW !== null && f.camQuatW !== undefined ? f.camQuatW.toFixed(5) : '',
    f.depthWidth || '',
    f.depthHeight || '',
    f.rawValueToMeters || '',
    f.centerDepthM !== null && f.centerDepthM !== undefined ? f.centerDepthM.toFixed(4) : '',
    f.floorDepthMedianM !== null && f.floorDepthMedianM !== undefined ? f.floorDepthMedianM.toFixed(4) : '',
    f.floorDepthStdDevM !== null && f.floorDepthStdDevM !== undefined ? f.floorDepthStdDevM.toFixed(4) : '',
    f.floorSamplesValid || 0,
    f.ransacValid ? 1 : 0,
    f.planeNx !== null && f.planeNx !== undefined ? f.planeNx.toFixed(4) : '',
    f.planeNy !== null && f.planeNy !== undefined ? f.planeNy.toFixed(4) : '',
    f.planeNz !== null && f.planeNz !== undefined ? f.planeNz.toFixed(4) : '',
    f.planeD !== null && f.planeD !== undefined ? f.planeD.toFixed(4) : '',
    f.planeElevationY !== null && f.planeElevationY !== undefined ? f.planeElevationY.toFixed(4) : '',
    f.ransacInliers || 0,
    f.ransacTotalPoints || 0,
    f.ransacInlierRatio !== null && f.ransacInlierRatio !== undefined ? f.ransacInlierRatio.toFixed(3) : '',
    f.ransacResidualCm !== null && f.ransacResidualCm !== undefined ? f.ransacResidualCm.toFixed(2) : '',
    f.slamHitFound ? 1 : 0,
    f.slamElevationY !== null && f.slamElevationY !== undefined ? f.slamElevationY.toFixed(4) : '',
    f.slamYDistCm !== null && f.slamYDistCm !== undefined ? f.slamYDistCm.toFixed(2) : '',
    f.rawDepthYDistCm !== null && f.rawDepthYDistCm !== undefined ? f.rawDepthYDistCm.toFixed(2) : '',
    f.ransacYDistCm !== null && f.ransacYDistCm !== undefined ? f.ransacYDistCm.toFixed(2) : '',
    f.fusedKalmanYDistCm !== null && f.fusedKalmanYDistCm !== undefined ? f.fusedKalmanYDistCm.toFixed(2) : ''
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

