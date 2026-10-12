/**
 * AR Trouser Measurement & 2-Point Distance Calculator
 * Pure Vanilla JavaScript (ES6 Modules)
 * 
 * Features:
 * 1. WebXR 'immersive-ar' with 'hit-test', 'dom-overlay', and 'camera-access'.
 * 2. Automated One-Shot "Scan & Measure" Flow:
 *    - Surface plane detection & stability monitoring.
 *    - Frame capture + instant calibration freeze (pose, projection, plane).
 *    - HRNet DeepFashion2 backend inference (POST /predict).
 *    - Precise 3D unprojection with FABRIC_OFFSET elevation.
 *    - Full Trouser Dimensions: Waist width/circ, inseam, outseam, thigh, hem.
 * 3. Preserved Manual 2-Point Distance Calculator (screen tapping / reticle).
 * 4. Desktop WebXR Emulator Mode with sample/upload testing.
 * 5. Debug Mode (?debug=1): 2D keypoint visual inspection on captured frame.
 */

// ==============================================================================
// 1. CONSTANTS & CONFIGURATION
// ==============================================================================

// Backend Endpoint (Single constant configurable at top)
const BACKEND_URL = 'https://dashgaming-slytear.hf.space';

// Physical fabric offset along plane normal (2mm cloth thickness)
const FABRIC_OFFSET = 0.002;

// Minimum confidence score threshold for landmark acceptance
const MIN_CONFIDENCE = 0.3;

// Debug Mode flag via URL query string (?debug=1)
const isDebugMode = new URLSearchParams(window.location.search).get('debug') === '1';

// Full DeepFashion2 Category 8 (Trousers) Landmark Names
// 168: waist_left, 169: waist_center, 170: waist_right, 171: crotch
// 172: knee_outer_left, 173: hem_outer_left, 174: hem_inner_left, 175: hip_right
// 176: crotch_inseam, 177: hip_left, 178: knee_inner_right, 179: hem_outer_right
// 180: hem_inner_right, 181: crotch_bottom
const MEASUREMENTS = [
  {
    id: 'waist_width',
    label: 'Waist Width',
    landmarks: ['waist_left', 'waist_right'],
    isPrimary: true
  },
  {
    id: 'waist_circ',
    label: 'Waist Circumference',
    isDerived: true,
    sourceId: 'waist_width',
    multiplier: 2,
    subLabel: 'approx. (flat)',
    isPrimary: true
  },
  {
    id: 'inseam',
    label: 'Inseam',
    landmarks: ['crotch_inseam', 'hem_inner_left'],
    fallbackLandmarks: ['crotch_inseam', 'hem_inner_right']
  },
  {
    id: 'outseam',
    label: 'Outseam',
    landmarks: ['waist_left', 'hem_outer_left'],
    fallbackLandmarks: ['waist_right', 'hem_outer_right']
  },
  {
    id: 'thigh_width',
    label: 'Thigh Width',
    landmarks: ['crotch_inseam', 'hip_left'],
    fallbackLandmarks: ['crotch_inseam', 'hip_right']
  },
  {
    id: 'hem_width',
    label: 'Hem Width',
    landmarks: ['hem_inner_left', 'hem_outer_left'],
    fallbackLandmarks: ['hem_inner_right', 'hem_outer_right']
  }
];

// Measurement Lifecycle States
const STATES = {
  SCANNING: 'SCANNING',       // Stage 0: Scanning surface until stable
  DETECTING: 'DETECTING',     // Stage 1: Captured frame, waiting for backend
  MEASURED: 'MEASURED',       // Stage 2: 3D points plotted, dimensions calculated
  MANUAL_P1: 'POINT1_SET',    // Legacy manual mode fallback
  MANUAL_LOCKED: 'LOCKED'
};

// Global App State
const state = {
  // WebXR Session State
  xrSession: null,
  xrRefSpace: null,
  xrViewerSpace: null,
  hitTestSource: null,
  gl: null,
  glBinding: null,

  // Detected Surface Plane Equation: plane.normal · (P - plane.point) = 0
  surfacePlane: null,       // { point: {x,y,z}, normal: {x,y,z}, timestamp }
  currentReticlePose: null, // { x, y, z, matrix }

  // Stability Tracking
  lastCamPosition: null,
  stabilityTimerStart: 0,
  isTrackingStable: false,
  scanRequested: false,

  // Active Flow State
  flowState: STATES.SCANNING,
  frozenSnapshot: null,     // { camMatrix, projMatrix, invProjMatrix, surfacePlane, imageWidth, imageHeight, jpegBlob, dataUrl }

  // Detected Keypoints and Measurements
  detectedKeypointsMap: {},
  calculatedMeasurements: {},
  measurementNotices: [],

  // Legacy Manual 2-Point State (preserved untouched)
  measurementState: STATES.SCANNING,
  point1: null,
  point2: null,
  point1Pixel: null,
  point2Pixel: null,
  finalDistanceMeters: 0,
  activePointer: null,

  // Last Camera Matrices for projection
  lastView: null,
  lastViewMatrix: null,
  lastProjMatrix: null,
  lastCameraMatrix: null,

  // Simulator Mode State
  isSimulator: false,
  simulatorInterval: null,
  simVideo: null,
  simPointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
};

// Cached DOM Elements
const elements = {
  // Screens
  screenLanding: document.getElementById('screen-landing'),
  screenResults: document.getElementById('screen-results'),
  arContainer: document.getElementById('ar-container'),
  arCanvas: document.getElementById('ar-canvas'),
  arOverlay: document.getElementById('ar-overlay'),

  // Capability Badges & Landing Buttons
  badgeWebXR: document.getElementById('badge-webxr'),
  badgeAR: document.getElementById('badge-ar'),
  badgeHitTest: document.getElementById('badge-hittest'),
  compatibilityMessage: document.getElementById('compatibility-message'),
  btnStartScan: document.getElementById('btn-start-scan'),
  btnStartSim: document.getElementById('btn-start-sim'),
  simFileInput: document.getElementById('sim-file-input'),
  landingDebugLog: document.getElementById('landing-debug-log'),
  btnClearLog: document.getElementById('btn-clear-log'),

  // AR HUD Elements
  hudTrackingDot: document.getElementById('hud-tracking-dot'),
  hudTrackingText: document.getElementById('hud-tracking-text'),
  hudDistanceVal: document.getElementById('hud-distance-val'),
  hudReticleContainer: document.getElementById('hud-reticle-container'),
  hudReticle: document.getElementById('hud-reticle'),
  hudReticleHint: document.getElementById('hud-reticle-hint'),
  arStepBanner: document.getElementById('ar-step-banner'),
  stepIcon: document.getElementById('step-icon'),
  stepText: document.getElementById('step-text'),

  // Scan & Measure Shutter Trigger
  btnScanTrigger: document.getElementById('btn-scan-trigger'),
  scanInnerLabel: document.getElementById('scan-inner-label'),
  scanActionLabel: document.getElementById('scan-action-label'),

  // Notifications & Toasts
  arToast: document.getElementById('ar-toast'),
  toastText: document.getElementById('toast-text'),
  arErrorBanner: document.getElementById('ar-error-banner'),
  errorBannerText: document.getElementById('error-banner-text'),
  btnErrorRetry: document.getElementById('btn-error-retry'),

  // Interactive Markers & Garment Pins Layer
  markerA: document.getElementById('marker-a'),
  markerB: document.getElementById('marker-b'),
  markerACoords: document.getElementById('marker-a-coords'),
  markerBCoords: document.getElementById('marker-b-coords'),
  garmentPinsContainer: document.getElementById('garment-pins-container'),
  svgMeasureLine: document.getElementById('svg-measure-line'),

  // AR Controls
  btnExitAR: document.getElementById('btn-exit-ar'),
  btnResetPoints: document.getElementById('btn-reset-points'),
  btnPlacePoint: document.getElementById('btn-place-point'),
  shutterInnerLabel: document.getElementById('shutter-inner-label'),
  btnActionLabel: document.getElementById('btn-action-label'),

  // Results Screen Elements
  btnBackScan: document.getElementById('btn-back-scan'),
  btnNewMeasure: document.getElementById('btn-new-measure'),
  resWaistWidth: document.getElementById('res-waist-width'),
  resWaistWidthSub: document.getElementById('res-waist-width-sub'),
  resWaistCirc: document.getElementById('res-waist-circ'),
  resWaistCircSub: document.getElementById('res-waist-circ-sub'),
  resInseam: document.getElementById('res-inseam'),
  resInseamSub: document.getElementById('res-inseam-sub'),
  resOutseam: document.getElementById('res-outseam'),
  resOutseamSub: document.getElementById('res-outseam-sub'),
  resThighWidth: document.getElementById('res-thigh-width'),
  resThighWidthSub: document.getElementById('res-thigh-width-sub'),
  resHemWidth: document.getElementById('res-hem-width'),
  resHemWidthSub: document.getElementById('res-hem-width-sub'),

  // Notices & Debug Drawer
  resNoticesContainer: document.getElementById('res-notices-container'),
  resNoticesList: document.getElementById('res-notices-list'),
  debugDrawer: document.getElementById('debug-drawer'),
  debugCanvas: document.getElementById('debug-canvas'),
  resKeypointsTbody: document.getElementById('res-keypoints-tbody'),

  // Legacy manual result placeholders
  resHeroDistance: document.getElementById('res-hero-distance'),
  resHeroSub: document.getElementById('res-hero-sub'),
  resP1Coords: document.getElementById('res-p1-coords'),
  resP2Coords: document.getElementById('res-p2-coords')
};

/* ==========================================================================
   2. Logging, Badges & Compatibility
   ========================================================================== */

function logMsg(msg, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${msg}`);
  if (elements.landingDebugLog) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${time}] ${msg}`;
    elements.landingDebugLog.appendChild(entry);
    elements.landingDebugLog.scrollTop = elements.landingDebugLog.scrollHeight;
  }
}

async function checkCompatibility() {
  logMsg('Checking WebXR capabilities...', 'info');

  if (!window.isSecureContext) {
    logMsg('Security check: HTTPS or localhost required for WebXR.', 'error');
    if (elements.compatibilityMessage) {
      elements.compatibilityMessage.innerHTML = 
        `<strong style="color:var(--accent-red)">HTTPS Required:</strong> WebXR requires HTTPS or localhost.`;
    }
    updateBadge(elements.badgeWebXR, 'Insecure Context', 'error');
    return;
  }

  if (!('xr' in navigator)) {
    logMsg('WebXR Device API is not available on this browser.', 'error');
    updateBadge(elements.badgeWebXR, 'WebXR: Unsupported', 'error');
    updateBadge(elements.badgeAR, 'AR: Unavailable', 'error');
    updateBadge(elements.badgeHitTest, 'Hit-Test: N/A', 'error');
    if (elements.compatibilityMessage) {
      elements.compatibilityMessage.innerHTML = 
        `WebXR is not supported on this browser engine.<br>` +
        `Native AR requires <strong>Google Chrome on Android</strong> with ARCore.<br>` +
        `You can use <strong>Test in WebXR Emulator Mode</strong> on any desktop or mobile device.`;
    }
    return;
  }

  updateBadge(elements.badgeWebXR, 'WebXR: Supported', 'success');

  try {
    const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
    if (isArSupported) {
      logMsg('immersive-ar is supported with hardware AR tracking.', 'success');
      updateBadge(elements.badgeAR, 'AR: Supported', 'success');
      updateBadge(elements.badgeHitTest, 'Hit-Test: Ready', 'success');
      if (elements.compatibilityMessage) {
        elements.compatibilityMessage.innerHTML = 
          `AR sensors ready! Click <strong>Start AR Measurement</strong> to scan trousers and auto-measure.`;
      }
      elements.btnStartScan.disabled = false;
    } else {
      logMsg('immersive-ar is not supported on this device. (Requires ARCore).', 'warn');
      updateBadge(elements.badgeAR, 'AR: Unsupported', 'error');
      updateBadge(elements.badgeHitTest, 'Hit-Test: N/A', 'error');
      if (elements.compatibilityMessage) {
        elements.compatibilityMessage.innerHTML = 
          `WebXR is present, but <strong>immersive-ar</strong> is unavailable on this device.<br>` +
          `Test all automatic scanning features using <strong>Test in WebXR Emulator Mode</strong> below.`;
      }
    }
  } catch (err) {
    logMsg(`Capability query error: ${err.message}`, 'error');
    updateBadge(elements.badgeAR, 'AR: Error', 'error');
  }
}

function updateBadge(badgeEl, text, statusClass) {
  if (!badgeEl) return;
  badgeEl.textContent = text;
  badgeEl.className = `badge ${statusClass}`;
}

/* ==========================================================================
   3. WebXR AR Session Lifecycle
   ========================================================================== */

async function startARSession() {
  try {
    state.isSimulator = false;
    logMsg('Initializing WebXR immersive-ar session...', 'info');

    elements.screenLanding.classList.add('hidden');
    elements.screenResults.classList.add('hidden');
    elements.arContainer.classList.remove('hidden');

    const canvas = elements.arCanvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) {
      gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: true, preserveDrawingBuffer: true });
    }
    if (!gl) {
      throw new Error('WebGL context could not be created');
    }
    state.gl = gl;

    if (gl.makeXRCompatible) {
      await gl.makeXRCompatible();
    }

    // Required: hit-test; Optional: dom-overlay, local-floor, camera-access
    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'camera-access'],
      domOverlay: { root: elements.arOverlay }
    };

    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    } catch (e1) {
      logMsg(`Primary request failed (${e1.message}), trying optional hit-test...`, 'warn');
      session = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor', 'camera-access'],
        domOverlay: { root: elements.arOverlay }
      });
    }

    state.xrSession = session;
    logMsg('WebXR session granted.', 'success');

    session.updateRenderState({
      baseLayer: new XRWebGLLayer(session, gl)
    });

    // Initialize WebGL binding for raw camera image access
    if (window.XRWebGLBinding) {
      try {
        state.glBinding = new XRWebGLBinding(session, gl);
        logMsg('XRWebGLBinding initialized for camera texture access.', 'info');
      } catch (bindErr) {
        console.warn('XRWebGLBinding note:', bindErr);
      }
    }

    // Reference space setup
    let refSpace = null;
    for (const type of ['local', 'local-floor', 'viewer']) {
      try {
        refSpace = await session.requestReferenceSpace(type);
        if (refSpace) {
          logMsg(`Reference space "${type}" initialized.`, 'info');
          break;
        }
      } catch (e) {}
    }
    if (!refSpace) throw new Error('Could not acquire reference space');
    state.xrRefSpace = refSpace;

    const viewerSpace = await session.requestReferenceSpace('viewer');
    state.xrViewerSpace = viewerSpace;

    // Hit-test source creation
    try {
      const hitSource = await session.requestHitTestSource({ space: viewerSpace });
      state.hitTestSource = hitSource;
      logMsg('Hit-test source active. Scan the trousers surface.', 'success');
    } catch (htErr) {
      logMsg(`Hit-test warning: ${htErr.message}`, 'warn');
    }

    session.addEventListener('end', onSessionEnded);

    resetToScanning();
    session.requestAnimationFrame(onXRFrame);

  } catch (err) {
    logMsg(`Failed to start AR: ${err.message}`, 'error');
    console.error('AR session error:', err);
    elements.arContainer.classList.add('hidden');
    elements.screenLanding.classList.remove('hidden');
    showErrorBanner(`Could not start AR: ${err.message}`);
  }
}

function onSessionEnded() {
  state.xrSession = null;
  state.hitTestSource = null;
  state.glBinding = null;
  elements.arContainer.classList.add('hidden');
  if (state.flowState !== STATES.MEASURED) {
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
   4. WebXR Render Loop & Stability Tracking
   ========================================================================== */

function onXRFrame(time, frame) {
  const session = frame.session;
  session.requestAnimationFrame(onXRFrame);

  const gl = state.gl;
  const refSpace = state.xrRefSpace;
  const baseLayer = session.renderState.baseLayer;
  const pose = frame.getViewerPose(refSpace);

  if (!pose || !baseLayer) {
    updateTrackingUI(false, false);
    return;
  }

  // Clear WebGL framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const view = pose.views[0];
  if (!view) return;

  // Cache matrices
  state.lastView = view;
  state.lastViewMatrix = new Float32Array(view.transform.inverse.matrix);
  state.lastProjMatrix = new Float32Array(view.projectionMatrix);
  state.lastCameraMatrix = new Float32Array(view.transform.matrix);

  // 1. Hit-Test against garment/table surface
  let surfaceHitFound = false;
  if (state.hitTestSource) {
    const hitResults = frame.getHitTestResults(state.hitTestSource);
    if (hitResults.length > 0) {
      const hitPose = hitResults[0].getPose(refSpace);
      if (hitPose) {
        surfaceHitFound = true;
        const pos = hitPose.transform.position;
        const matrix = hitPose.transform.matrix;

        state.currentReticlePose = {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          matrix: matrix
        };

        const nLen = Math.hypot(matrix[4], matrix[5], matrix[6]) || 1;
        state.surfacePlane = {
          point: { x: pos.x, y: pos.y, z: pos.z },
          normal: { x: matrix[4] / nLen, y: matrix[5] / nLen, z: matrix[6] / nLen },
          timestamp: time
        };
      }
    }
  }

  // 2. Track Phone Stability over ~1.5s
  const camPos = {
    x: view.transform.matrix[12],
    y: view.transform.matrix[13],
    z: view.transform.matrix[14]
  };

  if (state.lastCamPosition && state.surfacePlane) {
    const moveDist = Math.hypot(
      camPos.x - state.lastCamPosition.x,
      camPos.y - state.lastCamPosition.y,
      camPos.z - state.lastCamPosition.z
    );

    // If movement is very small (< 0.006m per frame) and plane timestamp is recent (< 1.5s)
    if (moveDist < 0.006 && (time - state.surfacePlane.timestamp < 1500)) {
      if (!state.stabilityTimerStart) {
        state.stabilityTimerStart = time;
      }
      if (time - state.stabilityTimerStart > 800) {
        state.isTrackingStable = true;
      }
    } else {
      state.stabilityTimerStart = 0;
      state.isTrackingStable = false;
    }
  } else {
    state.isTrackingStable = false;
  }
  state.lastCamPosition = camPos;

  updateTrackingUI(surfaceHitFound || state.surfacePlane !== null, state.isTrackingStable);

  // 3. Handle One-Shot Scan Trigger inside this exact XR frame callback
  if (state.scanRequested && state.flowState === STATES.SCANNING) {
    state.scanRequested = false;
    handleOneShotFrameCapture(session, frame, view, time);
  }

  // 4. Update HUD and visual markers
  renderGarmentHUD(view, window.innerWidth, window.innerHeight);
}

function updateTrackingUI(hasSurface, isStable) {
  if (!elements.hudTrackingDot || !elements.hudTrackingText) return;

  if (hasSurface && isStable) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = 'Surface ready (Phone steady)';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Hold steady, tap Scan';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = false;
      elements.scanActionLabel.textContent = 'Hold steady, tap Scan';
      elements.stepText.textContent = 'Hold steady, tap Scan & Measure';
      elements.stepIcon.textContent = '📸';
    }
  } else if (hasSurface) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = 'Surface locked - hold phone steady';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Stabilize phone over trousers';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = false; // Allow manual tap if user prefers
      elements.scanActionLabel.textContent = 'Tap Scan & Measure';
      elements.stepText.textContent = 'Aim at flat trousers, tap Scan';
      elements.stepIcon.textContent = '🎯';
    }
  } else {
    elements.hudTrackingDot.className = 'dot amber';
    elements.hudTrackingText.textContent = 'Scanning surrounding surface...';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Move camera slowly over trousers';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = true;
      elements.scanActionLabel.textContent = 'Aim at trousers...';
      elements.stepText.textContent = 'Scan trousers until surface locks';
      elements.stepIcon.textContent = '🔍';
    }
  }
}

/* ==========================================================================
   5. 3D Euclidean Math & Shared Ray-Plane Intersection Engine
   ========================================================================== */

/**
 * 100% Accurate 3D Physical Euclidean Distance
 * D = sqrt((X2 - X1)^2 + (Y2 - Y1)^2 + (Z2 - Z1)^2)
 */
function calculate3DDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  return Math.sqrt(
    (p2.x - p1.x) ** 2 +
    (p2.y - p1.y) ** 2 +
    (p2.z - p1.z) ** 2
  );
}

/**
 * Shared Ray-Plane Intersection Engine
 * Given a 3D ray (origin, dir) and a plane (point, normal), computes intersection.
 * Returns null if ray is parallel to plane (|denom| < 1e-4) or behind camera (t <= 0).
 */
function intersectRayWithPlane(rayOrigin, rayDir, planePoint, planeNormal) {
  const denom = planeNormal.x * rayDir.x + planeNormal.y * rayDir.y + planeNormal.z * rayDir.z;
  if (Math.abs(denom) < 1e-4) {
    return null; // Ray parallel to surface
  }

  const t = (
    planeNormal.x * (planePoint.x - rayOrigin.x) +
    planeNormal.y * (planePoint.y - rayOrigin.y) +
    planeNormal.z * (planePoint.z - rayOrigin.z)
  ) / denom;

  if (t <= 0.001) {
    return null; // Behind or at camera plane
  }

  return {
    x: rayOrigin.x + t * rayDir.x,
    y: rayOrigin.y + t * rayDir.y,
    z: rayOrigin.z + t * rayDir.z,
    t: t
  };
}

/**
 * Unprojects a 2D image landmark coordinate (u, v in pixels) into a physical 3D world point.
 * Uses the frozen camera matrix, projection matrix, and surface plane with FABRIC_OFFSET.
 */
function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = FABRIC_OFFSET) {
  // 1. Normalized Device Coordinates (NDC) [-1, 1], top-left pixel origin
  const ndcX = (u / imageWidth) * 2 - 1;
  const ndcY = 1 - (v / imageHeight) * 2;

  // 2. Camera View Space Ray Direction
  const dxCam = (ndcX + (projMatrix[8] || 0)) / projMatrix[0];
  const dyCam = (ndcY + (projMatrix[9] || 0)) / projMatrix[5];
  const dzCam = -1.0;

  // 3. Transform Ray Direction to World Space
  const rX = camMatrix[0] * dxCam + camMatrix[4] * dyCam + camMatrix[8] * dzCam;
  const rY = camMatrix[1] * dxCam + camMatrix[5] * dyCam + camMatrix[9] * dzCam;
  const rZ = camMatrix[2] * dxCam + camMatrix[6] * dyCam + camMatrix[10] * dzCam;

  const rLen = Math.hypot(rX, rY, rZ);
  if (rLen < 1e-6) return null;
  const dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
  const origin = { x: camMatrix[12], y: camMatrix[13], z: camMatrix[14] };

  // 4. Elevate surface plane by FABRIC_OFFSET (0.002m) along the normal
  const offsetPlanePoint = {
    x: planePoint.x + fabricOffset * planeNormal.x,
    y: planePoint.y + fabricOffset * planeNormal.y,
    z: planePoint.z + fabricOffset * planeNormal.z
  };

  return intersectRayWithPlane(origin, dir, offsetPlanePoint, planeNormal);
}

/**
 * Projects a 3D physical world point (X, Y, Z meters) to 2D screen viewport pixels.
 */
function projectPointToPixel(point3D, viewMatrix, projectionMatrix, screenWidth, screenHeight) {
  const x = point3D.x;
  const y = point3D.y;
  const z = point3D.z;

  const cx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8]  * z + viewMatrix[12];
  const cy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9]  * z + viewMatrix[13];
  const cz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
  const cw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];

  if (cz >= -0.01) {
    return { valid: false, reason: 'Behind camera' };
  }

  const clipX = projectionMatrix[0] * cx + projectionMatrix[4] * cy + projectionMatrix[8]  * cz + projectionMatrix[12] * cw;
  const clipY = projectionMatrix[1] * cx + projectionMatrix[5] * cy + projectionMatrix[9]  * cz + projectionMatrix[13] * cw;
  const clipW = projectionMatrix[3] * cx + projectionMatrix[7] * cy + projectionMatrix[11] * cz + projectionMatrix[15] * cw;

  if (Math.abs(clipW) < 1e-6) return { valid: false, reason: 'Invalid clip W' };

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;

  const xPixel = Math.round(((ndcX + 1) / 2) * screenWidth);
  const yPixel = Math.round(((1 - ndcY) / 2) * screenHeight);

  const inBounds = (xPixel >= -50 && xPixel <= screenWidth + 50 && yPixel >= -50 && yPixel <= screenHeight + 50);

  return {
    valid: true,
    xPixel,
    yPixel,
    depthMeters: -cz,
    inBounds
  };
}

/* ==========================================================================
   6. One-Shot Frame Capture & Freeze Engine
   ========================================================================== */

function triggerScanCapture() {
  if (!state.surfacePlane) {
    showErrorBanner('No surface detected yet. Scan trousers until surface locks.');
    return;
  }
  hideErrorBanner();
  state.scanRequested = true;
  logMsg('Scan triggered. Freezing calibration on next XR frame...', 'info');
}

/**
 * Captures the exact camera frame texture and freezes pose + projection + plane
 * at the same instant inside the XR frame callback.
 */
async function handleOneShotFrameCapture(session, frame, view, time) {
  try {
    state.flowState = STATES.DETECTING;
    showToast('Capturing frame...');

    const gl = state.gl;

    // 1. Snapshot the camera state at this exact instant
    const snapshot = {
      camMatrix: new Float32Array(view.transform.matrix),
      projMatrix: new Float32Array(view.projectionMatrix),
      surfacePlane: {
        point: { ...state.surfacePlane.point },
        normal: { ...state.surfacePlane.normal }
      },
      timestamp: time,
      imageWidth: 0,
      imageHeight: 0,
      jpegBlob: null,
      dataUrl: null
    };

    // 2. Capture Camera Frame via XRWebGLBinding.getCameraImage
    let frameData = null;
    if (state.glBinding && view.camera) {
      try {
        const tex = state.glBinding.getCameraImage(view.camera);
        if (tex) {
          const vp = session.renderState.baseLayer.getViewport(view);
          const texW = view.camera.width || vp.width || 1280;
          const texH = view.camera.height || vp.height || 720;
          frameData = readWebGLTextureToJpeg(gl, tex, texW, texH);
          logMsg(`Camera frame captured via XRWebGLBinding: ${frameData.width}x${frameData.height}`, 'success');
        }
      } catch (texErr) {
        console.warn('getCameraImage error, trying video fallback:', texErr);
      }
    }

    // Fallback: If camera-access texture is not provided by browser
    if (!frameData) {
      logMsg('Using high-res camera sensor fallback...', 'info');
      frameData = await captureFallbackCameraFrame();
    }

    if (!frameData || !frameData.blob) {
      throw new Error('Failed to capture camera frame. Ensure camera permission is granted.');
    }

    snapshot.imageWidth = frameData.width;
    snapshot.imageHeight = frameData.height;
    snapshot.jpegBlob = frameData.blob;
    snapshot.dataUrl = frameData.dataUrl;
    state.frozenSnapshot = snapshot;

    // 3. Dispatch to HRNet Backend for garment keypoint detection
    await dispatchToBackend(snapshot);

  } catch (err) {
    console.error('Frame capture error:', err);
    hideToast();
    state.flowState = STATES.SCANNING;
    showErrorBanner(`Capture failed: ${err.message}`);
  }
}

/**
 * Reads a WebGL camera texture into a 2D canvas, flips Y, downscales if > 1280px,
 * and exports as JPEG quality 0.9.
 */
function readWebGLTextureToJpeg(gl, texture, width, height) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);

  // Downscale if longest side > 1280px
  const maxDim = 1280;
  let targetW = width;
  let targetH = height;
  const longest = Math.max(width, height);
  if (longest > maxDim) {
    const scale = maxDim / longest;
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  // Create canvas for 2D image data with flipped Y
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = width;
  rawCanvas.height = height;
  const rawCtx = rawCanvas.getContext('2d');
  const imgData = rawCtx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * width * 4;
    imgData.data.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
  }
  rawCtx.putImageData(imgData, 0, 0);

  // Scaled canvas if needed
  let finalCanvas = rawCanvas;
  if (targetW !== width || targetH !== height) {
    finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetW;
    finalCanvas.height = targetH;
    const ctx = finalCanvas.getContext('2d');
    ctx.drawImage(rawCanvas, 0, 0, targetW, targetH);
  }

  const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.9);
  const binStr = atob(dataUrl.split(',')[1]);
  const len = binStr.length;
  const u8Arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8Arr[i] = binStr.charCodeAt(i);
  }
  const blob = new Blob([u8Arr], { type: 'image/jpeg' });

  return { width: targetW, height: targetH, blob, dataUrl };
}

/**
 * Fallback camera sensor frame capture when XRWebGLBinding raw texture is unavailable
 */
async function captureFallbackCameraFrame() {
  if (state.isSimulator && state.simVideo) {
    const w = state.simVideo.videoWidth || 1280;
    const h = state.simVideo.videoHeight || 720;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(state.simVideo, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return { width: w, height: h, blob, dataUrl };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    await video.play();

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0);

    stream.getTracks().forEach(t => t.stop());
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return { width: w, height: h, blob, dataUrl };
  } catch (camErr) {
    // Canvas fallback
    const w = window.innerWidth;
    const h = window.innerHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#10141f';
    ctx.fillRect(0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return { width: w, height: h, blob, dataUrl };
  }
}

/* ==========================================================================
   7. Backend Communication (POST /predict) & Keypoint Unprojection
   ========================================================================== */

async function dispatchToBackend(snapshot) {
  showToast('Detecting trouser landmarks...');
  hideErrorBanner();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

  // If taking > 3.5s, update toast to inform about server wake up
  const wakeNoticeTimer = setTimeout(() => {
    showToast('Waking up server...');
  }, 3500);

  try {
    const formData = new FormData();
    formData.append('image', snapshot.jpegBlob, 'frame.jpg');
    if (isDebugMode) {
      formData.append('debug', 'true');
    }

    logMsg(`Sending JPEG (${Math.round(snapshot.jpegBlob.size / 1024)} KB) to ${BACKEND_URL}/predict...`, 'info');

    const res = await fetch(`${BACKEND_URL}/predict`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    clearTimeout(wakeNoticeTimer);

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.keypoints) || data.keypoints.length === 0) {
      throw new Error(data.error || 'Empty keypoints returned by model');
    }

    logMsg(`Backend returned ${data.keypoints.length} keypoints in ${data.inference_ms}ms`, 'success');
    hideToast();

    // Process keypoints and calculate dimensions
    processLandmarksAndMeasurements(data, snapshot);

  } catch (err) {
    clearTimeout(timeoutId);
    clearTimeout(wakeNoticeTimer);
    hideToast();
    state.flowState = STATES.SCANNING;

    if (err.name === 'AbortError') {
      showErrorBanner('Server timeout (20s). The model server may be starting up. Please tap Retry.');
    } else {
      showErrorBanner(`Detection error: ${err.message}`);
    }
    console.error('Detection error:', err);
  }
}

/**
 * Converts 2D returned keypoints into 3D world points using the SAVED frozen snapshot,
 * computes garment measurements, and displays the results.
 */
function processLandmarksAndMeasurements(backendData, snapshot) {
  const keypointsMap = {};
  const unprojectedPoints = [];

  // Map each landmark using the SAVED snapshot matrices and plane
  for (const kp of backendData.keypoints) {
    const p3D = unprojectKeypointTo3D(
      kp.u,
      kp.v,
      snapshot.imageWidth,
      snapshot.imageHeight,
      snapshot.projMatrix,
      snapshot.camMatrix,
      snapshot.surfacePlane.point,
      snapshot.surfacePlane.normal,
      FABRIC_OFFSET
    );

    if (!p3D) {
      console.warn(`Landmark ${kp.name} could not be intersected with surface plane.`);
    } else {
      unprojectedPoints.push({ name: kp.name, score: kp.score, p3D });
    }

    keypointsMap[kp.name] = {
      u: kp.u,
      v: kp.v,
      score: kp.score,
      p3D: p3D
    };
  }

  state.detectedKeypointsMap = keypointsMap;
  state.measurementNotices = [];

  // Evaluate MEASUREMENTS config
  const calculated = {};

  for (const m of MEASUREMENTS) {
    if (m.isDerived && m.sourceId) {
      // Derived measurement (e.g. waist circumference = 2 x waist width)
      const src = calculated[m.sourceId];
      if (src && src.valid) {
        const valMeters = src.distMeters * (m.multiplier || 2);
        calculated[m.id] = {
          id: m.id,
          label: m.label,
          valid: true,
          distMeters: valMeters,
          distCm: valMeters * 100,
          distInches: valMeters * 39.3701,
          subLabel: m.subLabel
        };
      } else {
        calculated[m.id] = { id: m.id, label: m.label, valid: false };
      }
      continue;
    }

    // Direct pairwise landmarks
    let lmA = m.landmarks[0];
    let lmB = m.landmarks[1];

    let kpA = keypointsMap[lmA];
    let kpB = keypointsMap[lmB];

    // Check fallback landmarks if primary score is low
    if ((!kpA || kpA.score < MIN_CONFIDENCE || !kpB || kpB.score < MIN_CONFIDENCE) && m.fallbackLandmarks) {
      const fbA = keypointsMap[m.fallbackLandmarks[0]];
      const fbB = keypointsMap[m.fallbackLandmarks[1]];
      if (fbA && fbA.score >= MIN_CONFIDENCE && fbB && fbB.score >= MIN_CONFIDENCE) {
        lmA = m.fallbackLandmarks[0];
        lmB = m.fallbackLandmarks[1];
        kpA = fbA;
        kpB = fbB;
      }
    }

    const friendlyName = m.label.toLowerCase();

    if (!kpA || kpA.score < MIN_CONFIDENCE) {
      state.measurementNotices.push(`Couldn't see the ${friendlyName} clearly, rescan with the trousers flat and well lit.`);
      calculated[m.id] = { id: m.id, label: m.label, valid: false };
      continue;
    }

    if (!kpB || kpB.score < MIN_CONFIDENCE) {
      state.measurementNotices.push(`Couldn't see the ${friendlyName} clearly, rescan with the trousers flat and well lit.`);
      calculated[m.id] = { id: m.id, label: m.label, valid: false };
      continue;
    }

    if (!kpA.p3D || !kpB.p3D) {
      state.measurementNotices.push(`Could not compute 3D geometry for ${friendlyName}. Ensure surface is flat.`);
      calculated[m.id] = { id: m.id, label: m.label, valid: false };
      continue;
    }

    // Physical 3D Euclidean distance
    const distMeters = calculate3DDistance(kpA.p3D, kpB.p3D);
    calculated[m.id] = {
      id: m.id,
      label: m.label,
      valid: true,
      distMeters: distMeters,
      distCm: distMeters * 100,
      distInches: distMeters * 39.3701,
      pointA: kpA.p3D,
      pointB: kpB.p3D
    };
  }

  state.calculatedMeasurements = calculated;
  state.flowState = STATES.MEASURED;

  // Render 3D garment markers
  displayGarmentPins(unprojectedPoints);

  // Render Results Screen
  showGarmentResults(backendData, snapshot);
}

/* ==========================================================================
   8. HUD Markers & Results Display
   ========================================================================== */

function displayGarmentPins(points) {
  if (!elements.garmentPinsContainer) return;
  elements.garmentPinsContainer.innerHTML = '';

  for (const pt of points) {
    const pin = document.createElement('div');
    pin.className = 'garment-pin';
    pin.id = `gpin-${pt.name}`;
    pin.innerHTML = `
      <div class="garment-dot"></div>
      <div class="garment-label">${pt.name.replace('_', ' ')} (${Math.round(pt.score * 100)}%)</div>
    `;
    elements.garmentPinsContainer.appendChild(pin);
  }
}

function renderGarmentHUD(view, width, height) {
  const viewMatrix = view ? view.transform.inverse.matrix : state.lastViewMatrix;
  const projMatrix = view ? view.projectionMatrix : state.lastProjMatrix;
  if (!viewMatrix || !projMatrix) return;

  // In measured state, project detected 3D landmarks onto live camera view
  if (state.flowState === STATES.MEASURED && state.detectedKeypointsMap) {
    for (const [name, kp] of Object.entries(state.detectedKeypointsMap)) {
      const pinEl = document.getElementById(`gpin-${name}`);
      if (!pinEl) continue;
      if (!kp.p3D) {
        pinEl.style.display = 'none';
        continue;
      }
      const proj = projectPointToPixel(kp.p3D, viewMatrix, projMatrix, width, height);
      if (proj.valid && proj.inBounds) {
        pinEl.style.display = 'flex';
        pinEl.style.left = `${proj.xPixel}px`;
        pinEl.style.top = `${proj.yPixel}px`;
      } else {
        pinEl.style.display = 'none';
      }
    }

    // Connect waist points with SVG line
    const wLeft = state.detectedKeypointsMap['waist_left'];
    const wRight = state.detectedKeypointsMap['waist_right'];
    if (wLeft && wLeft.p3D && wRight && wRight.p3D) {
      const pA = projectPointToPixel(wLeft.p3D, viewMatrix, projMatrix, width, height);
      const pB = projectPointToPixel(wRight.p3D, viewMatrix, projMatrix, width, height);
      if (pA.valid && pB.valid) {
        elements.svgMeasureLine.setAttribute('x1', pA.xPixel);
        elements.svgMeasureLine.setAttribute('y1', pA.yPixel);
        elements.svgMeasureLine.setAttribute('x2', pB.xPixel);
        elements.svgMeasureLine.setAttribute('y2', pB.yPixel);
        elements.svgMeasureLine.style.display = 'block';
      }
    }
    return;
  }

  // Legacy manual HUD rendering (preserved)
  renderManualHUD(view, width, height);
}

function showGarmentResults(backendData, snapshot) {
  elements.arContainer.classList.add('hidden');
  elements.screenResults.classList.remove('hidden');

  const m = state.calculatedMeasurements;

  // Waist Width
  if (m.waist_width && m.waist_width.valid) {
    elements.resWaistWidth.textContent = `${m.waist_width.distCm.toFixed(1)} cm`;
    elements.resWaistWidthSub.textContent = `${m.waist_width.distInches.toFixed(1)} in`;
    elements.hudDistanceVal.textContent = `${m.waist_width.distCm.toFixed(1)} cm`;
  } else {
    elements.resWaistWidth.textContent = '--';
    elements.resWaistWidthSub.textContent = 'Not detected';
  }

  // Waist Circumference
  if (m.waist_circ && m.waist_circ.valid) {
    elements.resWaistCirc.textContent = `${m.waist_circ.distCm.toFixed(1)} cm (${m.waist_circ.distInches.toFixed(1)} in)`;
    elements.resWaistCircSub.textContent = 'approx. (flat)';
  } else {
    elements.resWaistCirc.textContent = '--';
  }

  // Inseam
  if (m.inseam && m.inseam.valid) {
    elements.resInseam.textContent = `${m.inseam.distCm.toFixed(1)} cm`;
    elements.resInseamSub.textContent = `${m.inseam.distInches.toFixed(1)} in`;
  } else {
    elements.resInseam.textContent = '--';
    elements.resInseamSub.textContent = 'Not detected';
  }

  // Outseam
  if (m.outseam && m.outseam.valid) {
    elements.resOutseam.textContent = `${m.outseam.distCm.toFixed(1)} cm`;
    elements.resOutseamSub.textContent = `${m.outseam.distInches.toFixed(1)} in`;
  } else {
    elements.resOutseam.textContent = '--';
    elements.resOutseamSub.textContent = 'Not detected';
  }

  // Thigh Width
  if (m.thigh_width && m.thigh_width.valid) {
    elements.resThighWidth.textContent = `${m.thigh_width.distCm.toFixed(1)} cm`;
    elements.resThighWidthSub.textContent = `${m.thigh_width.distInches.toFixed(1)} in`;
  } else {
    elements.resThighWidth.textContent = '--';
    elements.resThighWidthSub.textContent = 'Not detected';
  }

  // Hem Width
  if (m.hem_width && m.hem_width.valid) {
    elements.resHemWidth.textContent = `${m.hem_width.distCm.toFixed(1)} cm`;
    elements.resHemWidthSub.textContent = `${m.hem_width.distInches.toFixed(1)} in`;
  } else {
    elements.resHemWidth.textContent = '--';
    elements.resHemWidthSub.textContent = 'Not detected';
  }

  // Friendly Low-Confidence Notices
  if (state.measurementNotices && state.measurementNotices.length > 0) {
    elements.resNoticesContainer.classList.remove('hidden');
    elements.resNoticesList.innerHTML = state.measurementNotices
      .map(note => `<li>${note}</li>`)
      .join('');
  } else {
    elements.resNoticesContainer.classList.add('hidden');
  }

  // Populate 3D Coordinates Table
  if (elements.resKeypointsTbody) {
    elements.resKeypointsTbody.innerHTML = backendData.keypoints.map(kp => {
      const p3D = state.detectedKeypointsMap[kp.name]?.p3D;
      const coordStr = p3D ? `X: ${p3D.x.toFixed(3)}, Y: ${p3D.y.toFixed(3)}, Z: ${p3D.z.toFixed(3)}` : 'Unprojected';
      const confPct = Math.round(kp.score * 100);
      const confBadge = kp.score >= MIN_CONFIDENCE ? `<span class="badge success">${confPct}%</span>` : `<span class="badge error">${confPct}%</span>`;
      return `
        <tr>
          <td><span class="point-tag tag-a">${kp.name.replace('_', ' ')}</span></td>
          <td><code>${coordStr}</code></td>
          <td>${confBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // Debug Viewer for ?debug=1
  if (isDebugMode && elements.debugDrawer && elements.debugCanvas) {
    elements.debugDrawer.classList.remove('hidden');
    renderDebug2DView(snapshot, backendData);
  }
}

/**
 * Draws the captured JPEG with the returned 2D keypoints and labels for ?debug=1 verification
 */
function renderDebug2DView(snapshot, backendData) {
  const canvas = elements.debugCanvas;
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    ctx.font = 'bold 14px monospace';
    for (const kp of backendData.keypoints) {
      ctx.beginPath();
      ctx.arc(kp.u, kp.v, 6, 0, Math.PI * 2);
      ctx.fillStyle = kp.score >= MIN_CONFIDENCE ? '#00e5ff' : '#ff3d71';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${kp.name} (${Math.round(kp.score * 100)}%)`, kp.u + 8, kp.v - 4);
    }
  };
  img.src = snapshot.dataUrl;
}

function resetToScanning() {
  state.flowState = STATES.SCANNING;
  state.frozenSnapshot = null;
  state.detectedKeypointsMap = {};
  state.calculatedMeasurements = {};
  state.measurementNotices = [];
  state.scanRequested = false;

  hideToast();
  hideErrorBanner();
  if (elements.garmentPinsContainer) elements.garmentPinsContainer.innerHTML = '';
  if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
  if (elements.hudReticleContainer) elements.hudReticleContainer.classList.remove('hidden');

  updateTrackingUI(state.surfacePlane !== null, false);
}

function showToast(msg) {
  if (elements.arToast && elements.toastText) {
    elements.toastText.textContent = msg;
    elements.arToast.classList.remove('hidden');
  }
}

function hideToast() {
  if (elements.arToast) elements.arToast.classList.add('hidden');
}

function showErrorBanner(msg) {
  if (elements.arErrorBanner && elements.errorBannerText) {
    elements.errorBannerText.textContent = msg;
    elements.arErrorBanner.classList.remove('hidden');
  }
}

function hideErrorBanner() {
  if (elements.arErrorBanner) elements.arErrorBanner.classList.add('hidden');
}

/* ==========================================================================
   9. Preserved Manual 2-Point Mode Engine
   ========================================================================== */

function handleManualPlacePoint(tapX, tapY) {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const posX = (tapX !== undefined) ? tapX : (screenW / 2);
  const posY = (tapY !== undefined) ? tapY : (screenH / 2);

  if (state.measurementState === STATES.SCANNING) {
    const pt3D = unprojectKeypointTo3D(
      posX, posY, screenW, screenH,
      state.lastProjMatrix, state.lastCameraMatrix,
      state.surfacePlane ? state.surfacePlane.point : { x: 0, y: 0, z: -1 },
      state.surfacePlane ? state.surfacePlane.normal : { x: 0, y: 0, z: 1 },
      0.0
    );
    if (!pt3D) return;
    state.point1 = pt3D;
    state.point1Pixel = { x: posX, y: posY };
    state.measurementState = STATES.MANUAL_P1;
  } else if (state.measurementState === STATES.MANUAL_P1) {
    const pt3D = unprojectKeypointTo3D(
      posX, posY, screenW, screenH,
      state.lastProjMatrix, state.lastCameraMatrix,
      state.surfacePlane ? state.surfacePlane.point : { x: 0, y: 0, z: -1 },
      state.surfacePlane ? state.surfacePlane.normal : { x: 0, y: 0, z: 1 },
      0.0
    );
    if (!pt3D) return;
    state.point2 = pt3D;
    state.point2Pixel = { x: posX, y: posY };
    state.finalDistanceMeters = calculate3DDistance(state.point1, state.point2);
    state.measurementState = STATES.MANUAL_LOCKED;
  }
}

function renderManualHUD(view, width, height) {
  const viewMatrix = view ? view.transform.inverse.matrix : state.lastViewMatrix;
  const projMatrix = view ? view.projectionMatrix : state.lastProjMatrix;
  if (!viewMatrix || !projMatrix) return;

  if (state.measurementState === STATES.MANUAL_P1 && state.point1) {
    const proj1 = projectPointToPixel(state.point1, viewMatrix, projMatrix, width, height);
    if (proj1.valid && proj1.inBounds) {
      elements.markerA.classList.remove('hidden');
      elements.markerA.style.left = `${proj1.xPixel}px`;
      elements.markerA.style.top = `${proj1.yPixel}px`;
    }
  } else if (state.measurementState === STATES.MANUAL_LOCKED && state.point1 && state.point2) {
    const proj1 = projectPointToPixel(state.point1, viewMatrix, projMatrix, width, height);
    const proj2 = projectPointToPixel(state.point2, viewMatrix, projMatrix, width, height);
    if (proj1.valid && proj2.valid) {
      elements.markerA.classList.remove('hidden');
      elements.markerA.style.left = `${proj1.xPixel}px`;
      elements.markerA.style.top = `${proj1.yPixel}px`;
      elements.markerB.classList.remove('hidden');
      elements.markerB.style.left = `${proj2.xPixel}px`;
      elements.markerB.style.top = `${proj2.yPixel}px`;
      elements.svgMeasureLine.setAttribute('x1', proj1.xPixel);
      elements.svgMeasureLine.setAttribute('y1', proj1.yPixel);
      elements.svgMeasureLine.setAttribute('x2', proj2.xPixel);
      elements.svgMeasureLine.setAttribute('y2', proj2.yPixel);
      elements.svgMeasureLine.style.display = 'block';
    }
  } else {
    elements.markerA.classList.add('hidden');
    elements.markerB.classList.add('hidden');
  }
}

/* ==========================================================================
   10. WebXR Desktop Emulator Mode
   ========================================================================== */

async function startSimulatorMode() {
  state.isSimulator = true;
  logMsg('Starting WebXR desktop simulator mode...', 'info');

  elements.screenLanding.classList.add('hidden');
  elements.screenResults.classList.add('hidden');
  elements.arContainer.classList.remove('hidden');

  const canvas = elements.arCanvas;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const aspect = canvas.width / canvas.height;
  const fovRad = (60 * Math.PI) / 180;
  const f = 1 / Math.tan(fovRad / 2);
  const projMatrix = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, -1.002, -1,
    0, 0, -0.2002, 0
  ]);
  const viewMatrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);

  state.lastViewMatrix = viewMatrix;
  state.lastProjMatrix = projMatrix;
  state.lastCameraMatrix = viewMatrix;

  // Simulated surface plane at Z = -1.0m
  state.surfacePlane = {
    point: { x: 0, y: 0, z: -1.0 },
    normal: { x: 0, y: 0, z: 1.0 },
    timestamp: performance.now()
  };

  resetToScanning();

  // Try opening webcam or render grid
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
  } catch (e) {
    logMsg('Camera feed unavailable for simulator, using virtual AR grid.', 'info');
  }

  state.simulatorInterval = setInterval(() => {
    if (state.simVideo && state.simVideo.readyState >= 2) {
      ctx.drawImage(state.simVideo, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
      ctx.lineWidth = 1;
      const step = 45;
      for (let x = 0; x < canvas.width; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
    }

    state.isTrackingStable = true;
    updateTrackingUI(true, true);

    const simulatedView = {
      transform: { inverse: { matrix: viewMatrix } },
      projectionMatrix: projMatrix
    };

    renderGarmentHUD(simulatedView, canvas.width, canvas.height);

  }, 33);
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

// Simulator file upload tester
function handleSimulatorImageUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));

      const snapshot = {
        camMatrix: state.lastCameraMatrix || new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
        projMatrix: state.lastProjMatrix || new Float32Array([1,0,0,0, 0,1,0,0, 0,0,-1,-1, 0,0,-0.2,0]),
        surfacePlane: state.surfacePlane || { point: { x: 0, y: 0, z: -1.0 }, normal: { x: 0, y: 0, z: 1.0 } },
        imageWidth: img.width,
        imageHeight: img.height,
        jpegBlob: blob,
        dataUrl: dataUrl,
        timestamp: performance.now()
      };
      state.frozenSnapshot = snapshot;
      dispatchToBackend(snapshot);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

/* ==========================================================================
   11. Event Listeners & Bootstrapping
   ========================================================================== */

function setupEventListeners() {
  // Start AR Scan
  elements.btnStartScan.addEventListener('click', () => {
    if (elements.btnStartScan.disabled) {
      alert('AR Scan requires Google Chrome on Android with ARCore.\n\nYou can click "Test in WebXR Emulator Mode" to test all features now.');
      return;
    }
    startARSession();
  });

  // Emulator Mode
  elements.btnStartSim.addEventListener('click', startSimulatorMode);

  // One-Shot Scan Trigger Button
  elements.btnScanTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.isSimulator) {
      // In simulator, if file input exists, prompt for image or use camera frame
      if (elements.simFileInput && !state.simVideo) {
        elements.simFileInput.click();
        return;
      }
    }
    triggerScanCapture();
  });

  // Simulator file picker
  if (elements.simFileInput) {
    elements.simFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleSimulatorImageUpload(e.target.files[0]);
      }
    });
  }

  // Error Retry
  elements.btnErrorRetry.addEventListener('click', (e) => {
    e.stopPropagation();
    hideErrorBanner();
    triggerScanCapture();
  });

  // Rescan / Reset Buttons
  elements.btnResetPoints.addEventListener('click', (e) => {
    e.stopPropagation();
    resetToScanning();
  });

  elements.btnBackScan.addEventListener('click', () => {
    elements.screenResults.classList.add('hidden');
    if (state.xrSession || state.isSimulator) {
      elements.arContainer.classList.remove('hidden');
      resetToScanning();
    } else {
      elements.screenLanding.classList.remove('hidden');
    }
  });

  elements.btnNewMeasure.addEventListener('click', () => {
    elements.screenResults.classList.add('hidden');
    if (state.xrSession || state.isSimulator) {
      elements.arContainer.classList.remove('hidden');
      resetToScanning();
    } else {
      elements.screenLanding.classList.remove('hidden');
    }
  });

  // Exit AR
  elements.btnExitAR.addEventListener('click', (e) => {
    e.stopPropagation();
    exitAR();
  });

  // Tap anywhere on overlay for fallback manual plotting
  elements.arOverlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (state.flowState === STATES.SCANNING) {
      handleManualPlacePoint(e.clientX, e.clientY);
    }
  });

  // Clear log
  if (elements.btnClearLog) {
    elements.btnClearLog.addEventListener('click', () => {
      if (elements.landingDebugLog) {
        elements.landingDebugLog.innerHTML = '<div class="log-entry info">[System] Log cleared.</div>';
      }
    });
  }

  // Window resize
  window.addEventListener('resize', () => {
    if (elements.arCanvas) {
      elements.arCanvas.width = window.innerWidth;
      elements.arCanvas.height = window.innerHeight;
    }
  });
}

// Initialize on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkCompatibility();
});
