/**
 * AR Measurement MVP - Core Application
 * Pure Vanilla JavaScript (ES6 Modules)
 * 
 * Implements:
 * 1. WebXR 'immersive-ar' session management with 'hit-test' and 'dom-overlay'.
 * 2. Continuous multi-ray hit-testing to probe flat visible surfaces automatically.
 * 3. Plane coplanarity validation and farthest-pair 3D distance maximization.
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
  hitTestSources: [],
  gl: null,
  glBinding: null,
  
  // Surface Point Tracking
  detectedSurfacePoints: [], // { x, y, z, normal, timestamp }
  pointA: null, // { x, y, z, normal } in meters
  pointB: null, // { x, y, z, normal } in meters
  currentRealDistanceMeters: 0,
  
  // Capture State
  captureRequested: false,
  isSimulator: false,
  simulatorInterval: null,
  
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
      `<strong>HTTPS Required:</strong> WebXR requires a secure HTTPS connection or localhost.`;
    updateBadge(elements.badgeWebXR, 'Insecure Context', 'error');
    return;
  }

  if (!('xr' in navigator)) {
    updateBadge(elements.badgeWebXR, 'WebXR: Unsupported', 'error');
    updateBadge(elements.badgeAR, 'AR: Unavailable', 'error');
    updateBadge(elements.badgeHitTest, 'Hit-Test: N/A', 'error');
    elements.compatibilityMessage.innerHTML = 
      `This browser does not support the <strong>WebXR Device API</strong>.<br>` +
      `Supported primarily on <strong>Google Chrome on Android</strong> with ARCore installed.<br>` +
      `You can still test the entire measurement and calculation pipeline using <strong>WebXR Emulator Mode</strong> below.`;
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
    
    // Request camera permission explicitly if available
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        // Close immediately - WebXR will take over the camera device
        stream.getTracks().forEach(t => t.stop());
      } catch (camErr) {
        console.warn('getUserMedia preflight check note:', camErr);
      }
    }

    // Set up WebGL Context for WebXR Rendering
    const canvas = elements.arCanvas;
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) {
      throw new Error('Could not create WebGL context with xrCompatible: true');
    }
    state.gl = gl;

    // Session options with dom-overlay and hit-test
    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'depth-sensing', 'camera-access', 'anchors', 'local-floor'],
      domOverlay: { root: elements.arOverlay }
    };

    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    state.xrSession = session;

    // Create XRWebGLBinding if supported for raw camera access
    if (window.XRWebGLBinding) {
      try {
        state.glBinding = new XRWebGLBinding(session, gl);
      } catch (bindingErr) {
        console.warn('XRWebGLBinding could not be created:', bindingErr);
      }
    }

    // Connect WebGL Layer to Session
    session.updateRenderState({
      baseLayer: new XRWebGLLayer(session, gl)
    });

    // Reference Spaces
    const refSpace = await session.requestReferenceSpace('local');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    state.xrRefSpace = refSpace;
    state.xrViewerSpace = viewerSpace;

    // Create a multi-directional ray grid for automatic surface probing
    await initializeHitTestSources(session, viewerSpace);

    // Show AR Container
    elements.screenLanding.classList.add('hidden');
    elements.screenResults.classList.add('hidden');
    elements.arContainer.classList.remove('hidden');

    session.addEventListener('end', onSessionEnded);

    // Start Animation Loop
    session.requestAnimationFrame(onXRFrame);

  } catch (err) {
    console.error('Failed to start WebXR session:', err);
    alert(`Could not start AR session: ${err.message}\nTip: Try the "Test in WebXR Emulator Mode" button.`);
  }
}

/**
 * Creates multiple hit-test sources at offset angles across the FOV
 * to probe flat surfaces automatically without user clicks.
 */
async function initializeHitTestSources(session, viewerSpace) {
  state.hitTestSources = [];
  
  // Directions to probe: Center, Left, Right, Up, Down, and 4 Diagonals
  const rayOffsets = [
    { x: 0.0,   y: 0.0,   z: -1.0 }, // Center
    { x: -0.18, y: 0.0,   z: -1.0 }, // Left
    { x: 0.18,  y: 0.0,   z: -1.0 }, // Right
    { x: 0.0,   y: 0.14,  z: -1.0 }, // Up
    { x: 0.0,   y: -0.14, z: -1.0 }, // Down
    { x: -0.14, y: 0.12,  z: -1.0 }, // Top-Left
    { x: 0.14,  y: 0.12,  z: -1.0 }, // Top-Right
    { x: -0.14, y: -0.12, z: -1.0 }, // Bottom-Left
    { x: 0.14,  y: -0.12, z: -1.0 }  // Bottom-Right
  ];

  for (const offset of rayOffsets) {
    try {
      const ray = new XRRay(
        new DOMPointReadOnly(0, 0, 0, 1),
        new DOMPointReadOnly(offset.x, offset.y, offset.z, 0)
      );
      const hitSource = await session.requestHitTestSource({ space: viewerSpace, offsetRay: ray });
      state.hitTestSources.push(hitSource);
    } catch (e) {
      console.warn('Could not create offset hit-test source:', e);
    }
  }

  // Fallback to basic center ray if no offset sources succeeded
  if (state.hitTestSources.length === 0) {
    try {
      const defaultSource = await session.requestHitTestSource({ space: viewerSpace });
      state.hitTestSources.push(defaultSource);
    } catch (e) {
      console.error('Default hit test source creation failed:', e);
    }
  }
}

function onSessionEnded() {
  state.xrSession = null;
  state.hitTestSources = [];
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
   3. WebXR Frame Loop & Surface Point Processing
   ========================================================================== */

function onXRFrame(time, frame) {
  const session = frame.session;
  session.requestAnimationFrame(onXRFrame);

  const gl = state.gl;
  const refSpace = state.xrRefSpace;
  const baseLayer = session.renderState.baseLayer;
  const pose = frame.getViewerPose(refSpace);

  if (!pose) {
    updateHUDStatus(false, 0, null);
    return;
  }

  // Bind WebGL framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // 1. Collect hit test points from all active probing rays
  const currentFramePoints = [];
  for (const hitSource of state.hitTestSources) {
    const hitResults = frame.getHitTestResults(hitSource);
    if (hitResults.length > 0) {
      const hitPose = hitResults[0].getPose(refSpace);
      if (hitPose) {
        const pos = hitPose.transform.position;
        const matrix = hitPose.transform.matrix;
        
        // Extract surface normal from hit pose orientation (Y-axis of orientation matrix is surface normal)
        const normal = {
          x: matrix[4],
          y: matrix[5],
          z: matrix[6]
        };

        currentFramePoints.push({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          normal: normal,
          timestamp: time
        });
      }
    }
  }

  // 2. Accumulate points with recent history (last 1.5 seconds)
  updateSurfacePointHistory(currentFramePoints, time);

  // 3. Filter points to an approximately flat surface
  const flatSurfacePoints = filterCoplanarSurfacePoints(state.detectedSurfacePoints);

  // 4. Automatically select the two farthest points on this flat surface
  let pointPair = null;
  if (flatSurfacePoints.length >= 2) {
    pointPair = selectTwoFarthestPoints(flatSurfacePoints);
  }

  // 5. Update State & HUD Markers
  if (pointPair) {
    state.pointA = pointPair.pointA;
    state.pointB = pointPair.pointB;
    state.currentRealDistanceMeters = pointPair.distanceMeters;

    updateHUDStatus(true, flatSurfacePoints.length, state.currentRealDistanceMeters);

    // Project points to 2D Screen DOM overlay
    const view = pose.views[0];
    updateOverlayMarkers2D(state.pointA, state.pointB, view);

    // Render 3D markers in WebGL
    render3DMarkers(gl, view, state.pointA, state.pointB);
  } else {
    state.pointA = null;
    state.pointB = null;
    state.currentRealDistanceMeters = 0;
    updateHUDStatus(false, flatSurfacePoints.length, 0);
    hideOverlayMarkers2D();
  }

  // 6. Handle Synchronous Frame Capture
  if (state.captureRequested && pointPair) {
    state.captureRequested = false;
    executeSynchronousCapture(frame, pose, state.pointA, state.pointB, state.currentRealDistanceMeters);
  }
}

/**
 * Retains high-confidence hit points within a sliding time window (1200ms)
 */
function updateSurfacePointHistory(newPoints, currentTime) {
  // Prune points older than 1200ms
  state.detectedSurfacePoints = state.detectedSurfacePoints.filter(p => currentTime - p.timestamp < 1200);

  // Append new unique points (avoid duplicates closer than 1.5cm)
  for (const np of newPoints) {
    const isDuplicate = state.detectedSurfacePoints.some(ep => {
      const d = Math.hypot(ep.x - np.x, ep.y - np.y, ep.z - np.z);
      return d < 0.015;
    });
    if (!isDuplicate) {
      state.detectedSurfacePoints.push(np);
    }
  }

  // Cap maximum buffer size to 60 points for high performance
  if (state.detectedSurfacePoints.length > 60) {
    state.detectedSurfacePoints = state.detectedSurfacePoints.slice(-60);
  }
}

/**
 * Filters detected points to those belonging to an approximately flat surface.
 * Computes median surface normal and ensures points lie within a 4cm planar envelope.
 */
function filterCoplanarSurfacePoints(points) {
  if (points.length < 2) return [];

  // Compute average / median normal vector
  let avgNx = 0, avgNy = 0, avgNz = 0;
  for (const p of points) {
    avgNx += p.normal.x;
    avgNy += p.normal.y;
    avgNz += p.normal.z;
  }
  const len = Math.hypot(avgNx, avgNy, avgNz) || 1;
  const dominantNormal = { x: avgNx / len, y: avgNy / len, z: avgNz / len };

  // Calculate centroid
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  const centroid = { x: cx / points.length, y: cy / points.length, z: cz / points.length };

  // Plane equation: n_x*(x - cx) + n_y*(y - cy) + n_z*(z - cz) = 0
  const validPoints = [];
  for (const p of points) {
    // Normal alignment: dot product >= 0.85 (~31 degrees max deviation)
    const dotNormal = p.normal.x * dominantNormal.x + p.normal.y * dominantNormal.y + p.normal.z * dominantNormal.z;
    if (dotNormal < 0.85) continue;

    // Perpendicular distance to fitted plane: |n · (p - centroid)| <= 0.04m (4cm tolerance)
    const distToPlane = Math.abs(
      dominantNormal.x * (p.x - centroid.x) +
      dominantNormal.y * (p.y - centroid.y) +
      dominantNormal.z * (p.z - centroid.z)
    );

    if (distToPlane <= 0.04) {
      validPoints.push(p);
    }
  }

  return validPoints;
}

/**
 * Evaluates all pairs of coplanar surface points to find the two farthest points.
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
    // Consistent ordering (Point A is leftmost or lower X)
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
  } else {
    elements.hudTrackingDot.className = 'dot amber';
    elements.hudTrackingText.textContent = pointCount > 0 ? `Probing surface (${pointCount} pts)...` : 'Scanning for flat surface...';
    elements.hudDistanceVal.textContent = '--';
    elements.btnCapture.disabled = true;
    elements.captureHint.textContent = 'Detecting surface points...';
    elements.hudReticleHint.textContent = 'Aim at a visible, textured flat surface';
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
    // pixelDistance = sqrt((x2 - x1)^2 + (y2 - y1)^2)
    const pixelDistance = Math.sqrt(
      (projB.xPixel - projA.xPixel) ** 2 +
      (projB.yPixel - projA.yPixel) ** 2
    );

    if (pixelDistance <= 0) {
      alert('Capture Error: Pixel distance is zero.');
      return;
    }

    // 4. Compute Scale Ratios
    // metersPerPixel = realDistanceMeters / pixelDistance
    // pixelsPerMeter = pixelDistance / realDistanceMeters
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
 * Uses XRWebGLBinding raw camera texture where available, or falls back to canvas capture.
 */
async function captureCameraFrame(view) {
  const offscreenCanvas = document.createElement('canvas');
  const ctx = offscreenCanvas.getContext('2d');

  let width = window.innerWidth;
  let height = window.innerHeight;
  let cameraSource = 'AR (WebXR Hit-Test)';

  // Try raw camera access if available
  if (state.glBinding && view.camera) {
    try {
      const camera = view.camera;
      width = camera.width;
      height = camera.height;
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;

      const gl = state.gl;
      const texture = state.glBinding.getCameraImage(camera);
      
      // Read texture pixels
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.deleteFramebuffer(fb);

      // Put to 2D canvas
      const imgData = ctx.createImageData(width, height);
      // Invert Y axis (WebGL textures are bottom-up)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIdx = ((height - 1 - y) * width + x) * 4;
          const dstIdx = (y * width + x) * 4;
          imgData.data[dstIdx] = pixels[srcIdx];
          imgData.data[dstIdx + 1] = pixels[srcIdx + 1];
          imgData.data[dstIdx + 2] = pixels[srcIdx + 2];
          imgData.data[dstIdx + 3] = pixels[srcIdx + 3];
        }
      }
      ctx.putImageData(imgData, 0, 0);
      cameraSource = 'AR (WebXR Raw Camera Access)';
    } catch (e) {
      console.warn('Raw camera texture capture fallback:', e);
    }
  }

  // Fallback: capture from render buffer / simulator camera
  if (offscreenCanvas.width === 0 || offscreenCanvas.height === 0) {
    width = elements.arCanvas.width || window.innerWidth;
    height = elements.arCanvas.height || window.innerHeight;
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;

    if (state.isSimulator && state.simVideo) {
      ctx.drawImage(state.simVideo, 0, 0, width, height);
      cameraSource = 'AR (Simulated WebXR Environment)';
    } else {
      // Draw background placeholder or canvas buffer
      ctx.fillStyle = '#111622';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(elements.arCanvas, 0, 0, width, height);
      cameraSource = 'AR (WebXR Viewport Capture)';
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
  // Outer halo
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fill();

  // Pin body
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Label text
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 13px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);

  // Subtext tag
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
   7. WebGL Simple 3D Marker Renderer
   ========================================================================== */

function render3DMarkers(gl, view, ptA, ptB) {
  // Markers are primarily projected and rendered via high-contrast DOM Overlay and SVG lines
  // for crispness on mobile retina displays. WebGL canvas is maintained clean with transparent clear.
}

/* ==========================================================================
   8. WebXR Emulator / Simulator Mode (For Desktop & Non-AR Testing)
   ========================================================================== */

async function startSimulatorMode() {
  state.isSimulator = true;
  elements.screenLanding.classList.add('hidden');
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

  // Simulated physical flat surface in front of camera
  // Surface at Y = -0.35m (table height), Z = -1.1m (distance)
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
    // Plane: Y ≈ -0.32, Z ≈ -1.05
    const simPoints = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radiusX = 0.35 + Math.sin(simTime + i) * 0.03;
      const radiusZ = 0.22 + Math.cos(simTime + i) * 0.02;

      simPoints.push({
        x: Math.cos(angle) * radiusX,
        y: -0.32 + (Math.sin(i) * 0.005), // within 0.5cm flatness
        z: -1.05 + Math.sin(angle) * radiusZ,
        normal: { x: 0, y: 1, z: 0 },
        timestamp: Date.now()
      });
    }

    state.detectedSurfacePoints = simPoints;
    const flatPoints = filterCoplanarSurfacePoints(simPoints);
    const pointPair = selectTwoFarthestPoints(flatPoints);

    if (pointPair) {
      state.pointA = pointPair.pointA;
      state.pointB = pointPair.pointB;
      state.currentRealDistanceMeters = pointPair.distanceMeters;

      updateHUDStatus(true, flatPoints.length, state.currentRealDistanceMeters);

      // Simulated camera projection matrices
      // Camera at (0, 0, 0) looking down -Z axis with ~60 deg vertical FOV
      const aspect = canvas.width / canvas.height;
      const fovRad = (60 * Math.PI) / 180;
      const f = 1 / Math.tan(fovRad / 2);

      // Simulated standard WebXR projection matrix
      const projMatrix = [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, -1.002, -1,
        0, 0, -0.2002, 0
      ];

      // Simulated identity view matrix (camera at origin)
      const viewMatrix = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];

      const simulatedView = {
        transform: { inverse: { matrix: viewMatrix } },
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
   9. Event Listeners & Initialization
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
    if (elements.arCanvas && state.isSimulator) {
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
