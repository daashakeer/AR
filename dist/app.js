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

// Minimum confidence score threshold: 0.0 (confidence checks disabled per user instruction)
const MIN_CONFIDENCE = 0.0;

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
    fallbackLandmarks: [
      ['waist_left', 'waist_center', 2.0],
      ['waist_center', 'waist_right', 2.0],
      ['hip_left', 'hip_right', 1.0]
    ],
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
    fallbackLandmarks: [
      ['crotch_inseam', 'hem_inner_right', 1.0],
      ['crotch', 'hem_inner_left', 1.0],
      ['crotch', 'hem_inner_right', 1.0],
      ['crotch_bottom', 'hem_inner_left', 1.0],
      ['crotch_bottom', 'hem_inner_right', 1.0]
    ]
  },
  {
    id: 'outseam',
    label: 'Outseam',
    landmarks: ['waist_left', 'hem_outer_left'],
    fallbackLandmarks: [
      ['waist_right', 'hem_outer_right', 1.0],
      ['waist_center', 'hem_outer_left', 1.0],
      ['waist_center', 'hem_outer_right', 1.0],
      ['hip_left', 'hem_outer_left', 1.0]
    ]
  },
  {
    id: 'thigh_width',
    label: 'Thigh Width',
    landmarks: ['crotch_inseam', 'hip_left'],
    fallbackLandmarks: [
      ['crotch_inseam', 'hip_right', 1.0],
      ['crotch', 'hip_left', 1.0],
      ['crotch', 'hip_right', 1.0],
      ['crotch_bottom', 'hip_left', 1.0],
      ['crotch_bottom', 'hip_right', 1.0]
    ]
  },
  {
    id: 'hem_width',
    label: 'Hem Width',
    landmarks: ['hem_inner_left', 'hem_outer_left'],
    fallbackLandmarks: [
      ['hem_inner_right', 'hem_outer_right', 1.0],
      ['hem_outer_left', 'hem_inner_right', 1.0]
    ]
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

  // 1. Hit-Test against garment/table surface with statistical plane stabilizer
  let surfaceHitFound = false;
  if (state.hitTestSource) {
    const hitResults = frame.getHitTestResults(state.hitTestSource);
    if (hitResults.length > 0) {
      const hitPose = hitResults[0].getPose(refSpace);
      if (hitPose) {
        surfaceHitFound = true;
        const pos = hitPose.transform.position;
        const matrix = hitPose.transform.matrix;

        // Add to statistical stabilizer to filter jitter and lock horizontal plane
        state.surfacePlane = planeStabilizer.addHitPose(pos, matrix, time);

        state.currentReticlePose = {
          x: pos.x,
          y: state.surfacePlane.point.y,
          z: pos.z,
          matrix: matrix
        };
      }
    }
  }

  // 2. Track Phone Stability & Tilt Angle
  const camPos = {
    x: view.transform.matrix[12],
    y: view.transform.matrix[13],
    z: view.transform.matrix[14]
  };

  // Optical axis downward alignment (-view.transform.matrix[9] is dot product with gravity down)
  const lookDown = -view.transform.matrix[9];
  const tiltDeg = Math.acos(Math.max(-1, Math.min(1, lookDown))) * (180 / Math.PI);
  state.phoneTiltDeg = tiltDeg;

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
      if (time - state.stabilityTimerStart > 600) {
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

  updateTrackingUI(surfaceHitFound || state.surfacePlane !== null, state.isTrackingStable, state.phoneTiltDeg);

  // 3. Handle One-Shot Scan Trigger inside this exact XR frame callback
  if (state.scanRequested && state.flowState === STATES.SCANNING) {
    state.scanRequested = false;
    handleOneShotFrameCapture(session, frame, view, time);
  }

  // 4. Update HUD and visual markers
  renderGarmentHUD(view, window.innerWidth, window.innerHeight);
}

function updateTrackingUI(hasSurface, isStable, tiltDeg = 0) {
  if (!elements.hudTrackingDot || !elements.hudTrackingText) return;

  const isLevel = (tiltDeg <= 18);

  // Keep manual measurement instructions visible if user is measuring manually
  if (state.measurementState === STATES.MANUAL_P1) {
    elements.stepIcon.textContent = '📍';
    elements.stepText.textContent = 'Point 1 placed. Aim reticle & tap Point 2';
  } else if (state.measurementState === STATES.MANUAL_LOCKED && state.finalDistanceMeters > 0) {
    elements.stepIcon.textContent = '✓';
    elements.stepText.textContent = `Measured: ${(state.finalDistanceMeters * 100).toFixed(1)} cm — Tap ↺ to Rescan`;
  }

  if (hasSurface && isStable) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = isLevel ? 'Surface locked & level' : `Level phone flatter (${Math.round(tiltDeg)}° tilt)`;
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = isLevel ? 'Surface locked — tap Scan' : 'Tilt phone flatter over surface';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = false;
      elements.scanActionLabel.textContent = isLevel ? 'Hold steady, tap Scan' : 'Level phone & tap Scan';
      if (state.measurementState === STATES.SCANNING) {
        elements.stepText.textContent = isLevel ? 'Hold steady, tap Scan & Measure' : 'Level phone flatter over surface';
        elements.stepIcon.textContent = isLevel ? '📸' : '📱';
      }
    }
  } else if (hasSurface) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = isLevel ? 'Surface locked — hold steady' : `Tilt phone flatter (${Math.round(tiltDeg)}°)`;
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Hold steady over trousers';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = false;
      elements.scanActionLabel.textContent = 'Tap Scan & Measure';
      if (state.measurementState === STATES.SCANNING) {
        elements.stepText.textContent = 'Aim at flat trousers, tap Scan';
        elements.stepIcon.textContent = '🎯';
      }
    }
  } else {
    elements.hudTrackingDot.className = 'dot amber';
    elements.hudTrackingText.textContent = 'Scanning surrounding surface...';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Move camera slowly over trousers';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = true;
      elements.scanActionLabel.textContent = 'Aim at trousers...';
      if (state.measurementState === STATES.SCANNING) {
        elements.stepText.textContent = 'Scan trousers until surface locks';
        elements.stepIcon.textContent = '🔍';
      }
    }
  }
}

/* ==========================================================================
   5. 3D Euclidean Math & Shared Ray-Plane Intersection Engine
   ========================================================================== */

/**
 * True 4x4 Matrix Inversion
 * Handles arbitrary WebXR projection and camera transform matrices without approximations
 */
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

/**
 * Surface Plane Stabilizer
 * Uses statistical median filtering on height Y and locks horizontal surfaces (floor/table)
 * to normal (0, 1, 0) to eliminate tilt jitter and perspective noise.
 */
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

    // Outlier rejection: ignore sudden vertical jumps (> 15cm from established plane)
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
      isStable: this.history.length >= 6,
      timestamp: time
    };
    return this.stablePlane;
  }
}

const planeStabilizer = new SurfacePlaneStabilizer(25);

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
 * Uses exact 4x4 matrix inversion and surface plane with FABRIC_OFFSET.
 */
function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = FABRIC_OFFSET) {
  const pPoint = (planePoint && typeof planePoint.x === 'number') ? planePoint : { x: 0, y: -0.5, z: -0.8 };
  const pNorm = (planeNormal && typeof planeNormal.x === 'number') ? planeNormal : { x: 0, y: 1.0, z: 0 };
  const imgW = imageWidth || window.innerWidth || 576;
  const imgH = imageHeight || window.innerHeight || 1280;
  const pMat = (projMatrix && projMatrix.length >= 16) ? projMatrix : new Float32Array([1.8, 0, 0, 0,  0, 0.9, 0, 0,  0, 0, -1, -1,  0, 0, -0.2, 0]);
  const cMat = (camMatrix && camMatrix.length >= 16) ? camMatrix : new Float32Array([1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);

  // 1. Normalized Device Coordinates (NDC) [-1, 1], top-left pixel origin
  const ndcX = (u / imgW) * 2 - 1;
  const ndcY = 1 - (v / imgH) * 2;

  // 2. Exact 4x4 Inverse Projection to View Space Ray
  const invP = invertMatrix4(new Float32Array(16), pMat);
  let dir, origin;

  if (invP) {
    const xc = invP[0] * ndcX + invP[4] * ndcY - invP[8] + invP[12];
    const yc = invP[1] * ndcX + invP[5] * ndcY - invP[9] + invP[13];
    const zc = invP[2] * ndcX + invP[6] * ndcY - invP[10] + invP[14];
    const wc = invP[3] * ndcX + invP[7] * ndcY - invP[11] + invP[15];
    const invW = (Math.abs(wc) > 1e-6) ? (1.0 / wc) : 1.0;
    const vx = xc * invW;
    const vy = yc * invW;
    const vz = zc * invW;

    const rX = cMat[0] * vx + cMat[4] * vy + cMat[8] * vz;
    const rY = cMat[1] * vx + cMat[5] * vy + cMat[9] * vz;
    const rZ = cMat[2] * vx + cMat[6] * vy + cMat[10] * vz;
    const rLen = Math.hypot(rX, rY, rZ) || 1.0;

    dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
    origin = { x: cMat[12], y: cMat[13], z: cMat[14] };
  } else {
    // Fallback ray calculation
    const dxCam = (ndcX + (pMat[8] || 0)) / (pMat[0] || 1.8);
    const dyCam = (ndcY + (pMat[9] || 0)) / (pMat[5] || 0.9);
    const dzCam = -1.0;
    const rX = cMat[0] * dxCam + cMat[4] * dyCam + cMat[8] * dzCam;
    const rY = cMat[1] * dxCam + cMat[5] * dyCam + cMat[9] * dzCam;
    const rZ = cMat[2] * dxCam + cMat[6] * dyCam + cMat[10] * dzCam;
    const rLen = Math.hypot(rX, rY, rZ) || 1.0;
    dir = { x: rX / rLen, y: rY / rLen, z: rZ / rLen };
    origin = { x: cMat[12], y: cMat[13], z: cMat[14] };
  }

  // 3. Elevate surface plane by FABRIC_OFFSET along normal
  const offsetPlanePoint = {
    x: pPoint.x + fabricOffset * pNorm.x,
    y: pPoint.y + fabricOffset * pNorm.y,
    z: pPoint.z + fabricOffset * pNorm.z
  };

  // 4. If surface is horizontal (floor/table), compute direct stable ground intersection
  if (Math.abs(pNorm.y) > 0.99 && Math.abs(pNorm.x) < 0.05 && Math.abs(pNorm.z) < 0.05 && Math.abs(dir.y) > 1e-4) {
    const tH = (offsetPlanePoint.y - origin.y) / dir.y;
    if (tH > 0.01 && tH < 10.0) {
      return {
        x: origin.x + tH * dir.x,
        y: offsetPlanePoint.y,
        z: origin.z + tH * dir.z,
        t: tH
      };
    }
  }

  let hit = intersectRayWithPlane(origin, dir, offsetPlanePoint, pNorm);

  // Fallback 1: Check two-sided plane (opposite normal orientation)
  if (!hit) {
    const oppNormal = { x: -pNorm.x, y: -pNorm.y, z: -pNorm.z };
    hit = intersectRayWithPlane(origin, dir, offsetPlanePoint, oppNormal);
  }

  // Fallback 2: Horizontal plane intersection at surface elevation
  if (!hit && Math.abs(dir.y) > 1e-4) {
    const tHoriz = (offsetPlanePoint.y - origin.y) / dir.y;
    if (tHoriz > 0.05 && tHoriz < 5.0) {
      hit = {
        x: origin.x + tHoriz * dir.x,
        y: origin.y + tHoriz * dir.y,
        z: origin.z + tHoriz * dir.z,
        t: tHoriz
      };
    }
  }

  // Fallback 3: Project along camera ray at the depth of the detected surface
  if (!hit) {
    const planeDepth = Math.hypot(offsetPlanePoint.x - origin.x, offsetPlanePoint.y - origin.y, offsetPlanePoint.z - origin.z) || 0.6;
    hit = {
      x: origin.x + planeDepth * dir.x,
      y: origin.y + planeDepth * dir.y,
      z: origin.z + planeDepth * dir.z,
      t: planeDepth
    };
  }

  return hit;
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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } }
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    await video.play();

    const vidW = video.videoWidth || 1280;
    const vidH = video.videoHeight || 720;

    // Match exact aspect ratio of active WebXR viewport
    const targetAspect = window.innerWidth / window.innerHeight;
    const vidAspect = vidW / vidH;

    let cropX = 0, cropY = 0, cropW = vidW, cropH = vidH;

    if (vidAspect > targetAspect) {
      // Video is wider than screen: crop sides symmetrically
      cropW = vidH * targetAspect;
      cropX = (vidW - cropW) / 2;
    } else {
      // Video is taller than screen: crop top and bottom
      cropH = vidW / targetAspect;
      cropY = (vidH - cropH) / 2;
    }

    // Target max 1280 for fast HRNet inference
    let targetW = Math.round(cropW);
    let targetH = Math.round(cropH);
    const maxDim = 1280;
    if (Math.max(targetW, targetH) > maxDim) {
      const s = maxDim / Math.max(targetW, targetH);
      targetW = Math.round(targetW * s);
      targetH = Math.round(targetH * s);
    }

    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

    stream.getTracks().forEach(t => t.stop());
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return { width: targetW, height: targetH, blob, dataUrl };
  } catch (camErr) {
    // Canvas fallback: capture the active WebGL AR canvas
    const arCanvas = elements.arCanvas;
    if (arCanvas && arCanvas.width > 0 && arCanvas.height > 0) {
      const dataUrl = arCanvas.toDataURL('image/jpeg', 0.9);
      const binStr = atob(dataUrl.split(',')[1]);
      const len = binStr.length;
      const u8Arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) u8Arr[i] = binStr.charCodeAt(i);
      const blob = new Blob([u8Arr], { type: 'image/jpeg' });
      return { width: arCanvas.width, height: arCanvas.height, blob, dataUrl };
    }

    const w = window.innerWidth || 720;
    const h = window.innerHeight || 1280;
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
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout for ZeroGPU queue

  // If taking > 3.5s, update toast to inform about server wake up / GPU queue
  const wakeNoticeTimer = setTimeout(() => {
    showToast('Allocating GPU & detecting...');
  }, 3500);

  try {
    let data = null;

    // Strategy 1: If using Hugging Face Space, use the Gradio SSE Queue to trigger @spaces.GPU
    const isHFSpace = BACKEND_URL.includes('hf.space') || BACKEND_URL.includes('huggingface.co');
    if (isHFSpace) {
      logMsg('Connecting to Hugging Face ZeroGPU via Gradio Queue...', 'info');
      data = await predictViaGradioQueue(snapshot.jpegBlob, isDebugMode, controller.signal);
    }

    // Strategy 2: Direct HTTP POST /predict (for local servers or non-ZeroGPU endpoints)
    if (!data) {
      logMsg(`Sending JPEG (${Math.round(snapshot.jpegBlob.size / 1024)} KB) to ${BACKEND_URL}/predict...`, 'info');
      const formData = new FormData();
      formData.append('image', snapshot.jpegBlob, 'frame.jpg');
      if (isDebugMode) {
        formData.append('debug', 'true');
      }

      const res = await fetch(`${BACKEND_URL}/predict`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
      }

      data = await res.json();
    }

    clearTimeout(timeoutId);
    clearTimeout(wakeNoticeTimer);

    if (!data || !data.ok || !Array.isArray(data.keypoints) || data.keypoints.length === 0) {
      throw new Error(data?.error || 'Empty keypoints returned by model');
    }

    logMsg(`Backend returned ${data.keypoints.length} keypoints in ${data.inference_ms || 0}ms`, 'success');
    hideToast();

    // Process keypoints and calculate dimensions
    processLandmarksAndMeasurements(data, snapshot);

  } catch (err) {
    clearTimeout(timeoutId);
    clearTimeout(wakeNoticeTimer);
    hideToast();
    state.flowState = STATES.SCANNING;

    if (err.name === 'AbortError') {
      showErrorBanner('Server timeout. The model server may be starting up or GPU queue busy. Please tap Retry.');
    } else {
      showErrorBanner(`Detection error: ${err.message}`);
    }
    console.error('Detection error:', err);
  }
}

/**
 * Executes HRNet prediction via Hugging Face Gradio Queue SSE protocol.
 * This ensures @spaces.GPU decorator is executed and real keypoints are returned!
 */
async function predictViaGradioQueue(jpegBlob, debug, signal) {
  // 1. Upload JPEG to Space
  const uploadData = new FormData();
  uploadData.append('files', jpegBlob, 'frame.jpg');

  const uploadRes = await fetch(`${BACKEND_URL}/upload`, {
    method: 'POST',
    body: uploadData,
    signal
  });

  if (!uploadRes.ok) {
    throw new Error(`Gradio file upload failed (HTTP ${uploadRes.status})`);
  }

  const uploadJson = await uploadRes.json();
  const filePath = Array.isArray(uploadJson) ? uploadJson[0] : uploadJson;
  if (!filePath) {
    throw new Error('Upload succeeded but no file path was returned by server');
  }

  // 2. Join Gradio Queue
  const sessionHash = Math.random().toString(36).substring(2, 12);
  const joinRes = await fetch(`${BACKEND_URL}/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [{ path: filePath }, !!debug],
      event_data: null,
      fn_index: 0,
      session_hash: sessionHash,
      trigger_id: 6
    }),
    signal
  });

  if (!joinRes.ok) {
    throw new Error(`Gradio queue join failed (HTTP ${joinRes.status})`);
  }

  // 3. Listen to SSE Stream until process_completed
  const sseRes = await fetch(`${BACKEND_URL}/queue/data?session_hash=${sessionHash}`, { signal });
  if (!sseRes.ok) {
    throw new Error(`Gradio SSE stream failed (HTTP ${sseRes.status})`);
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        const payload = JSON.parse(trimmed.slice(5).trim());
        if (payload.msg === 'process_starts') {
          showToast('Processing keypoints with ZeroGPU...');
        } else if (payload.msg === 'process_completed') {
          reader.cancel().catch(() => {});
          if (payload.success && payload.output?.data?.[0]) {
            return payload.output.data[0];
          } else if (payload.output?.error) {
            throw new Error(payload.output.error);
          }
        } else if (payload.msg === 'queue_full') {
          throw new Error('Hugging Face GPU queue is currently full. Try again shortly.');
        }
      } catch (jsonErr) {
        if (jsonErr.message && !jsonErr.message.includes('Unexpected token')) {
          throw jsonErr;
        }
      }
    }
  }

  throw new Error('Gradio stream closed before completing prediction');
}

/**
 * Converts 2D returned keypoints into 3D world points using the SAVED frozen snapshot,
 * computes garment measurements, and displays the results.
 */
function processLandmarksAndMeasurements(backendData, snapshot) {
  const keypointsMap = {};
  const unprojectedPoints = [];

  const planePoint = snapshot.surfacePlane?.point || state.surfacePlane?.point || { x: 0, y: -0.5, z: -0.8 };
  const planeNormal = snapshot.surfacePlane?.normal || state.surfacePlane?.normal || { x: 0, y: 1.0, z: 0 };

  // Map each landmark using the SAVED snapshot matrices and plane
  for (const kp of backendData.keypoints) {
    const p3D = unprojectKeypointTo3D(
      kp.u,
      kp.v,
      snapshot.imageWidth,
      snapshot.imageHeight,
      snapshot.projMatrix,
      snapshot.camMatrix,
      planePoint,
      planeNormal,
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
        calculated[m.id] = { id: m.id, label: m.label, valid: false, reason: 'Waist width needed' };
      }
      continue;
    }

    // Direct pairwise landmarks (confidence gating removed per user instruction)
    let bestPair = null;
    let bestDist = 0;

    // 1. Direct pairwise calculation from model detected keypoints
    const pA = keypointsMap[m.landmarks[0]];
    const pB = keypointsMap[m.landmarks[1]];
    if (pA && pB && pA.p3D && pB.p3D) {
      bestPair = [pA, pB];
      bestDist = calculate3DDistance(pA.p3D, pB.p3D);
    }

    // 2. Check fallback landmarks if primary pair is missing
    if (!bestPair && m.fallbackLandmarks) {
      for (const fb of m.fallbackLandmarks) {
        const nameA = fb[0];
        const nameB = fb[1];
        const mult = fb[2] || 1.0;
        const fbA = keypointsMap[nameA];
        const fbB = keypointsMap[nameB];
        if (fbA && fbB && fbA.p3D && fbB.p3D) {
          bestPair = [fbA, fbB];
          bestDist = calculate3DDistance(fbA.p3D, fbB.p3D) * mult;
          break;
        }
      }
    }

    const friendlyName = m.label.toLowerCase();

    if (bestPair) {
      calculated[m.id] = {
        id: m.id,
        label: m.label,
        valid: true,
        distMeters: bestDist,
        distCm: bestDist * 100,
        distInches: bestDist * 39.3701,
        pointA: bestPair[0].p3D,
        pointB: bestPair[1].p3D
      };
    } else {
      state.measurementNotices.push(`Keypoints for ${friendlyName} were not found in backend response.`);
      calculated[m.id] = { id: m.id, label: m.label, valid: false, reason: 'Keypoint missing' };
    }
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
      <div class="garment-label">${pt.name.replace(/_/g, ' ')} (${Math.round(pt.score * 100)}%)</div>
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

  const updateCard = (valEl, subEl, item) => {
    if (!valEl || !subEl) return;
    if (item && item.valid) {
      valEl.textContent = `${item.distCm.toFixed(1)} cm`;
      subEl.textContent = `${item.distInches.toFixed(1)} in`;
    } else {
      valEl.textContent = '--';
      subEl.textContent = item?.reason || 'Not detected';
    }
  };

  // Waist Width & Circ
  updateCard(elements.resWaistWidth, elements.resWaistWidthSub, m.waist_width);
  if (m.waist_circ && m.waist_circ.valid) {
    elements.resWaistCirc.textContent = `${m.waist_circ.distCm.toFixed(1)} cm (${m.waist_circ.distInches.toFixed(1)} in)`;
    elements.resWaistCircSub.textContent = 'approx. (flat)';
  } else {
    elements.resWaistCirc.textContent = '--';
    elements.resWaistCircSub.textContent = m.waist_circ?.reason || 'Not detected';
  }

  if (m.waist_width && m.waist_width.valid && elements.hudDistanceVal) {
    elements.hudDistanceVal.textContent = `${m.waist_width.distCm.toFixed(1)} cm`;
  }

  // Inseam, Outseam, Thigh, Hem
  updateCard(elements.resInseam, elements.resInseamSub, m.inseam);
  updateCard(elements.resOutseam, elements.resOutseamSub, m.outseam);
  updateCard(elements.resThighWidth, elements.resThighWidthSub, m.thigh_width);
  updateCard(elements.resHemWidth, elements.resHemWidthSub, m.hem_width);

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
      const coordStr = p3D ? `X: ${p3D.x.toFixed(3)}m, Y: ${p3D.y.toFixed(3)}m, Z: ${p3D.z.toFixed(3)}m` : 'Unprojected';
      const pixelStr = `2D: (${Math.round(kp.u)}px, ${Math.round(kp.v)}px)`;
      const isWaist = (kp.name === 'waist_left' || kp.name === 'waist_right');
      const tagClass = isWaist ? 'tag-a' : 'tag-b';
      return `
        <tr>
          <td>
            <span class="point-tag ${tagClass}">${kp.name.replace(/_/g, ' ')}</span>
            <small style="color:var(--text-muted);display:block;margin-top:2px;">${pixelStr}</small>
          </td>
          <td><code>${coordStr}</code></td>
          <td><span class="badge success">Plotted</span></td>
        </tr>
      `;
    }).join('');
  }

  // Always show visual 2D keypoints inspection drawer on results screen
  if (elements.debugDrawer && elements.debugCanvas) {
    elements.debugDrawer.classList.remove('hidden');
    renderDebug2DView(snapshot, backendData);
  }
}

/**
 * Draws the captured JPEG with the returned 2D keypoints, labels, and waist measurement line
 */
function renderDebug2DView(snapshot, backendData) {
  const canvas = elements.debugCanvas;
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const keypoints = backendData.keypoints || [];
    let wLeft = null;
    let wRight = null;

    ctx.font = 'bold 14px monospace';
    for (const kp of keypoints) {
      const isWaist = (kp.name === 'waist_left' || kp.name === 'waist_right');
      if (kp.name === 'waist_left') wLeft = kp;
      if (kp.name === 'waist_right') wRight = kp;

      ctx.beginPath();
      ctx.arc(kp.u, kp.v, isWaist ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isWaist ? '#00e5ff' : '#4ade80';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${kp.name.replace(/_/g, ' ')}`, kp.u + 10, kp.v - 4);
    }

    // Connect waist_left and waist_right with a prominent line and distance label
    if (wLeft && wRight) {
      ctx.beginPath();
      ctx.setLineDash([8, 6]);
      ctx.moveTo(wLeft.u, wLeft.v);
      ctx.lineTo(wRight.u, wRight.v);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#00e5ff';
      ctx.stroke();
      ctx.setLineDash([]);

      const m = state.calculatedMeasurements.waist_width;
      if (m && m.valid) {
        const midX = (wLeft.u + wRight.u) / 2;
        const midY = (wLeft.v + wRight.v) / 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(midX - 50, midY - 24, 100, 26);
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`${m.distCm.toFixed(1)} cm`, midX - 35, midY - 6);
      }
    }
  };
  img.src = snapshot.dataUrl;
}

function resetToScanning() {
  state.flowState = STATES.SCANNING;
  state.measurementState = STATES.SCANNING;
  state.frozenSnapshot = null;
  state.detectedKeypointsMap = {};
  state.calculatedMeasurements = {};
  state.measurementNotices = [];
  state.scanRequested = false;
  state.point1 = null;
  state.point2 = null;
  state.point1Pixel = null;
  state.point2Pixel = null;
  state.finalDistanceMeters = 0;
  planeStabilizer.reset();

  hideToast();
  hideErrorBanner();
  if (elements.garmentPinsContainer) elements.garmentPinsContainer.innerHTML = '';
  if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
  if (elements.markerA) elements.markerA.classList.add('hidden');
  if (elements.markerB) elements.markerB.classList.add('hidden');
  if (elements.hudReticleContainer) elements.hudReticleContainer.classList.remove('hidden');
  if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = '--';

  updateTrackingUI(state.surfacePlane !== null, false, state.phoneTiltDeg || 0);
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

  if (!state.surfacePlane) {
    showToast('Scan surface first until surface locks');
    return;
  }

  if (state.measurementState === STATES.SCANNING || state.measurementState === STATES.MANUAL_LOCKED) {
    const pt3D = unprojectKeypointTo3D(
      posX, posY, screenW, screenH,
      state.lastProjMatrix, state.lastCameraMatrix,
      state.surfacePlane.point,
      state.surfacePlane.normal,
      0.0
    );
    if (!pt3D) return;
    state.point1 = pt3D;
    state.point1Pixel = { x: posX, y: posY };
    state.point2 = null;
    state.measurementState = STATES.MANUAL_P1;
    if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = '0.0 cm';
    if (elements.stepText) elements.stepText.textContent = 'Point 1 placed. Aim reticle & tap Point 2';
    if (elements.stepIcon) elements.stepIcon.textContent = '📍';
    if (elements.markerB) elements.markerB.classList.add('hidden');
  } else if (state.measurementState === STATES.MANUAL_P1) {
    const pt3D = unprojectKeypointTo3D(
      posX, posY, screenW, screenH,
      state.lastProjMatrix, state.lastCameraMatrix,
      state.surfacePlane.point,
      state.surfacePlane.normal,
      0.0
    );
    if (!pt3D) return;
    state.point2 = pt3D;
    state.point2Pixel = { x: posX, y: posY };
    state.finalDistanceMeters = calculate3DDistance(state.point1, state.point2);
    state.measurementState = STATES.MANUAL_LOCKED;
    const cm = (state.finalDistanceMeters * 100).toFixed(1);
    const inches = (state.finalDistanceMeters * 39.3701).toFixed(1);
    if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = `${cm} cm (${inches} in)`;
    if (elements.stepText) elements.stepText.textContent = `✓ Measured: ${cm} cm (${inches} in) — Tap ↺ to Rescan`;
    if (elements.stepIcon) elements.stepIcon.textContent = '✓';
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

    // Dynamic Live Distance tracking to center reticle
    let currentReticle3D = null;
    if (state.surfacePlane) {
      currentReticle3D = unprojectKeypointTo3D(
        width / 2, height / 2, width, height,
        projMatrix, state.lastCameraMatrix,
        state.surfacePlane.point,
        state.surfacePlane.normal,
        0.0
      );
    }

    if (currentReticle3D) {
      const liveDist = calculate3DDistance(state.point1, currentReticle3D);
      const cm = (liveDist * 100).toFixed(1);
      const inches = (liveDist * 39.3701).toFixed(1);
      if (elements.hudDistanceVal) {
        elements.hudDistanceVal.textContent = `${cm} cm (${inches} in)`;
      }

      // Draw dynamic measuring line from marker A to center screen
      if (proj1.valid && elements.svgMeasureLine) {
        elements.svgMeasureLine.setAttribute('x1', proj1.xPixel);
        elements.svgMeasureLine.setAttribute('y1', proj1.yPixel);
        elements.svgMeasureLine.setAttribute('x2', width / 2);
        elements.svgMeasureLine.setAttribute('y2', height / 2);
        elements.svgMeasureLine.style.display = 'block';
      }
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
      if (elements.svgMeasureLine) {
        elements.svgMeasureLine.setAttribute('x1', proj1.xPixel);
        elements.svgMeasureLine.setAttribute('y1', proj1.yPixel);
        elements.svgMeasureLine.setAttribute('x2', proj2.xPixel);
        elements.svgMeasureLine.setAttribute('y2', proj2.yPixel);
        elements.svgMeasureLine.style.display = 'block';
      }
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

// Initialize on DOM ready or immediately if already loaded
function init() {
  setupEventListeners();
  checkCompatibility();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
