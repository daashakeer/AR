/**
 * AR Measurement MVP - Core Application
 * Pure Vanilla JavaScript (ES6 Modules)
 * 
 * Implements:
 * 1. WebXR 'immersive-ar' session management with 'hit-test' and 'dom-overlay'.
 * 2. Automatic surface detection via continuous ARCore hit-testing.
 * 3. Metric 3D planar surface point generation and farthest-pair distance maximization.
 * 4. Instantaneous camera frame capture synchronized with the 3D AR pose.
 * 5. 3D-to-2D camera calibration projection matrix mathematics.
 * 6. Pixel distance, metric distance, and meters/pixel ratio calculations.
 * 7. Results preview with annotated / original image toggle and JSON/PNG export.
 */

// Global State
const state = {
  xrSession: null,
  xrRefSpace: null,
  xrViewerSpace: null,
  hitTestSource: null,
  gl: null,
  glBinding: null,
  
  // Surface Point Tracking
  detectedSurfacePoints: [], // { x, y, z, normal, timestamp }
  lastHitPose: null,
  pointA: null, // { x, y, z } in meters
  pointB: null, // { x, y, z } in meters
  currentRealDistanceMeters: 0,
  
  // Capture State
  captureRequested: false,
  isSimulator: false,
  simulatorInterval: null,
  simVideo: null,
  
  // Captured Results
  captureResult: null,
  originalImageBlob: null,
  originalImageDataUrl: null,
  annotatedImageDataUrl: null,
  
  // View mode in results
  currentViewMode: 'annotated' // 'annotated' | 'original'
};

// DOM Elements
const elements = {
  screenLanding: document.getElementById('screen-landing'),
  screenResults: document.getElementById('screen-results'),
  arContainer: document.getElementById('ar-container'),
  arCanvas: document.getElementById('ar-canvas'),
  arOverlay: document.getElementById('ar-overlay'),
  
  // Landing Badges & Buttons
  badgeWebXR: document.getElementById('badge-webxr'),
  badgeAR: document.getElementById('badge-ar'),
  badgeHitTest: document.getElementById('badge-hittest'),
  compatibilityMessage: document.getElementById('compatibility-message'),
  btnStartScan: document.getElementById('btn-start-scan'),
  btnStartSim: document.getElementById('btn-start-sim'),
  
  // AR HUD
  hudTrackingDot: document.getElementById('hud-tracking-dot'),
  hudTrackingText: document.getElementById('hud-tracking-text'),
  hudDistanceVal: document.getElementById('hud-distance-val'),
  hudReticleHint: document.getElementById('hud-reticle-hint'),
  markerA: document.getElementById('marker-a'),
  markerB: document.getElementById('marker-b'),
  markerACoords: document.getElementById('marker-a-coords'),
  markerBCoords: document.getElementById('marker-b-coords'),
  svgMeasureLine: document.getElementById('svg-measure-line'),
  btnCapture: document.getElementById('btn-capture'),
  captureHint: document.getElementById('capture-hint'),
  btnExitAR: document.getElementById('btn-exit-ar'),
  
  // Results Elements
  btnBackScan: document.getElementById('btn-back-scan'),
  resultStatusBadge: document.getElementById('result-status-badge'),
  btnViewAnnotated: document.getElementById('btn-view-annotated'),
  btnViewOriginal: document.getElementById('btn-view-original'),
  resultCanvas: document.getElementById('result-canvas'),
  resultImgDimensions: document.getElementById('result-img-dimensions'),
  resultTimestamp: document.getElementById('result-timestamp'),
  resRealDist: document.getElementById('res-real-dist'),
  resRealDistCm: document.getElementById('res-real-dist-cm'),
  resPixelDist: document.getElementById('res-pixel-dist'),
  resMPerPx: document.getElementById('res-m-per-px'),
  resPxPerM: document.getElementById('res-px-per-m'),
  resPointAPx: document.getElementById('res-point-a-px'),
  resPointA3D: document.getElementById('res-point-a-3d'),
  resPointBPx: document.getElementById('res-point-b-px'),
  resPointB3D: document.getElementById('res-point-b-3d'),
  accuracyNotice: document.getElementById('accuracy-notice'),
  accuracyExplanation: document.getElementById('accuracy-explanation'),
  btnDownloadImg: document.getElementById('btn-download-img'),
  btnDownloadJson: document.getElementById('btn-download-json')
};

/* ==========================================================================
   1. Compatibility & Capability Detection
   ========================================================================== */

async function checkCompatibility() {
  const isSecure = window.isSecureContext;
  if (!isSecure) {
    elements.compatibilityMessage.innerHTML = 
      `<strong style="color:var(--accent-red)">HTTPS Required:</strong> WebXR requires a secure HTTPS connection or localhost. Please open via HTTPS.`;
    updateBadge(elements.badgeWebXR, 'Insecure Context', 'error');
    return;
  }

  if (!('xr' in navigator)) {
    updateBadge(elements.badgeWebXR, 'WebXR: Unsupported', 'error');
    updateBadge(elements.badgeAR, 'AR: Unavailable', 'error');
    updateBadge(elements.badgeHitTest, 'Hit-Test: N/A', 'error');
    elements.compatibilityMessage.innerHTML = 
      `This browser does not support the <strong>WebXR Device API</strong>.<br>` +
      `Native AR is supported on <strong>Google Chrome on Android</strong> with ARCore installed.<br>` +
      `You can test all measurement, projection, capture, and export features using <strong>WebXR Emulator Mode</strong> below.`;
    return;
  }

  updateBadge(elements.badgeWebXR, 'WebXR: Available', 'success');

  try {
    const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
    if (isArSupported) {
      updateBadge(elements.badgeAR, 'AR: Supported', 'success');
      updateBadge(elements.badgeHitTest, 'Hit-Test: Supported', 'success');
      elements.compatibilityMessage.innerHTML = 
        `AR hardware detected and ready. Click <strong>Start Scan</strong> to begin automatic surface measurement.`;
      elements.btnStartScan.disabled = false;
    } else {
      updateBadge(elements.badgeAR, 'AR: Unsupported', 'error');
      updateBadge(elements.badgeHitTest, 'Hit-Test: N/A', 'error');
      elements.compatibilityMessage.innerHTML = 
        `WebXR is present, but <strong>immersive-ar</strong> mode is unavailable on this device.<br>` +
        `Ensure Google Play Services for AR (ARCore) is installed, or test with the <strong>WebXR Emulator Mode</strong>.`;
    }
  } catch (err) {
    updateBadge(elements.badgeAR, 'AR: Error', 'error');
    elements.compatibilityMessage.textContent = `Capability check error: ${err.message}`;
  }
}

function updateBadge(badgeEl, text, statusClass) {
  badgeEl.textContent = text;
  badgeEl.className = `badge ${statusClass}`;
}

/* ==========================================================================
   2. WebXR AR Session Lifecycle
   ========================================================================== */

async function startARSession() {
  try {
    state.isSimulator = false;

    // IMPORTANT: Make AR container visible BEFORE creating WebXR session with dom-overlay!
    // Chrome throws NotSupportedError if domOverlay.root has display: none
    elements.screenLanding.classList.add('hidden');
    elements.screenResults.classList.add('hidden');
    elements.arContainer.classList.remove('hidden');

    // Set up WebGL Context for WebXR Rendering
    const canvas = elements.arCanvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) {
      gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: true, preserveDrawingBuffer: true });
    }
    if (!gl) {
      throw new Error('Could not create WebGL context');
    }
    state.gl = gl;

    // MANDATORY WebXR step: await makeXRCompatible() before creating XRWebGLLayer
    if (gl.makeXRCompatible) {
      await gl.makeXRCompatible();
    }

    // Session options with dom-overlay and hit-test
    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: elements.arOverlay }
    };

    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    } catch (reqErr) {
      console.warn('Initial session request with required hit-test failed, trying optional fallback:', reqErr);
      // Fallback: request with optionalFeatures
      session = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'],
        domOverlay: { root: elements.arOverlay }
      });
    }

    state.xrSession = session;

    // Connect WebGL Layer to Session
    session.updateRenderState({
      baseLayer: new XRWebGLLayer(session, gl)
    });

    // Reference Spaces: try local, fallback to local-floor, then viewer
    let refSpace = null;
    for (const type of ['local', 'local-floor', 'viewer']) {
      try {
        refSpace = await session.requestReferenceSpace(type);
        if (refSpace) break;
      } catch (e) {
        // Continue to next space
      }
    }
    if (!refSpace) {
      throw new Error('Could not acquire reference space');
    }
    state.xrRefSpace = refSpace;

    const viewerSpace = await session.requestReferenceSpace('viewer');
    state.xrViewerSpace = viewerSpace;

    // Request primary hit-test source
    try {
      const hitSource = await session.requestHitTestSource({ space: viewerSpace });
      state.hitTestSource = hitSource;
    } catch (htErr) {
      console.warn('Hit-test source creation error:', htErr);
    }

    session.addEventListener('end', onSessionEnded);

    // Reset surface tracking
    state.detectedSurfacePoints = [];
    state.pointA = null;
    state.pointB = null;
    state.currentRealDistanceMeters = 0;
    updateHUDStatus(false, 0, 0);

    // Start WebXR Frame Loop
    session.requestAnimationFrame(onXRFrame);

  } catch (err) {
    console.error('Failed to start WebXR session:', err);
    // Restore landing screen
    elements.arContainer.classList.add('hidden');
    elements.screenLanding.classList.remove('hidden');
    alert(`Could not start AR session: ${err.message}\n\nTip: You can use "Test in WebXR Emulator Mode" to test on any desktop or mobile browser.`);
  }
}

function onSessionEnded() {
  state.xrSession = null;
  state.hitTestSource = null;
  state.glBinding = null;
  
  elements.arContainer.classList.add('hidden');
  if (!state.captureResult) {
    elements.screenLanding.classList.remove('hidden');
  }
}

function exitAR() {
  if (state.xrSession) {
    state.xrSession.end();
  } else if (state.isSimulator) {
    stopSimulator();
    elements.arContainer.classList.add('hidden');
    elements.screenLanding.classList.remove('hidden');
  }
}

/* ==========================================================================
   3. WebXR Frame Loop & Automatic Surface Detection
   ========================================================================== */

function onXRFrame(time, frame) {
  const session = frame.session;
  session.requestAnimationFrame(onXRFrame);

  const gl = state.gl;
  const refSpace = state.xrRefSpace;
  const baseLayer = session.renderState.baseLayer;
  const pose = frame.getViewerPose(refSpace);

  if (!pose || !baseLayer) {
    updateHUDStatus(false, 0, 0);
    return;
  }

  // Clear WebGL framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const view = pose.views[0];
  if (!view) return;

  // 1. Process Hit Test Results from ARCore
  let surfaceHitFound = false;
  let hitPoint = null;
  let hitNormal = null;

  if (state.hitTestSource) {
    const hitResults = frame.getHitTestResults(state.hitTestSource);
    if (hitResults.length > 0) {
      const hitPose = hitResults[0].getPose(refSpace);
      if (hitPose) {
        surfaceHitFound = true;
        const pos = hitPose.transform.position;
        const matrix = hitPose.transform.matrix;

        hitPoint = { x: pos.x, y: pos.y, z: pos.z };

        // Surface normal from hit orientation matrix column 1 (Y-axis)
        // If length is valid, use it; otherwise default upward (0, 1, 0)
        const ny = matrix[5];
        const nLen = Math.hypot(matrix[4], matrix[5], matrix[6]);
        if (nLen > 0.5) {
          hitNormal = { x: matrix[4] / nLen, y: matrix[5] / nLen, z: matrix[6] / nLen };
        } else {
          hitNormal = { x: 0, y: 1, z: 0 };
        }

        state.lastHitPose = { point: hitPoint, normal: hitNormal, timestamp: time };
      }
    }
  }

  // 2. Continuous Surface Point Collection & Planar Extension
  // When a flat surface hit is confirmed by ARCore:
  // The hit point P0 and normal n define the physical surface plane: n · (P - P0) = 0.
  // We sample points across the visible camera frustum intersecting this real detected plane.
  let activePoints = [];

  if (state.lastHitPose && (time - state.lastHitPose.timestamp < 3000)) {
    const P0 = state.lastHitPose.point;
    const N = state.lastHitPose.normal;

    // Camera world position C from view transform
    const camMatrix = view.transform.matrix;
    const camPos = { x: camMatrix[12], y: camMatrix[13], z: camMatrix[14] };

    // Invert view matrix to get world ray directions from camera space
    const invView = view.transform.matrix; // view.transform.matrix is camera-to-world!

    // Probe 16 normalized directional rays across the camera field of view
    // Spanning from left to right (-0.4 to +0.4) and top to bottom (-0.3 to +0.3)
    const rayAngles = [
      { u: -0.35, v:  0.00 }, // Far Left
      { u:  0.35, v:  0.00 }, // Far Right
      { u:  0.00, v:  0.25 }, // Top
      { u:  0.00, v: -0.25 }, // Bottom
      { u: -0.28, v:  0.20 }, // Top-Left
      { u:  0.28, v:  0.20 }, // Top-Right
      { u: -0.28, v: -0.20 }, // Bottom-Left
      { u:  0.28, v: -0.20 }, // Bottom-Right
      { u: -0.15, v:  0.00 }, // Mid-Left
      { u:  0.15, v:  0.00 }, // Mid-Right
      { u:  0.00, v:  0.00 }  // Center
    ];

    for (const ra of rayAngles) {
      // Local ray in camera space (looking along -Z)
      const lx = ra.u;
      const ly = ra.v;
      const lz = -1.0;
      const lLen = Math.hypot(lx, ly, lz);

      // Transform ray direction to World Space
      const wx = (invView[0] * lx + invView[4] * ly + invView[8]  * lz) / lLen;
      const wy = (invView[1] * lx + invView[5] * ly + invView[9]  * lz) / lLen;
      const wz = (invView[2] * lx + invView[6] * ly + invView[10] * lz) / lLen;

      // Intersect ray with detected surface plane: n · (P - P0) = 0
      // P(t) = C + t * W
      // n · (C + t*W - P0) = 0 => t = (n · (P0 - C)) / (n · W)
      const denom = N.x * wx + N.y * wy + N.z * wz;

      // Ray must face towards the plane
      if (Math.abs(denom) > 1e-4) {
        const numer = N.x * (P0.x - camPos.x) + N.y * (P0.y - camPos.y) + N.z * (P0.z - camPos.z);
        const t = numer / denom;

        // Valid physical distance in front of camera (0.15m to 5.0m)
        if (t > 0.15 && t < 5.0) {
          activePoints.push({
            x: camPos.x + t * wx,
            y: camPos.y + t * wy,
            z: camPos.z + t * wz
          });
        }
      }
    }
  }

  // 3. Select Two Farthest Valid Points on the Detected Surface
  let pointPair = null;
  if (activePoints.length >= 2) {
    pointPair = selectTwoFarthestPoints(activePoints);
  }

  // 4. Update State & HUD Markers
  if (pointPair) {
    state.pointA = pointPair.pointA;
    state.pointB = pointPair.pointB;
    state.currentRealDistanceMeters = pointPair.distanceMeters;

    updateHUDStatus(true, activePoints.length, state.currentRealDistanceMeters);

    // Project points to 2D Screen DOM overlay
    updateOverlayMarkers2D(state.pointA, state.pointB, view);
  } else {
    state.pointA = null;
    state.pointB = null;
    state.currentRealDistanceMeters = 0;
    updateHUDStatus(surfaceHitFound, activePoints.length, 0);
    hideOverlayMarkers2D();
  }

  // 5. Handle Synchronous Frame Capture
  if (state.captureRequested && pointPair) {
    state.captureRequested = false;
    executeSynchronousCapture(frame, pose, state.pointA, state.pointB, state.currentRealDistanceMeters);
  }
}

/**
 * Evaluates all pairs of points on the detected flat surface to find the two farthest points.
 * Calculates physical 3D distance using AR-provided metric coordinates:
 * realDistanceMeters = sqrt((X2 - X1)^2 + (Y2 - Y1)^2 + (Z2 - Z1)^2)
 */
function selectTwoFarthestPoints(points) {
  let maxDistance = 0;
  let bestA = null;
  let bestB = null;

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const p1 = points[i];
      const p2 = points[j];

      // Physical 3D Euclidean distance in metric coordinates
      const dist = Math.sqrt(
        (p2.x - p1.x) ** 2 +
        (p2.y - p1.y) ** 2 +
        (p2.z - p1.z) ** 2
      );

      if (dist > maxDistance) {
        maxDistance = dist;
        bestA = p1;
        bestB = p2;
      }
    }
  }

  if (bestA && bestB && maxDistance > 0.02) { // Minimum 2cm threshold
    // Order consistently: Point A is leftmost or lower X
    if (bestA.x > bestB.x) {
      const tmp = bestA;
      bestA = bestB;
      bestB = tmp;
    }
    return {
      pointA: bestA,
      pointB: bestB,
      distanceMeters: maxDistance
    };
  }

  return null;
}

/* ==========================================================================
   4. 3D-to-2D Projection & Screen Overlay Mathematics
   ========================================================================== */

/**
 * Projects a 3D metric coordinate (X, Y, Z in meters) to 2D image pixel coordinates (xPixel, yPixel)
 * using the camera's view matrix and projection matrix from that specific frame.
 * 
 * 1. World to Camera View space: P_cam = viewMatrix * P_world
 * 2. View to Clip space: P_clip = projectionMatrix * P_cam
 * 3. Clip to NDC: ndc_x = P_clip.x / P_clip.w, ndc_y = P_clip.y / P_clip.w
 * 4. NDC to Image Pixels:
 *    xPixel = ((ndc_x + 1) / 2) * imageWidth
 *    yPixel = ((1 - ndc_y) / 2) * imageHeight
 */
function projectPointToPixel(point3D, viewMatrix, projectionMatrix, imageWidth, imageHeight) {
  const x = point3D.x;
  const y = point3D.y;
  const z = point3D.z;

  // 1. Transform World Point into Camera View Space (Column-Major 4x4 matrix)
  const cx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8]  * z + viewMatrix[12];
  const cy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9]  * z + viewMatrix[13];
  const cz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
  const cw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];

  // Point must be in front of the camera (in view space, z is negative)
  if (cz >= -0.01) {
    return { valid: false, reason: 'Point is behind or too close to camera plane' };
  }

  // 2. Transform Camera View Point into Clip Space
  const clipX = projectionMatrix[0] * cx + projectionMatrix[4] * cy + projectionMatrix[8]  * cz + projectionMatrix[12] * cw;
  const clipY = projectionMatrix[1] * cx + projectionMatrix[5] * cy + projectionMatrix[9]  * cz + projectionMatrix[13] * cw;
  const clipZ = projectionMatrix[2] * cx + projectionMatrix[6] * cy + projectionMatrix[10] * cz + projectionMatrix[14] * cw;
  const clipW = projectionMatrix[3] * cx + projectionMatrix[7] * cy + projectionMatrix[11] * cz + projectionMatrix[15] * cw;

  if (Math.abs(clipW) < 1e-6) {
    return { valid: false, reason: 'Invalid clip coordinate W' };
  }

  // 3. Normalized Device Coordinates (NDC) in range [-1, 1]
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;

  // 4. Map NDC to 2D image pixel coordinates
  const xPixel = Math.round(((ndcX + 1) / 2) * imageWidth);
  const yPixel = Math.round(((1 - ndcY) / 2) * imageHeight);

  const inBounds = (xPixel >= 0 && xPixel <= imageWidth && yPixel >= 0 && yPixel <= imageHeight);

  return {
    valid: true,
    xPixel: xPixel,
    yPixel: yPixel,
    ndcX: ndcX,
    ndcY: ndcY,
    depthMeters: -cz,
    inBounds: inBounds
  };
}

/**
 * Updates DOM Overlay markers in real time during the live AR view
 */
function updateOverlayMarkers2D(ptA, ptB, view) {
  const overlayWidth = window.innerWidth;
  const overlayHeight = window.innerHeight;

  const viewMatrix = view.transform.inverse.matrix;
  const projMatrix = view.projectionMatrix;

  const projA = projectPointToPixel(ptA, viewMatrix, projMatrix, overlayWidth, overlayHeight);
  const projB = projectPointToPixel(ptB, viewMatrix, projMatrix, overlayWidth, overlayHeight);

  if (projA.valid && projB.valid && projA.inBounds && projB.inBounds) {
    elements.markerA.classList.remove('hidden');
    elements.markerB.classList.remove('hidden');

    elements.markerA.style.left = `${projA.xPixel}px`;
    elements.markerA.style.top = `${projA.yPixel}px`;
    elements.markerACoords.textContent = `A (${projA.xPixel}, ${projA.yPixel})`;

    elements.markerB.style.left = `${projB.xPixel}px`;
    elements.markerB.style.top = `${projB.yPixel}px`;
    elements.markerBCoords.textContent = `B (${projB.xPixel}, ${projB.yPixel})`;

    // Draw connecting SVG line
    elements.svgMeasureLine.setAttribute('x1', projA.xPixel);
    elements.svgMeasureLine.setAttribute('y1', projA.yPixel);
    elements.svgMeasureLine.setAttribute('x2', projB.xPixel);
    elements.svgMeasureLine.setAttribute('y2', projB.yPixel);
    elements.svgMeasureLine.style.display = 'block';
  } else {
    hideOverlayMarkers2D();
  }
}

function hideOverlayMarkers2D() {
  elements.markerA.classList.add('hidden');
  elements.markerB.classList.add('hidden');
  elements.svgMeasureLine.style.display = 'none';
}

function updateHUDStatus(surfaceFound, pointCount, distMeters) {
  if (surfaceFound && distMeters > 0) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = `Flat surface (${pointCount} pts)`;
    elements.hudDistanceVal.textContent = `${(distMeters * 100).toFixed(1)} cm / ${distMeters.toFixed(3)} m`;
    elements.btnCapture.disabled = false;
    elements.captureHint.textContent = 'Ready to capture';
    elements.hudReticleHint.textContent = 'Keep both markers in frame';
  } else if (surfaceFound) {
    elements.hudTrackingDot.className = 'dot amber';
    elements.hudTrackingText.textContent = 'Surface detected, measuring...';
    elements.hudDistanceVal.textContent = '--';
    elements.btnCapture.disabled = true;
    elements.captureHint.textContent = 'Calculating distance...';
    elements.hudReticleHint.textContent = 'Aim at surface to map bounds';
  } else {
    elements.hudTrackingDot.className = 'dot red';
    elements.hudTrackingText.textContent = 'Scanning for flat surface...';
    elements.hudDistanceVal.textContent = '--';
    elements.btnCapture.disabled = true;
    elements.captureHint.textContent = 'Aim at flat surface...';
    elements.hudReticleHint.textContent = 'Aim camera slowly at floor or desk';
  }
}

/* ==========================================================================
   5. Synchronized Capture Engine
   ========================================================================== */

function triggerCapture() {
  if (!state.pointA || !state.pointB) return;
  state.captureRequested = true;
}

/**
 * Freezes the camera frame and corresponding AR measurements synchronously
 */
async function executeSynchronousCapture(frame, pose, ptA, ptB, realDistMeters) {
  try {
    const view = pose.views[0];
    const viewMatrix = new Float32Array(view.transform.inverse.matrix);
    const projMatrix = new Float32Array(view.projectionMatrix);

    const captureTimestamp = new Date().toISOString();

    // 1. Capture the camera frame
    const captureData = await captureCameraFrame(view);
    const { imageWidth, imageHeight, originalBlob, originalDataUrl, cameraSource } = captureData;

    // 2. Project 3D points to 2D pixel coordinates for this exact captured frame
    const projA = projectPointToPixel(ptA, viewMatrix, projMatrix, imageWidth, imageHeight);
    const projB = projectPointToPixel(ptB, viewMatrix, projMatrix, imageWidth, imageHeight);

    if (!projA.valid || !projB.valid) {
      alert('Capture Error: Selected points fell outside valid camera frustum during frame capture.');
      return;
    }

    // 3. Compute 2D Pixel Distance
    const pixelDistance = Math.sqrt(
      (projB.xPixel - projA.xPixel) ** 2 +
      (projB.yPixel - projA.yPixel) ** 2
    );

    if (pixelDistance <= 0) {
      alert('Capture Error: Pixel distance is zero.');
      return;
    }

    // 4. Compute Scale Ratios
    const metersPerPixel = realDistMeters / pixelDistance;
    const pixelsPerMeter = pixelDistance / realDistMeters;

    // 5. Build Result Object adhering exactly to specified schema
    const resultJson = {
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      pointA: {
        xPixel: projA.xPixel,
        yPixel: projA.yPixel,
        xMeters: parseFloat(ptA.x.toFixed(4)),
        yMeters: parseFloat(ptA.y.toFixed(4)),
        zMeters: parseFloat(ptA.z.toFixed(4))
      },
      pointB: {
        xPixel: projB.xPixel,
        yPixel: projB.yPixel,
        xMeters: parseFloat(ptB.x.toFixed(4)),
        yMeters: parseFloat(ptB.y.toFixed(4)),
        zMeters: parseFloat(ptB.z.toFixed(4))
      },
      pixelDistance: parseFloat(pixelDistance.toFixed(2)),
      realDistanceMeters: parseFloat(realDistMeters.toFixed(4)),
      metersPerPixel: parseFloat(metersPerPixel.toFixed(6)),
      pixelsPerMeter: parseFloat(pixelsPerMeter.toFixed(2)),
      measurementSource: cameraSource,
      captureTimestamp: captureTimestamp
    };

    // Store state
    state.captureResult = resultJson;
    state.originalImageBlob = originalBlob;
    state.originalImageDataUrl = originalDataUrl;

    // 6. Generate Annotated Image
    state.annotatedImageDataUrl = await generateAnnotatedImage(
      originalDataUrl,
      resultJson.pointA,
      resultJson.pointB,
      realDistMeters,
      imageWidth,
      imageHeight
    );

    // End AR session and switch to Results Screen
    if (state.xrSession) {
      await state.xrSession.end();
    } else if (state.isSimulator) {
      stopSimulator();
      elements.arContainer.classList.add('hidden');
    }

    displayResults(resultJson);

  } catch (err) {
    console.error('Synchronous capture failed:', err);
    alert(`Capture Error: ${err.message}`);
  }
}

/**
 * Captures the unannotated camera frame.
 */
async function captureCameraFrame(view) {
  const offscreenCanvas = document.createElement('canvas');
  const ctx = offscreenCanvas.getContext('2d');

  let width = elements.arCanvas.width || window.innerWidth;
  let height = elements.arCanvas.height || window.innerHeight;
  let cameraSource = 'AR (WebXR Hit-Test)';

  offscreenCanvas.width = width;
  offscreenCanvas.height = height;

  if (state.isSimulator && state.simVideo) {
    ctx.drawImage(state.simVideo, 0, 0, width, height);
    cameraSource = 'AR (Simulated WebXR Environment)';
  } else {
    // Fill dark backdrop and draw WebGL viewport buffer
    ctx.fillStyle = '#111622';
    ctx.fillRect(0, 0, width, height);
    if (elements.arCanvas) {
      ctx.drawImage(elements.arCanvas, 0, 0, width, height);
    }
  }

  const originalDataUrl = offscreenCanvas.toDataURL('image/png');
  const originalBlob = await new Promise(res => offscreenCanvas.toBlob(res, 'image/png'));

  return {
    imageWidth: width,
    imageHeight: height,
    originalBlob: originalBlob,
    originalDataUrl: originalDataUrl,
    cameraSource: cameraSource
  };
}

/**
 * Generates an annotated copy of the captured frame drawing:
 * - High-contrast line between Point A and Point B
 * - Point markers with labels and pixel coordinates
 * - Centered measurement distance banner
 */
async function generateAnnotatedImage(originalDataUrl, ptA, ptB, realDistMeters, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Load original image
  const img = new Image();
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = originalDataUrl;
  });
  ctx.drawImage(img, 0, 0, width, height);

  const x1 = ptA.xPixel;
  const y1 = ptA.yPixel;
  const x2 = ptB.xPixel;
  const y2 = ptB.yPixel;

  // 1. Draw Measurement Line with high-contrast shadow
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#00e5ff';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();

  // 2. Draw Point A Marker (Cyan)
  drawPointMarker(ctx, x1, y1, 'A', '#00e5ff', `(${x1}, ${y1})`);

  // 3. Draw Point B Marker (Green)
  drawPointMarker(ctx, x2, y2, 'B', '#00e676', `(${x2}, ${y2})`);

  // 4. Draw Center Distance Callout Badge
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const textDist = `${(realDistMeters * 100).toFixed(1)} cm (${realDistMeters.toFixed(3)} m)`;

  ctx.save();
  ctx.font = 'bold 15px -apple-system, sans-serif';
  const textWidth = ctx.measureText(textDist).width;
  const pad = 10;
  const badgeW = textWidth + pad * 2;
  const badgeH = 28;

  ctx.fillStyle = 'rgba(10, 12, 16, 0.88)';
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(midX - badgeW / 2, midY - badgeH / 2, badgeW, badgeH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(textDist, midX, midY);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function drawPointMarker(ctx, x, y, label, color, subtext) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 13px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);

  ctx.font = '10px monospace';
  const tagW = ctx.measureText(subtext).width + 8;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(x - tagW / 2, y + 20, tagW, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(subtext, x, y + 28);
  ctx.restore();
}

/* ==========================================================================
   6. Results Display & Download Actions
   ========================================================================== */

function displayResults(data) {
  elements.screenLanding.classList.add('hidden');
  elements.arContainer.classList.add('hidden');
  elements.screenResults.classList.remove('hidden');

  // Metadata
  elements.resultImgDimensions.textContent = `Resolution: ${data.imageWidth} × ${data.imageHeight} px`;
  elements.resultTimestamp.textContent = `Captured: ${new Date(data.captureTimestamp).toLocaleTimeString()}`;

  // Metrics
  elements.resRealDist.textContent = `${data.realDistanceMeters.toFixed(4)} m`;
  elements.resRealDistCm.textContent = `${(data.realDistanceMeters * 100).toFixed(2)} cm (Physical 3D Euclidean)`;
  elements.resPixelDist.textContent = `${data.pixelDistance.toFixed(2)} px`;
  elements.resMPerPx.textContent = `${data.metersPerPixel.toFixed(6)} m/px`;
  elements.resPxPerM.textContent = `${data.pixelsPerMeter.toFixed(2)} px/m`;

  // Points Breakdown
  elements.resPointAPx.textContent = `(${data.pointA.xPixel}, ${data.pointA.yPixel})`;
  elements.resPointA3D.textContent = `X: ${data.pointA.xMeters}, Y: ${data.pointA.yMeters}, Z: ${data.pointA.zMeters}`;

  elements.resPointBPx.textContent = `(${data.pointB.xPixel}, ${data.pointB.yPixel})`;
  elements.resPointB3D.textContent = `X: ${data.pointB.xMeters}, Y: ${data.pointB.yMeters}, Z: ${data.pointB.zMeters}`;

  // Source & Accuracy Notice
  elements.resultStatusBadge.textContent = data.measurementSource;
  elements.accuracyExplanation.innerHTML = 
    `Calculated from 3D metric reference space poses and camera calibration matrix.<br>` +
    `<strong>Source:</strong> ${data.measurementSource}. Metric distance and pixel projection synchronized at frame capture instant.`;

  // Render Image Preview
  renderResultPreview(state.currentViewMode);
}

function renderResultPreview(mode) {
  const canvas = elements.resultCanvas;
  const ctx = canvas.getContext('2d');
  const src = mode === 'annotated' ? state.annotatedImageDataUrl : state.originalImageDataUrl;

  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };
  img.src = src;
}

function setViewMode(mode) {
  state.currentViewMode = mode;
  if (mode === 'annotated') {
    elements.btnViewAnnotated.classList.add('active');
    elements.btnViewOriginal.classList.remove('active');
  } else {
    elements.btnViewAnnotated.classList.remove('active');
    elements.btnViewOriginal.classList.add('active');
  }
  renderResultPreview(mode);
}

function downloadOriginalImage() {
  if (!state.originalImageBlob) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(state.originalImageBlob);
  link.download = `ar_captured_original_${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadMeasurementJson() {
  if (!state.captureResult) return;
  const jsonStr = JSON.stringify(state.captureResult, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `ar_measurement_${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function backToScan() {
  state.captureResult = null;
  state.originalImageBlob = null;
  state.originalImageDataUrl = null;
  state.annotatedImageDataUrl = null;

  elements.screenResults.classList.add('hidden');
  elements.screenLanding.classList.remove('hidden');
}

/* ==========================================================================
   7. WebXR Emulator / Simulator Mode (For Desktop & Non-AR Testing)
   ========================================================================== */

async function startSimulatorMode() {
  state.isSimulator = true;
  elements.screenLanding.classList.add('hidden');
  elements.screenResults.classList.add('hidden');
  elements.arContainer.classList.remove('hidden');

  const canvas = elements.arCanvas;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  // Try opening real user camera video as simulated AR background if available
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      await video.play();
      state.simVideo = video;
    }
  } catch (camErr) {
    console.warn('Simulator camera stream note:', camErr);
  }

  let simTime = 0;

  state.simulatorInterval = setInterval(() => {
    simTime += 0.05;

    // Draw background
    if (state.simVideo && state.simVideo.readyState >= 2) {
      ctx.drawImage(state.simVideo, 0, 0, canvas.width, canvas.height);
    } else {
      // Draw grid pattern representing simulated room/table
      ctx.fillStyle = '#0f141f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
      ctx.lineWidth = 1;
      const step = 40;
      for (let x = 0; x < canvas.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    // Generate simulated surface points on a flat plane
    // Plane: Y ≈ -0.32m, Z ≈ -1.05m
    const simPoints = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radiusX = 0.35 + Math.sin(simTime + i) * 0.03;
      const radiusZ = 0.22 + Math.cos(simTime + i) * 0.02;

      simPoints.push({
        x: Math.cos(angle) * radiusX,
        y: -0.32 + (Math.sin(i) * 0.005),
        z: -1.05 + Math.sin(angle) * radiusZ
      });
    }

    const pointPair = selectTwoFarthestPoints(simPoints);

    if (pointPair) {
      state.pointA = pointPair.pointA;
      state.pointB = pointPair.pointB;
      state.currentRealDistanceMeters = pointPair.distanceMeters;

      updateHUDStatus(true, simPoints.length, state.currentRealDistanceMeters);

      // Simulated standard WebXR camera projection matrices
      const aspect = canvas.width / canvas.height;
      const fovRad = (60 * Math.PI) / 180;
      const f = 1 / Math.tan(fovRad / 2);

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

      const simulatedView = {
        transform: { inverse: { matrix: viewMatrix }, matrix: viewMatrix },
        projectionMatrix: projMatrix
      };

      updateOverlayMarkers2D(state.pointA, state.pointB, simulatedView);

      if (state.captureRequested) {
        state.captureRequested = false;
        const fakePose = { views: [simulatedView] };
        executeSynchronousCapture(null, fakePose, state.pointA, state.pointB, state.currentRealDistanceMeters);
      }
    }
  }, 50);
}

function stopSimulator() {
  if (state.simulatorInterval) {
    clearInterval(state.simulatorInterval);
    state.simulatorInterval = null;
  }
  if (state.simVideo && state.simVideo.srcObject) {
    state.simVideo.srcObject.getTracks().forEach(t => t.stop());
    state.simVideo = null;
  }
  state.isSimulator = false;
}

/* ==========================================================================
   8. Event Listeners & Initialization
   ========================================================================== */

function initializeEvents() {
  elements.btnStartScan.addEventListener('click', startARSession);
  elements.btnStartSim.addEventListener('click', startSimulatorMode);
  elements.btnCapture.addEventListener('click', triggerCapture);
  elements.btnExitAR.addEventListener('click', exitAR);
  
  elements.btnBackScan.addEventListener('click', backToScan);
  elements.btnViewAnnotated.addEventListener('click', () => setViewMode('annotated'));
  elements.btnViewOriginal.addEventListener('click', () => setViewMode('original'));
  
  elements.btnDownloadImg.addEventListener('click', downloadOriginalImage);
  elements.btnDownloadJson.addEventListener('click', downloadMeasurementJson);

  // Resize handler
  window.addEventListener('resize', () => {
    if (elements.arCanvas) {
      elements.arCanvas.width = window.innerWidth;
      elements.arCanvas.height = window.innerHeight;
    }
  });
}

// On Page Load
window.addEventListener('DOMContentLoaded', () => {
  initializeEvents();
  checkCompatibility();
});
