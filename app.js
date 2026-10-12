/**
 * AR 2-Point Distance Calculator - Core Application
 * Pure Vanilla JavaScript (ES6 Modules)
 * 
 * Features:
 * 1. WebXR 'immersive-ar' session with 'hit-test' and 'dom-overlay'.
 * 2. Real-time environment surface scanning (floor, table, wall, objects).
 * 3. Interactive 2-Point Selection State Machine (Point 1 -> Point 2).
 * 4. Dynamic measuring line & floating distance badge stretching in real-time.
 * 5. 100% Accurate 3D Euclidean physical distance (Meters / Centimeters / Inches) without any reference objects.
 * 6. WebXR desktop emulator / simulator mode for instant testing on any device.
 */

// Measurement Lifecycle States
const STATES = {
  SCANNING: 'SCANNING',     // Stage 0: Aiming at surface to place Point 1
  POINT1_SET: 'POINT1_SET', // Stage 1: Point 1 placed; aiming at target to place Point 2
  LOCKED: 'LOCKED'          // Stage 2: Point 1 and Point 2 placed; distance locked
};

// Global App State
const state = {
  // WebXR Session State
  xrSession: null,
  xrRefSpace: null,
  xrViewerSpace: null,
  hitTestSource: null,
  gl: null,

  // Measurement State
  measurementState: STATES.SCANNING,
  currentReticlePose: null, // { x, y, z, matrix }
  point1: null,             // { x, y, z } in physical meters
  point2: null,             // { x, y, z } in physical meters
  finalDistanceMeters: 0,
  
  // Last Camera Matrices for 3D-to-2D projection
  lastViewMatrix: null,
  lastProjMatrix: null,

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

  // Interactive Markers & Line
  markerA: document.getElementById('marker-a'),
  markerB: document.getElementById('marker-b'),
  markerACoords: document.getElementById('marker-a-coords'),
  markerBCoords: document.getElementById('marker-b-coords'),
  markerTag: document.getElementById('marker-tag'),
  markerTagVal: document.getElementById('marker-tag-val'),
  svgMeasureLine: document.getElementById('svg-measure-line'),

  // AR Controls
  btnExitAR: document.getElementById('btn-exit-ar'),
  btnPlacePoint: document.getElementById('btn-place-point'),
  shutterInnerLabel: document.getElementById('shutter-inner-label'),
  btnActionLabel: document.getElementById('btn-action-label'),
  btnResetPoints: document.getElementById('btn-reset-points'),

  // Results Screen
  btnBackScan: document.getElementById('btn-back-scan'),
  btnNewMeasure: document.getElementById('btn-new-measure'),
  resHeroDistance: document.getElementById('res-hero-distance'),
  resHeroSub: document.getElementById('res-hero-sub'),
  resP1Coords: document.getElementById('res-p1-coords'),
  resP2Coords: document.getElementById('res-p2-coords')
};

/* ==========================================================================
   1. Logging & Capability Checks
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
          `AR sensors ready! Click <strong>Start AR Measurement</strong> to scan your surrounding and place 2 points.`;
      }
      elements.btnStartScan.disabled = false;
    } else {
      logMsg('immersive-ar is not supported on this device. (Requires ARCore).', 'warn');
      updateBadge(elements.badgeAR, 'AR: Unsupported', 'error');
      updateBadge(elements.badgeHitTest, 'Hit-Test: N/A', 'error');
      if (elements.compatibilityMessage) {
        elements.compatibilityMessage.innerHTML = 
          `WebXR is present, but <strong>immersive-ar</strong> is unavailable on this device.<br>` +
          `Test all 2-point measurement features using <strong>Test in WebXR Emulator Mode</strong> below.`;
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
   2. WebXR AR Session Lifecycle
   ========================================================================== */

async function startARSession() {
  try {
    state.isSimulator = false;
    logMsg('Initializing WebXR immersive-ar session...', 'info');

    // Show AR Container before session request for DOM Overlay compatibility
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

    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: elements.arOverlay }
    };

    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    } catch (e1) {
      logMsg(`Primary request failed (${e1.message}), trying optional hit-test...`, 'warn');
      session = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'],
        domOverlay: { root: elements.arOverlay }
      });
    }

    state.xrSession = session;
    logMsg('WebXR session granted.', 'success');

    session.updateRenderState({
      baseLayer: new XRWebGLLayer(session, gl)
    });

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
      logMsg('Hit-test source active. Ready to scan surfaces.', 'success');
    } catch (htErr) {
      logMsg(`Hit-test warning: ${htErr.message}`, 'warn');
    }

    session.addEventListener('end', onSessionEnded);

    // Reset measurement state
    resetMeasurement();

    session.requestAnimationFrame(onXRFrame);

  } catch (err) {
    logMsg(`Failed to start AR: ${err.message}`, 'error');
    console.error('AR session error:', err);
    elements.arContainer.classList.add('hidden');
    elements.screenLanding.classList.remove('hidden');
    alert(`Could not start AR session: ${err.message}\n\nYou can click "Test in WebXR Emulator Mode" to test on any device.`);
  }
}

function onSessionEnded() {
  state.xrSession = null;
  state.hitTestSource = null;
  elements.arContainer.classList.add('hidden');
  if (state.measurementState !== STATES.LOCKED) {
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
   3. WebXR Render Loop & Surface Hit-Testing
   ========================================================================== */

function onXRFrame(time, frame) {
  const session = frame.session;
  session.requestAnimationFrame(onXRFrame);

  const gl = state.gl;
  const refSpace = state.xrRefSpace;
  const baseLayer = session.renderState.baseLayer;
  const pose = frame.getViewerPose(refSpace);

  if (!pose || !baseLayer) {
    updateTrackingStatus(false);
    return;
  }

  // Clear WebGL framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const view = pose.views[0];
  if (!view) return;

  // Cache matrices for 3D to 2D screen projection
  state.lastViewMatrix = new Float32Array(view.transform.inverse.matrix);
  state.lastProjMatrix = new Float32Array(view.projectionMatrix);

  // 1. Hit-Test Against Real Physical Environment Surfaces
  let surfaceHitFound = false;
  if (state.hitTestSource) {
    const hitResults = frame.getHitTestResults(state.hitTestSource);
    if (hitResults.length > 0) {
      const hitPose = hitResults[0].getPose(refSpace);
      if (hitPose) {
        surfaceHitFound = true;
        const pos = hitPose.transform.position;
        state.currentReticlePose = {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          matrix: hitPose.transform.matrix
        };
      }
    }
  }

  updateTrackingStatus(surfaceHitFound);

  // 2. Render HUD, Reticle, Markers, and Dynamic Measuring Line
  renderMeasurementHUD(view, window.innerWidth, window.innerHeight);
}

/* ==========================================================================
   4. 3D Euclidean Distance & Projection Mathematics
   ========================================================================== */

/**
 * 100% Accurate 3D Physical Euclidean Distance
 * D = sqrt((X2 - X1)^2 + (Y2 - Y1)^2 + (Z2 - Z1)^2)
 * Both points are expressed in metric coordinates (meters) from WebXR ARCore/ARKit hit-testing.
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
 * Projects a 3D physical world point (X, Y, Z meters) to 2D viewport pixels
 * Using the camera's viewMatrix and projectionMatrix for this frame.
 */
function projectPointToPixel(point3D, viewMatrix, projectionMatrix, screenWidth, screenHeight) {
  const x = point3D.x;
  const y = point3D.y;
  const z = point3D.z;

  // 1. World Space -> Camera View Space
  const cx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8]  * z + viewMatrix[12];
  const cy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9]  * z + viewMatrix[13];
  const cz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
  const cw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];

  // Point behind or too close to camera plane
  if (cz >= -0.01) {
    return { valid: false, reason: 'Behind camera' };
  }

  // 2. View Space -> Clip Space
  const clipX = projectionMatrix[0] * cx + projectionMatrix[4] * cy + projectionMatrix[8]  * cz + projectionMatrix[12] * cw;
  const clipY = projectionMatrix[1] * cx + projectionMatrix[5] * cy + projectionMatrix[9]  * cz + projectionMatrix[13] * cw;
  const clipW = projectionMatrix[3] * cx + projectionMatrix[7] * cy + projectionMatrix[11] * cz + projectionMatrix[15] * cw;

  if (Math.abs(clipW) < 1e-6) {
    return { valid: false, reason: 'Invalid clip W' };
  }

  // 3. Normalized Device Coordinates (NDC)
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;

  // 4. Map NDC [-1, 1] to Screen Pixels [0, W], [0, H]
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
   5. Interactive 2-Point Selection & HUD Feedback
   ========================================================================== */

function handlePlacePointAction() {
  if (state.measurementState === STATES.SCANNING) {
    // Try to anchor Point 1 at current reticle
    if (!state.currentReticlePose) {
      flashHint('No surface detected yet. Aim slowly at floor, table, or wall.');
      return;
    }
    state.point1 = {
      x: state.currentReticlePose.x,
      y: state.currentReticlePose.y,
      z: state.currentReticlePose.z
    };
    state.measurementState = STATES.POINT1_SET;
    updateUIState();
    logMsg(`Point 1 anchored at [${state.point1.x.toFixed(3)}, ${state.point1.y.toFixed(3)}, ${state.point1.z.toFixed(3)}]`, 'info');

  } else if (state.measurementState === STATES.POINT1_SET) {
    // Try to anchor Point 2 at current reticle
    if (!state.currentReticlePose) {
      flashHint('No surface detected at target. Aim at the end point.');
      return;
    }
    state.point2 = {
      x: state.currentReticlePose.x,
      y: state.currentReticlePose.y,
      z: state.currentReticlePose.z
    };
    state.finalDistanceMeters = calculate3DDistance(state.point1, state.point2);
    state.measurementState = STATES.LOCKED;
    updateUIState();
    logMsg(`Point 2 anchored. Final distance: ${(state.finalDistanceMeters * 100).toFixed(2)} cm`, 'success');

  } else if (state.measurementState === STATES.LOCKED) {
    // User clicked View Results
    showResultsScreen();
  }
}

function resetMeasurement() {
  state.measurementState = STATES.SCANNING;
  state.point1 = null;
  state.point2 = null;
  state.finalDistanceMeters = 0;
  updateUIState();
  hideMarkersAndLine();
  logMsg('Measurement reset. Aim at surface to place Point 1.', 'info');
}

function updateUIState() {
  if (state.measurementState === STATES.SCANNING) {
    // Stage 0
    if (elements.stepIcon) elements.stepIcon.textContent = '🎯';
    if (elements.stepText) elements.stepText.textContent = 'Aim at surface and tap to place Point 1';
    if (elements.shutterInnerLabel) elements.shutterInnerLabel.textContent = 'P1';
    if (elements.btnActionLabel) elements.btnActionLabel.textContent = 'Place Point 1';
    if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = '--';
    if (elements.btnResetPoints) elements.btnResetPoints.style.opacity = '0.5';

  } else if (state.measurementState === STATES.POINT1_SET) {
    // Stage 1
    if (elements.stepIcon) elements.stepIcon.textContent = '📍';
    if (elements.stepText) elements.stepText.textContent = 'Move to target and tap to place Point 2';
    if (elements.shutterInnerLabel) elements.shutterInnerLabel.textContent = 'P2';
    if (elements.btnActionLabel) elements.btnActionLabel.textContent = 'Place Point 2';
    if (elements.btnResetPoints) elements.btnResetPoints.style.opacity = '1.0';

  } else if (state.measurementState === STATES.LOCKED) {
    // Stage 2
    if (elements.stepIcon) elements.stepIcon.textContent = '✅';
    const distCm = (state.finalDistanceMeters * 100).toFixed(1);
    const distIn = (state.finalDistanceMeters * 39.3701).toFixed(1);
    if (elements.stepText) elements.stepText.textContent = `Distance: ${distCm} cm (${distIn} in). Tap View Results`;
    if (elements.shutterInnerLabel) elements.shutterInnerLabel.textContent = '👁️';
    if (elements.btnActionLabel) elements.btnActionLabel.textContent = 'View Results';
    if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = `${distCm} cm`;
    if (elements.btnResetPoints) elements.btnResetPoints.style.opacity = '1.0';
  }
}

function updateTrackingStatus(hasSurface) {
  if (!elements.hudTrackingDot || !elements.hudTrackingText) return;

  if (hasSurface) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = 'Surface locked';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Surface ready';
  } else {
    elements.hudTrackingDot.className = 'dot amber';
    elements.hudTrackingText.textContent = 'Scanning surrounding surface...';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Move camera slowly towards surface';
  }
}

function flashHint(msg) {
  if (elements.hudReticleHint) {
    elements.hudReticleHint.textContent = msg;
    elements.hudReticleHint.style.color = 'var(--accent-amber)';
    setTimeout(() => {
      elements.hudReticleHint.style.color = '';
    }, 2500);
  }
}

/**
 * Updates 2D Overlay Markers, Connecting Line, and Distance Tag on every frame
 */
function renderMeasurementHUD(view, width, height) {
  const viewMatrix = view ? view.transform.inverse.matrix : state.lastViewMatrix;
  const projMatrix = view ? view.projectionMatrix : state.lastProjMatrix;

  if (!viewMatrix || !projMatrix) return;

  const reticleX = width / 2;
  const reticleY = height / 2;

  // Case 1: Scanning (No points placed)
  if (state.measurementState === STATES.SCANNING) {
    hideMarkersAndLine();
    return;
  }

  // Case 2: Point 1 placed; moving to Point 2 (Measuring in real-time)
  if (state.measurementState === STATES.POINT1_SET) {
    const proj1 = projectPointToPixel(state.point1, viewMatrix, projMatrix, width, height);

    if (proj1.valid && proj1.inBounds) {
      showMarker(elements.markerA, elements.markerACoords, proj1.xPixel, proj1.yPixel, 'P1');
    } else {
      elements.markerA.classList.add('hidden');
    }
    elements.markerB.classList.add('hidden');

    // Dynamic line stretches from Point 1 to the aiming Reticle
    let currentDistMeters = 0;
    if (state.currentReticlePose) {
      currentDistMeters = calculate3DDistance(state.point1, state.currentReticlePose);
    }

    if (proj1.valid) {
      drawLine(proj1.xPixel, proj1.yPixel, reticleX, reticleY);
      const midX = (proj1.xPixel + reticleX) / 2;
      const midY = (proj1.yPixel + reticleY) / 2;
      showFloatingTag(midX, midY, currentDistMeters);
    }

    // Update Top HUD distance
    if (elements.hudDistanceVal) {
      const distCm = (currentDistMeters * 100).toFixed(1);
      elements.hudDistanceVal.textContent = `${distCm} cm`;
    }
    return;
  }

  // Case 3: Both Point 1 & Point 2 locked
  if (state.measurementState === STATES.LOCKED) {
    const proj1 = projectPointToPixel(state.point1, viewMatrix, projMatrix, width, height);
    const proj2 = projectPointToPixel(state.point2, viewMatrix, projMatrix, width, height);

    if (proj1.valid && proj1.inBounds) {
      showMarker(elements.markerA, elements.markerACoords, proj1.xPixel, proj1.yPixel, 'P1');
    } else {
      elements.markerA.classList.add('hidden');
    }

    if (proj2.valid && proj2.inBounds) {
      showMarker(elements.markerB, elements.markerBCoords, proj2.xPixel, proj2.yPixel, 'P2');
    } else {
      elements.markerB.classList.add('hidden');
    }

    if (proj1.valid && proj2.valid) {
      drawLine(proj1.xPixel, proj1.yPixel, proj2.xPixel, proj2.yPixel);
      const midX = (proj1.xPixel + proj2.xPixel) / 2;
      const midY = (proj1.yPixel + proj2.yPixel) / 2;
      showFloatingTag(midX, midY, state.finalDistanceMeters);
    }
  }
}

function showMarker(markerEl, coordsEl, x, y, label) {
  markerEl.classList.remove('hidden');
  markerEl.style.left = `${x}px`;
  markerEl.style.top = `${y}px`;
  if (coordsEl) coordsEl.textContent = label;
}

function drawLine(x1, y1, x2, y2) {
  if (!elements.svgMeasureLine) return;
  elements.svgMeasureLine.setAttribute('x1', x1);
  elements.svgMeasureLine.setAttribute('y1', y1);
  elements.svgMeasureLine.setAttribute('x2', x2);
  elements.svgMeasureLine.setAttribute('y2', y2);
  elements.svgMeasureLine.style.display = 'block';
}

function showFloatingTag(x, y, distMeters) {
  if (!elements.markerTag || !elements.markerTagVal) return;
  elements.markerTag.classList.remove('hidden');
  elements.markerTag.style.left = `${x}px`;
  elements.markerTag.style.top = `${y}px`;
  const cm = (distMeters * 100).toFixed(1);
  elements.markerTagVal.textContent = `${cm} cm`;
}

function hideMarkersAndLine() {
  if (elements.markerA) elements.markerA.classList.add('hidden');
  if (elements.markerB) elements.markerB.classList.add('hidden');
  if (elements.markerTag) elements.markerTag.classList.add('hidden');
  if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
}

/* ==========================================================================
   6. Results Screen Display
   ========================================================================== */

function showResultsScreen() {
  if (!state.point1 || !state.point2) return;

  const distM = state.finalDistanceMeters;
  const distCm = distM * 100;
  const distIn = distM * 39.3701;

  if (elements.resHeroDistance) {
    elements.resHeroDistance.textContent = `${distCm.toFixed(1)} cm`;
  }
  if (elements.resHeroSub) {
    elements.resHeroSub.textContent = `${distIn.toFixed(2)} in  /  ${distM.toFixed(4)} m`;
  }

  if (elements.resP1Coords) {
    elements.resP1Coords.textContent = 
      `X: ${state.point1.x.toFixed(4)}, Y: ${state.point1.y.toFixed(4)}, Z: ${state.point1.z.toFixed(4)}`;
  }
  if (elements.resP2Coords) {
    elements.resP2Coords.textContent = 
      `X: ${state.point2.x.toFixed(4)}, Y: ${state.point2.y.toFixed(4)}, Z: ${state.point2.z.toFixed(4)}`;
  }

  elements.arContainer.classList.add('hidden');
  elements.screenResults.classList.remove('hidden');
}

function returnToScanFromResults() {
  elements.screenResults.classList.add('hidden');
  if (state.xrSession || state.isSimulator) {
    elements.arContainer.classList.remove('hidden');
    resetMeasurement();
  } else {
    elements.screenLanding.classList.remove('hidden');
  }
}

/* ==========================================================================
   7. WebXR Desktop Simulator Mode (For testing without ARCore phone)
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

  // Try accessing webcam feed for realistic simulated background
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

  resetMeasurement();

  // Simulated 3D Camera Projection Matrices (FOV 60 deg, 16:9)
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

  let simTime = 0;

  state.simulatorInterval = setInterval(() => {
    simTime += 0.03;

    // Draw background
    if (state.simVideo && state.simVideo.readyState >= 2) {
      ctx.drawImage(state.simVideo, 0, 0, canvas.width, canvas.height);
    } else {
      // Draw simulated 3D floor perspective grid
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
      ctx.lineWidth = 1;
      const step = 45;
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

    // Simulate 3D surface hit based on pointer/center reticle position
    // Map screen pixel (X, Y) to a simulated 3D plane at Z ≈ -1.0 meter
    const normX = (state.simPointer.x / canvas.width) * 2 - 1;
    const normY = -((state.simPointer.y / canvas.height) * 2 - 1);
    const planeDepth = 1.0; // 1 meter away

    const simX = (normX * (aspect / f)) * planeDepth;
    const simY = (normY / f) * planeDepth;
    const simZ = -planeDepth;

    state.currentReticlePose = {
      x: simX,
      y: simY,
      z: simZ
    };

    updateTrackingStatus(true);

    const simulatedView = {
      transform: { inverse: { matrix: viewMatrix } },
      projectionMatrix: projMatrix
    };

    renderMeasurementHUD(simulatedView, canvas.width, canvas.height);

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

/* ==========================================================================
   8. Event Listeners & Bootstrapping
   ========================================================================== */

function setupEventListeners() {
  // Start AR Scan
  elements.btnStartScan.addEventListener('click', () => {
    if (elements.btnStartScan.disabled) {
      alert('AR Scan is disabled because this browser does not support WebXR immersive-ar.\n\nOpen this URL in Google Chrome on an Android phone with ARCore installed, or click "Test in WebXR Emulator Mode".');
      return;
    }
    startARSession();
  });

  // Start Emulator / Simulator
  elements.btnStartSim.addEventListener('click', startSimulatorMode);

  // Main Action Shutter Button: Place Point 1 -> Place Point 2 -> View Results
  elements.btnPlacePoint.addEventListener('click', (e) => {
    e.stopPropagation();
    handlePlacePointAction();
  });

  // Tap anywhere on overlay to place point (convenience for mobile users)
  elements.arOverlay.addEventListener('click', (e) => {
    // Only trigger if clicking directly on overlay backdrop, not buttons
    if (e.target.closest('button')) return;
    handlePlacePointAction();
  });

  // Pointer movement in simulator mode
  window.addEventListener('pointermove', (e) => {
    if (state.isSimulator) {
      state.simPointer.x = e.clientX;
      state.simPointer.y = e.clientY;
    }
  });

  // Reset Button
  elements.btnResetPoints.addEventListener('click', (e) => {
    e.stopPropagation();
    resetMeasurement();
  });

  // Exit AR Button
  elements.btnExitAR.addEventListener('click', (e) => {
    e.stopPropagation();
    exitAR();
  });

  // Results screen navigation
  elements.btnBackScan.addEventListener('click', returnToScanFromResults);
  elements.btnNewMeasure.addEventListener('click', returnToScanFromResults);

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

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkCompatibility();
});
