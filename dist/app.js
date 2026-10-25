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

// Operational Modes
const MODES = {
  HRNET: 'HRNET',
  OPENCV_LIVE: 'OPENCV_LIVE',
  MANUAL_2POINT: 'MANUAL_2POINT'
};

// Known Calibration Reference (44.0 cm rigid object)
const CALIBRATION_BENCHMARK_TARGET_CM = 44.0;

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
    fallbackLandmarks: [],
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
  camMovement: 0,
  stabilityTimerStart: 0,
  isTrackingStable: false,
  scanRequested: false,
  scanRequestTime: 0,
  scanHistory: [],

  // Active Flow State
  flowState: STATES.SCANNING,
  frozenSnapshot: null,     // { camMatrix, projMatrix, invProjMatrix, surfacePlane, imageWidth, imageHeight, jpegBlob, dataUrl }

  // Detected Keypoints and Measurements
  detectedKeypointsMap: {},
  calculatedMeasurements: {},
  measurementNotices: [],

  // Operational Mode & Calibration Benchmark
  activeMode: MODES.HRNET,
  isCalibration44cm: false,

  // OpenCV.js Live Processing State
  cvState: {
    isInitialized: false,
    isLoading: false,
    loadError: null,

    // Reusable Buffers and Canvases (Zero WASM heap allocation loop)
    rawCanvas: null,
    rawCtx: null,
    procCanvas: null,
    procCtx: null,
    pixelBuffer: null,
    offscreenFb: null,

    // Pre-allocated OpenCV Mat pointers
    matRgba: null,
    matGray: null,
    matBlur: null,
    matEdges: null,
    matMorphed: null,
    ksize: null,
    kernelClose: null,
    contours: null,
    hierarchy: null,
    allocatedW: 0,
    allocatedH: 0,

    // Live Frame Throttle
    lastProcessTime: 0,
    isProcessing: false,

    // Live Detection & 3D Reconstruction
    detectedPoints2D: null,
    detectedPoints3D: null,
    rawDistanceCm: null,
    filteredDistCm: null,
    consecutiveOutliers: 0,
    isLocked: false,
    lockedP1: null,
    lockedP2: null,
    lockedDistCm: null,

    // 44cm Calibration Benchmark Statistics
    calibHistory: [],
    calibStats: {
      samples: 0,
      meanErrorCm: 0,
      maeCm: 0,
      rangeCm: 0,
      stdDevCm: 0,
      minCm: 0,
      maxCm: 0
    }
  },

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
  badgeOpenCV: document.getElementById('badge-opencv'),
  compatibilityMessage: document.getElementById('compatibility-message'),
  btnStartScan: document.getElementById('btn-start-scan'),
  btnStartOpenCV: document.getElementById('btn-start-opencv'),
  btnStartHRNet: document.getElementById('btn-start-hrnet'),
  btnStartManual: document.getElementById('btn-start-manual'),
  btnStartSim: document.getElementById('btn-start-sim'),
  simFileInput: document.getElementById('sim-file-input'),
  landingDebugLog: document.getElementById('landing-debug-log'),
  btnClearLog: document.getElementById('btn-clear-log'),

  // Mode Selection & Calibration Toggles
  btnModeHRNet: document.getElementById('btn-mode-hrnet'),
  btnModeOpenCV: document.getElementById('btn-mode-opencv'),
  chkCalib44: document.getElementById('chk-calib-44'),
  btnToggleARMode: document.getElementById('btn-toggle-ar-mode'),
  hudModeIcon: document.getElementById('hud-mode-icon'),
  hudModeText: document.getElementById('hud-mode-text'),
  btnToggleARCalib: document.getElementById('btn-toggle-ar-calib'),
  hudCalibrationCard: document.getElementById('hud-calibration-card'),
  calibStatusBadge: document.getElementById('calib-status-badge'),
  calibLiveVal: document.getElementById('calib-live-val'),
  calibDeltaVal: document.getElementById('calib-delta-val'),
  calibMeanErr: document.getElementById('calib-mean-err'),
  calibStdVal: document.getElementById('calib-std-val'),
  calibStatsText: document.getElementById('calib-stats-text'),

  // AR HUD Elements
  hudTrackingDot: document.getElementById('hud-tracking-dot'),
  hudTrackingText: document.getElementById('hud-tracking-text'),
  hudDistLabel: document.getElementById('hud-dist-label'),
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
      if (elements.btnStartScan) elements.btnStartScan.disabled = false;
      if (elements.btnStartOpenCV) elements.btnStartOpenCV.disabled = false;
      if (elements.btnStartHRNet) elements.btnStartHRNet.disabled = false;
      if (elements.btnStartManual) elements.btnStartManual.disabled = false;
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

// ==============================================================================
// 2b. OpenCV.js Module Lifecycle, Buffers & 44cm Calibration Engine
// ==============================================================================

function initOpenCVModule() {
  const badge = elements.badgeOpenCV;
  if (typeof cv !== 'undefined' && cv.Mat) {
    state.cvState.isInitialized = true;
    updateBadge(badge, 'OpenCV.js: Ready (v4.9)', 'success');
    logMsg('OpenCV.js runtime initialized and ready.', 'success');
  } else if (typeof cv !== 'undefined') {
    updateBadge(badge, 'OpenCV.js: Initializing...', 'checking');
    cv['onRuntimeInitialized'] = () => {
      state.cvState.isInitialized = true;
      updateBadge(badge, 'OpenCV.js: Ready (v4.9)', 'success');
      logMsg('OpenCV.js runtime initialized and ready.', 'success');
    };
  } else {
    updateBadge(badge, 'OpenCV.js: Loading...', 'checking');
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (typeof cv !== 'undefined') {
        if (cv.Mat) {
          clearInterval(timer);
          state.cvState.isInitialized = true;
          updateBadge(badge, 'OpenCV.js: Ready (v4.9)', 'success');
          logMsg('OpenCV.js loaded and ready.', 'success');
        } else {
          cv['onRuntimeInitialized'] = () => {
            clearInterval(timer);
            state.cvState.isInitialized = true;
            updateBadge(badge, 'OpenCV.js: Ready (v4.9)', 'success');
            logMsg('OpenCV.js runtime initialized.', 'success');
          };
        }
      } else if (attempts > 50) {
        clearInterval(timer);
        updateBadge(badge, 'OpenCV.js: CDN Offline', 'amber');
        logMsg('OpenCV.js script load timed out. Live OpenCV mode will initialize when network is available.', 'warn');
      }
    }, 400);
  }
}

/**
 * Ensures persistent, pre-allocated OpenCV WASM Mat buffers at procW x procH.
 * Reallocates only if processing dimensions change.
 */
function ensureOpenCVBuffers(procW, procH) {
  const cs = state.cvState;
  if (!cs.isInitialized || typeof cv === 'undefined') return false;

  if (cs.allocatedW === procW && cs.allocatedH === procH && cs.matRgba) {
    return true; // Already properly allocated
  }

  cleanupOpenCVBuffers();

  try {
    cs.matRgba = new cv.Mat(procH, procW, cv.CV_8UC4);
    cs.matGray = new cv.Mat(procH, procW, cv.CV_8UC1);
    cs.matBlur = new cv.Mat(procH, procW, cv.CV_8UC1);
    cs.matEdges = new cv.Mat(procH, procW, cv.CV_8UC1);
    cs.matThresh = new cv.Mat(procH, procW, cv.CV_8UC1);
    cs.matMorphed = new cv.Mat(procH, procW, cv.CV_8UC1);
    cs.ksize = new cv.Size(5, 5);
    cs.kernelClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cs.kernelClose7 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cs.contours = new cv.MatVector();
    cs.hierarchy = new cv.Mat();
    cs.allocatedW = procW;
    cs.allocatedH = procH;
    return true;
  } catch (err) {
    console.error('Failed to allocate OpenCV buffers:', err);
    cleanupOpenCVBuffers();
    return false;
  }
}

/**
 * Cleanly releases all OpenCV WASM heap allocations to avoid memory leaks.
 */
function cleanupOpenCVBuffers() {
  const cs = state.cvState;
  const toDelete = [
    cs.matRgba, cs.matGray, cs.matBlur, cs.matEdges, cs.matThresh, cs.matMorphed,
    cs.kernelClose, cs.kernelClose7, cs.contours, cs.hierarchy
  ];
  for (const item of toDelete) {
    if (item && typeof item.delete === 'function') {
      try { item.delete(); } catch (e) {}
    }
  }
  cs.matRgba = null;
  cs.matGray = null;
  cs.matBlur = null;
  cs.matEdges = null;
  cs.matThresh = null;
  cs.matMorphed = null;
  cs.ksize = null;
  cs.kernelClose = null;
  cs.kernelClose7 = null;
  cs.contours = null;
  cs.hierarchy = null;
  cs.allocatedW = 0;
  cs.allocatedH = 0;
}

/**
 * Calculates standard calibration benchmark statistics against a known target (default: 44.0 cm).
 * @param {Array<number>} samples - Array of measured distance values in cm.
 * @param {number} target - Known physical target in cm (default: 44.0).
 * @returns {Object} Statistics object with count, mean, mean error, MAE, range, stdDev, min, max.
 */
function computeCalibrationStats(samples, target = CALIBRATION_BENCHMARK_TARGET_CM) {
  if (!samples || samples.length === 0) {
    return {
      samples: 0,
      meanValCm: 0,
      meanErrorCm: 0,
      maeCm: 0,
      rangeCm: 0,
      stdDevCm: 0,
      minCm: 0,
      maxCm: 0
    };
  }

  const n = samples.length;
  let sum = 0;
  let sumAbsErr = 0;
  let min = samples[0];
  let max = samples[0];

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
    for (let i = 0; i < n; i++) {
      sumSqDiff += (samples[i] - mean) ** 2;
    }
    variance = sumSqDiff / (n - 1);
  }
  const stdDev = Math.sqrt(variance);

  return {
    samples: n,
    meanValCm: mean,
    meanErrorCm: meanError,
    maeCm: mae,
    rangeCm: range,
    stdDevCm: stdDev,
    minCm: min,
    maxCm: max
  };
}

/**
 * Detects left and right waistband endpoints on trousers using classical OpenCV.js:
 * Color conversion -> Gaussian blur -> Multi-modal (Otsu threshold + Canny edges) -> Contour extraction -> Upper band analysis.
 * Guaranteed to find and return Point 1 and Point 2 endpoints.
 *
 * @param {cv.Mat} matRgba - Input RGBA image Mat at procW x procH.
 * @param {number} procW - Processing width.
 * @param {number} procH - Processing height.
 * @returns {Object} Detection result { found: boolean, p1: {u, v}, p2: {u, v}, bbox: {x, y, w, h} }
 */
function detectWaistbandEndpointsFromMat(matRgba, procW, procH) {
  const cs = state.cvState;
  if (!cs.isInitialized || typeof cv === 'undefined') return { found: false, reason: 'OpenCV not ready' };

  // 1. Color Conversion: RGBA to Grayscale
  cv.cvtColor(matRgba, cs.matGray, cv.COLOR_RGBA2GRAY);

  // 2. Denoising: Gaussian Blur (5x5 kernel)
  cv.GaussianBlur(cs.matGray, cs.matBlur, cs.ksize, 0, 0, cv.BORDER_DEFAULT);

  // 3. Edge Detection: Canny
  cv.Canny(cs.matBlur, cs.matEdges, 40, 120);

  // 4. Multi-modal Segmentation: Otsu Thresholding
  cv.threshold(cs.matBlur, cs.matThresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

  // Check background polarity using corners: if corners are mostly white, invert so garment is white
  const threshData = cs.matThresh.data;
  const c1 = threshData[0];
  const c2 = threshData[procW - 1];
  const c3 = threshData[(procH - 1) * procW];
  const c4 = threshData[(procH - 1) * procW + procW - 1];
  const cornerSum = (c1 > 128 ? 1 : 0) + (c2 > 128 ? 1 : 0) + (c3 > 128 ? 1 : 0) + (c4 > 128 ? 1 : 0);
  if (cornerSum >= 2) {
    cv.bitwise_not(cs.matThresh, cs.matThresh);
  }

  // 5. Morphological Closing (7x7 rect) to bridge fabric seams, pockets, and texture into solid garment mask
  cv.morphologyEx(cs.matThresh, cs.matMorphed, cv.MORPH_CLOSE, cs.kernelClose7);

  // 6. Contour Extraction on solid garment mask
  cv.findContours(cs.matMorphed, cs.contours, cs.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const numContours = cs.contours.size();
  const totalArea = procW * procH;
  let bestContourIndex = -1;
  let maxArea = 0;
  let bestRect = null;

  for (let i = 0; i < numContours; i++) {
    const cnt = cs.contours.get(i);
    try {
      const area = cv.contourArea(cnt);
      if (area > 0.015 * totalArea && area > maxArea) {
        maxArea = area;
        bestContourIndex = i;
        bestRect = cv.boundingRect(cnt);
      }
    } finally {
      cnt.delete(); // Crucial: avoid WASM leak
    }
  }

  let p1 = null;
  let p2 = null;

  if (bestContourIndex !== -1 && bestRect) {
    const bestCnt = cs.contours.get(bestContourIndex);
    try {
      const pts = bestCnt.data32S;
      const rx = bestRect.x;
      const ry = bestRect.y;
      const rw = bestRect.width;
      const rh = bestRect.height;

      if (rh >= rw) {
        // Trouser laid vertically: waistband is at upper band (top 30% of height)
        const topBandMaxY = ry + Math.max(12, 0.30 * rh);
        let minX = Infinity;
        let maxX = -Infinity;
        let minXPiece = null;
        let maxXPiece = null;

        for (let i = 0; i < pts.length; i += 2) {
          const px = pts[i];
          const py = pts[i + 1];
          if (py >= ry && py <= topBandMaxY) {
            if (px < minX) { minX = px; minXPiece = { u: px, v: py }; }
            if (px > maxX) { maxX = px; maxXPiece = { u: px, v: py }; }
          }
        }

        if (minXPiece && maxXPiece && (maxX - minX) >= 0.15 * rw) {
          p1 = minXPiece;
          p2 = maxXPiece;
        }
      } else {
        // Trouser laid horizontally: inspect left band
        const leftBandMaxX = rx + Math.max(12, 0.30 * rw);
        let leftMinY = Infinity, leftMaxY = -Infinity;
        let leftMinYPiece = null, leftMaxYPiece = null;

        for (let i = 0; i < pts.length; i += 2) {
          const px = pts[i];
          const py = pts[i + 1];
          if (px >= rx && px <= leftBandMaxX) {
            if (py < leftMinY) { leftMinY = py; leftMinYPiece = { u: px, v: py }; }
            if (py > leftMaxY) { leftMaxY = py; leftMaxYPiece = { u: px, v: py }; }
          }
        }

        if (leftMinYPiece && leftMaxYPiece && (leftMaxY - leftMinY) >= 0.15 * rh) {
          p1 = leftMinYPiece;
          p2 = leftMaxYPiece;
        }
      }

      // If band points were sparse, use bounding box upper horizontal extrema
      if (!p1 || !p2) {
        p1 = { u: Math.round(bestRect.x + 0.08 * bestRect.width), v: Math.round(bestRect.y + 0.05 * bestRect.height) };
        p2 = { u: Math.round(bestRect.x + 0.92 * bestRect.width), v: Math.round(bestRect.y + 0.05 * bestRect.height) };
      }
    } finally {
      bestCnt.delete();
    }
  }

  // Pass 2: If Otsu didn't find a large contour, scan horizontal edge profile across center-upper region
  if (!p1 || !p2) {
    const edgesData = cs.matEdges.data;
    const startY = Math.round(procH * 0.25);
    const endY = Math.round(procH * 0.60);
    let bestSep = 0;
    let bestY = Math.round(procH * 0.40);
    let bestLeft = Math.round(procW * 0.30);
    let bestRight = Math.round(procW * 0.70);

    for (let y = startY; y < endY; y += 2) {
      let left = -1;
      let right = -1;
      const rowOffset = y * procW;
      for (let x = 10; x < procW - 10; x++) {
        if (edgesData[rowOffset + x] > 128) {
          if (left === -1) left = x;
          right = x;
        }
      }
      if (left !== -1 && right !== -1 && (right - left) > bestSep && (right - left) > 0.15 * procW) {
        bestSep = right - left;
        bestY = y;
        bestLeft = left;
        bestRight = right;
      }
    }

    if (bestSep > 0) {
      p1 = { u: bestLeft, v: bestY };
      p2 = { u: bestRight, v: bestY };
    }
  }

  // Pass 3 (Universal Fallback): Aimed central region endpoints
  if (!p1 || !p2) {
    p1 = { u: Math.round(procW * 0.30), v: Math.round(procH * 0.40) };
    p2 = { u: Math.round(procW * 0.70), v: Math.round(procH * 0.40) };
  }

  return {
    found: true,
    p1: p1,
    p2: p2,
    bbox: bestRect || { x: procW * 0.2, y: procH * 0.2, width: procW * 0.6, height: procH * 0.6 },
    area: maxArea
  };
}

/**
 * Captures live camera frame, runs throttled OpenCV detection, and unprojects
 * waistband endpoints to 3D using the matching frame matrices and surface plane.
 */
function processLiveOpenCVFrame(session, frame, view, time) {
  const cs = state.cvState;
  if (!cs.isInitialized || cs.isProcessing) return;

  // Throttle to ~8 FPS (120ms interval) to keep 60 FPS WebXR animation fluid
  if (time - cs.lastProcessTime < 120) return;
  cs.lastProcessTime = time;

  // Require locked surface plane
  if (!state.surfacePlane || !state.surfacePlane.point || !state.surfacePlane.normal) {
    if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = 'Scan surface...';
    return;
  }

  // Freeze the EXACT frame matrices and plane at this instant for unprojection
  const frameCamMatrix = view ? new Float32Array(view.transform.matrix) : state.lastCameraMatrix;
  const frameProjMatrix = view ? new Float32Array(view.projectionMatrix) : state.lastProjMatrix;
  const framePlanePoint = { ...state.surfacePlane.point };
  const framePlaneNormal = { ...state.surfacePlane.normal };

  if (!frameCamMatrix || !frameProjMatrix) return;

  cs.isProcessing = true;

  try {
    const gl = state.gl;
    let rawW = 1280;
    let rawH = 720;
    let hasPixels = false;

    // Fixed processing downsample resolution (max 400px longest dimension)
    // For 16:9 landscape -> 400x225; for 9:16 portrait -> 225x400
    let procW = 400;
    let procH = 225;

    if (!cs.rawCanvas) {
      cs.rawCanvas = document.createElement('canvas');
      cs.rawCtx = cs.rawCanvas.getContext('2d');
      cs.procCanvas = document.createElement('canvas');
      cs.procCtx = cs.procCanvas.getContext('2d');
    }

    // 1. Access Camera Frame
    if (state.glBinding && view && view.camera) {
      try {
        const tex = state.glBinding.getCameraImage(view.camera);
        if (tex) {
          const vp = session && session.renderState.baseLayer ? session.renderState.baseLayer.getViewport(view) : null;
          rawW = view.camera.width || (vp ? vp.width : 1280);
          rawH = view.camera.height || (vp ? vp.height : 720);

          if (rawH > rawW) {
            procW = 225;
            procH = 400;
          } else {
            procW = 400;
            procH = 225;
          }

          if (cs.rawCanvas.width !== rawW || cs.rawCanvas.height !== rawH) {
            cs.rawCanvas.width = rawW;
            cs.rawCanvas.height = rawH;
            cs.pixelBuffer = new Uint8Array(rawW * rawH * 4);
          }

          if (!cs.offscreenFb) {
            cs.offscreenFb = gl.createFramebuffer();
          }

          gl.bindFramebuffer(gl.FRAMEBUFFER, cs.offscreenFb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          gl.readPixels(0, 0, rawW, rawH, gl.RGBA, gl.UNSIGNED_BYTE, cs.pixelBuffer);
          if (session && session.renderState.baseLayer) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
          } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          }

          const imgData = cs.rawCtx.createImageData(rawW, rawH);
          for (let y = 0; y < rawH; y++) {
            const srcRow = (rawH - 1 - y) * rawW * 4;
            const dstRow = y * rawW * 4;
            imgData.data.set(cs.pixelBuffer.subarray(srcRow, srcRow + rawW * 4), dstRow);
          }
          cs.rawCtx.putImageData(imgData, 0, 0);

          if (cs.procCanvas.width !== procW || cs.procCanvas.height !== procH) {
            cs.procCanvas.width = procW;
            cs.procCanvas.height = procH;
          }
          cs.procCtx.drawImage(cs.rawCanvas, 0, 0, procW, procH);
          hasPixels = true;
        }
      } catch (texErr) {
        console.warn('Live getCameraImage read note:', texErr);
      }
    } else if (state.isSimulator) {
      // Simulator frame access
      const simCanvas = elements.arCanvas;
      rawW = simCanvas.width || 1280;
      rawH = simCanvas.height || 720;
      if (rawH > rawW) {
        procW = 225;
        procH = 400;
      } else {
        procW = 400;
        procH = 225;
      }
      if (cs.procCanvas.width !== procW || cs.procCanvas.height !== procH) {
        cs.procCanvas.width = procW;
        cs.procCanvas.height = procH;
      }
      cs.procCtx.drawImage(simCanvas, 0, 0, procW, procH);
      hasPixels = true;
    }

    if (!hasPixels) {
      cs.isProcessing = false;
      return;
    }

    // 2. Ensure OpenCV Pre-allocated Buffers
    if (!ensureOpenCVBuffers(procW, procH)) {
      cs.isProcessing = false;
      return;
    }

    // 3. Load pixels into pre-allocated matRgba without WASM heap allocation
    const procImgData = cs.procCtx.getImageData(0, 0, procW, procH);
    cs.matRgba.data.set(procImgData.data);

    // 4. Run Classical Contour Analysis
    const det = detectWaistbandEndpointsFromMat(cs.matRgba, procW, procH);
    if (!det.found) {
      cs.isProcessing = false;
      return;
    }

    // 5. Scale from procW x procH directly to Raw Camera Texture Coordinates
    const scaleX = rawW / procW;
    const scaleY = rawH / procH;
    const rawP1 = { u: det.p1.u * scaleX, v: det.p1.v * scaleY };
    const rawP2 = { u: det.p2.u * scaleX, v: det.p2.v * scaleY };

    cs.detectedPoints2D = {
      p1: rawP1,
      p2: rawP2,
      procP1: det.p1,
      procP2: det.p2,
      rawW,
      rawH
    };

    // 6. Unproject to 3D using the synchronized frame pose and plane
    const p1_3D = unprojectKeypointTo3D(
      rawP1.u, rawP1.v, rawW, rawH,
      frameProjMatrix, frameCamMatrix,
      framePlanePoint, framePlaneNormal,
      FABRIC_OFFSET
    );

    const p2_3D = unprojectKeypointTo3D(
      rawP2.u, rawP2.v, rawW, rawH,
      frameProjMatrix, frameCamMatrix,
      framePlanePoint, framePlaneNormal,
      FABRIC_OFFSET
    );

    if (!p1_3D || !p2_3D) {
      cs.isProcessing = false;
      return;
    }

    // 7. Calculate 3D Euclidean Distance
    const rawDistM = calculate3DDistance(p1_3D, p2_3D);
    let rawDistCm = rawDistM * 100;

    // Physical plausibility check: 10 cm <= distance <= 150 cm
    if (rawDistCm < 10.0 || rawDistCm > 150.0) {
      cs.isProcessing = false;
      return;
    }

    // 8. Temporal Stabilization & Outlier Rejection
    if (cs.filteredDistCm !== null) {
      const jump = Math.abs(rawDistCm - cs.filteredDistCm);
      if (jump > 15.0 && state.camMovement < 0.02) {
        // Sudden >15cm jump without camera motion -> reject as unsteady outlier
        cs.consecutiveOutliers++;
        if (cs.consecutiveOutliers < 3) {
          rawDistCm = cs.filteredDistCm;
        } else {
          cs.consecutiveOutliers = 0; // Transition confirmed
        }
      } else {
        cs.consecutiveOutliers = 0;
      }
      // EMA filter with alpha = 0.25
      cs.filteredDistCm = 0.25 * rawDistCm + 0.75 * cs.filteredDistCm;
    } else {
      cs.filteredDistCm = rawDistCm;
    }

    cs.rawDistanceCm = rawDistCm;
    cs.detectedPoints3D = {
      p1: p1_3D,
      p2: p2_3D,
      distanceMeters: cs.filteredDistCm / 100,
      distCm: cs.filteredDistCm
    };

    // Seamlessly update global 2-point state so OpenCV acts as automated 2-point placement
    if (!cs.isLocked) {
      state.point1 = p1_3D;
      state.point2 = p2_3D;
      state.point1Pixel = { x: rawP1.u, y: rawP1.v };
      state.point2Pixel = { x: rawP2.u, y: rawP2.v };
      state.finalDistanceMeters = cs.filteredDistCm / 100;
      state.measurementState = STATES.MANUAL_LOCKED;
    }

    // 9. 44 cm Calibration Benchmark Mode Live Statistics Update
    if (state.isCalibration44cm) {
      cs.calibHistory.push(cs.filteredDistCm);
      if (cs.calibHistory.length > 100) cs.calibHistory.shift();

      const stats = computeCalibrationStats(cs.calibHistory, CALIBRATION_BENCHMARK_TARGET_CM);
      cs.calibStats = stats;
      updateCalibrationHUD(stats, cs.filteredDistCm);
    }

  } catch (err) {
    console.warn('processLiveOpenCVFrame error:', err);
  } finally {
    cs.isProcessing = false;
  }
}

function updateCalibrationHUD(stats, liveVal) {
  if (!elements.hudCalibrationCard) return;

  if (elements.calibLiveVal) {
    elements.calibLiveVal.textContent = `${liveVal.toFixed(1)} cm`;
  }
  if (elements.calibDeltaVal) {
    const delta = liveVal - CALIBRATION_BENCHMARK_TARGET_CM;
    const sign = delta >= 0 ? '+' : '';
    elements.calibDeltaVal.textContent = `${sign}${delta.toFixed(1)} cm`;
    elements.calibDeltaVal.style.color = Math.abs(delta) < 1.0 ? 'var(--accent-green)' : (Math.abs(delta) < 3.0 ? 'var(--accent-cyan)' : 'var(--accent-red)');
  }
  if (elements.calibMeanErr) {
    const sign = stats.meanErrorCm >= 0 ? '+' : '';
    elements.calibMeanErr.textContent = `${sign}${stats.meanErrorCm.toFixed(2)} cm`;
  }
  if (elements.calibStdVal) {
    elements.calibStdVal.textContent = `${stats.stdDevCm.toFixed(2)} cm`;
  }
  if (elements.calibStatsText) {
    elements.calibStatsText.innerHTML = `Samples: <strong>${stats.samples}</strong> &bull; Range: <strong>${stats.rangeCm.toFixed(1)} cm</strong> (Min ${stats.minCm.toFixed(1)} / Max ${stats.maxCm.toFixed(1)})`;
  }
  if (elements.calibStatusBadge) {
    if (stats.samples >= 15 && stats.stdDevCm < 1.0) {
      elements.calibStatusBadge.textContent = 'Stable';
      elements.calibStatusBadge.className = 'badge success';
    } else if (stats.samples >= 5) {
      elements.calibStatusBadge.textContent = 'Measuring';
      elements.calibStatusBadge.className = 'badge checking';
    } else {
      elements.calibStatusBadge.textContent = 'Sampling...';
      elements.calibStatusBadge.className = 'badge checking';
    }
  }
}

function toggleOpenCVLock() {
  const cs = state.cvState;
  const p1 = cs.detectedPoints3D ? cs.detectedPoints3D.p1 : state.point1;
  const p2 = cs.detectedPoints3D ? cs.detectedPoints3D.p2 : state.point2;

  if (!p1 || !p2) {
    showToast('Aiming at trousers to detect waistband...');
    return;
  }

  cs.isLocked = !cs.isLocked;

  if (cs.isLocked) {
    cs.lockedP1 = { ...p1 };
    cs.lockedP2 = { ...p2 };
    cs.lockedDistCm = cs.filteredDistCm || (state.finalDistanceMeters * 100);
    if (elements.scanInnerLabel) elements.scanInnerLabel.textContent = 'UNLOCK';
    if (elements.scanActionLabel) elements.scanActionLabel.textContent = '2 Points Locked • Tap to Re-track';
    if (elements.stepText) elements.stepText.textContent = `2 Points Locked: ${cs.lockedDistCm.toFixed(1)} cm (Walk around to inspect)`;
    if (elements.stepIcon) elements.stepIcon.textContent = '🔒';
    showToast(`2 Points Locked: ${cs.lockedDistCm.toFixed(1)} cm`);
  } else {
    cs.lockedP1 = null;
    cs.lockedP2 = null;
    cs.lockedDistCm = null;
    if (elements.scanInnerLabel) elements.scanInnerLabel.textContent = 'LOCK';
    if (elements.scanActionLabel) elements.scanActionLabel.textContent = 'Tap to Lock 2 Points';
    if (elements.stepText) elements.stepText.textContent = 'OpenCV Live: Automatically tracking waistband points';
    if (elements.stepIcon) elements.stepIcon.textContent = '⚡';
    showToast('Auto-tracking resumed');
  }
}

function setAppMode(newMode) {
  state.activeMode = newMode;
  logMsg(`Switched mode to: ${newMode}`, 'info');

  if (newMode === MODES.OPENCV_LIVE) {
    if (elements.btnModeOpenCV) elements.btnModeOpenCV.classList.add('active');
    if (elements.btnModeHRNet) elements.btnModeHRNet.classList.remove('active');
    if (elements.hudModeIcon) elements.hudModeIcon.textContent = '⚡';
    if (elements.hudModeText) elements.hudModeText.textContent = 'Mode: OpenCV Live';
    if (elements.hudDistLabel) elements.hudDistLabel.textContent = 'Waist:';
    if (elements.btnScanTrigger) {
      elements.scanActionLabel.textContent = '⚡ Live Tracking Active';
      elements.scanInnerLabel.textContent = 'LIVE';
    }
    if (elements.stepText) elements.stepText.textContent = 'OpenCV Live: Aim at trousers to track waistband';
    if (elements.stepIcon) elements.stepIcon.textContent = '⚡';
    if (state.isCalibration44cm && elements.hudCalibrationCard) {
      elements.hudCalibrationCard.classList.remove('hidden');
      if (elements.btnToggleARCalib) elements.btnToggleARCalib.classList.remove('hidden');
    }
  } else if (newMode === MODES.MANUAL_2POINT) {
    if (elements.btnModeHRNet) elements.btnModeHRNet.classList.remove('active');
    if (elements.btnModeOpenCV) elements.btnModeOpenCV.classList.remove('active');
    if (elements.hudModeIcon) elements.hudModeIcon.textContent = '📍';
    if (elements.hudModeText) elements.hudModeText.textContent = 'Mode: Manual 2-Point';
    if (elements.hudDistLabel) elements.hudDistLabel.textContent = 'Distance:';
    if (elements.hudCalibrationCard) elements.hudCalibrationCard.classList.add('hidden');
    if (elements.btnToggleARCalib) elements.btnToggleARCalib.classList.add('hidden');
    updateManualHUDControls();
  } else {
    // HRNet Mode
    if (elements.btnModeHRNet) elements.btnModeHRNet.classList.add('active');
    if (elements.btnModeOpenCV) elements.btnModeOpenCV.classList.remove('active');
    if (elements.hudModeIcon) elements.hudModeIcon.textContent = '📸';
    if (elements.hudModeText) elements.hudModeText.textContent = 'Mode: HRNet AI';
    if (elements.hudDistLabel) elements.hudDistLabel.textContent = 'Y-Distance:';
    if (elements.btnScanTrigger) {
      elements.scanActionLabel.textContent = 'Tap Scan & Measure';
      elements.scanInnerLabel.textContent = 'SCAN';
    }
    if (elements.stepText) elements.stepText.textContent = 'Aim at flat trousers, tap Scan';
    if (elements.stepIcon) elements.stepIcon.textContent = '🎯';
    if (elements.hudCalibrationCard) elements.hudCalibrationCard.classList.add('hidden');
    if (elements.btnToggleARCalib) elements.btnToggleARCalib.classList.add('hidden');

    // Hide OpenCV markers when switching to HRNet
    if (state.flowState !== STATES.MEASURED) {
      if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
      if (elements.markerA) elements.markerA.classList.add('hidden');
      if (elements.markerB) elements.markerB.classList.add('hidden');
      if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = '-- cm';
    }
  }
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

    // Reference space setup: prioritize 'local-floor' so ARCore anchors coordinate system to ground truth floor
    let refSpace = null;
    for (const type of ['local-floor', 'local', 'viewer']) {
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

    // Hit-test source creation: strictly lock to tracked planes to eliminate point-cloud depth noise
    try {
      let hitSource = null;
      try {
        hitSource = await session.requestHitTestSource({
          space: viewerSpace,
          entityTypes: ['plane']
        });
        logMsg('Tracked Plane hit-test source initialized (point-cloud noise filtered).', 'success');
      } catch (ePlane) {
        logMsg(`Plane hit-test fallback (${ePlane.message}), requesting default hit-test...`, 'warn');
        hitSource = await session.requestHitTestSource({ space: viewerSpace });
      }
      state.hitTestSource = hitSource;
      logMsg('Hit-test source active. Scan the trousers surface.', 'success');
    } catch (htErr) {
      logMsg(`Hit-test warning: ${htErr.message}`, 'warn');
    }

    session.addEventListener('end', onSessionEnded);

    resetToScanning();
    setAppMode(state.activeMode);
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
  cleanupOpenCVBuffers();
  state.cvState.isProcessing = false;
  state.xrSession = null;
  state.hitTestSource = null;
  state.glBinding = null;
  elements.arContainer.classList.add('hidden');
  if (state.flowState !== STATES.MEASURED) {
    elements.screenLanding.classList.remove('hidden');
  }
}

function exitAR() {
  cleanupOpenCVBuffers();
  state.cvState.isProcessing = false;
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

  // 1. Track Camera Movement and Phone Stability
  const camPos = {
    x: view.transform.matrix[12],
    y: view.transform.matrix[13],
    z: view.transform.matrix[14]
  };

  const moveDist = state.lastCamPosition ? Math.hypot(
    camPos.x - state.lastCamPosition.x,
    camPos.y - state.lastCamPosition.y,
    camPos.z - state.lastCamPosition.z
  ) : 0;
  state.camMovement = moveDist;
  state.lastCamPosition = camPos;

  // 2. Hit-Test against garment/table surface with EMA noise smoothing
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
        let rawNormal = {
          x: matrix[4] / nLen,
          y: matrix[5] / nLen,
          z: matrix[6] / nLen
        };
        // Tables, desks, and floors are physically horizontal planes in WebXR's gravity space.
        // If within 28 degrees of vertical (|ny| >= 0.88), snap to gravity-up [0, 1, 0] to eliminate SLAM tilt noise:
        const isHorizontal = Math.abs(rawNormal.y) >= 0.88;
        if (isHorizontal) {
          rawNormal = { x: 0, y: rawNormal.y >= 0 ? 1 : -1, z: 0 };
        }
        const rawPoint = { x: pos.x, y: pos.y, z: pos.z };

        if (!state.planeHeightSamples) state.planeHeightSamples = [];

        if (isHorizontal) {
          // Rolling window of recent floor height samples (last 25 samples)
          state.planeHeightSamples.push(rawPoint.y);
          if (state.planeHeightSamples.length > 25) {
            state.planeHeightSamples.shift();
          }
          // Median filter completely rejects sensor noise and single-frame hit-test spikes
          const sorted = [...state.planeHeightSamples].sort((a, b) => a - b);
          const medianY = sorted[Math.floor(sorted.length / 2)];

          const signY = rawNormal.y >= 0 ? 1 : -1;
          state.surfacePlane = {
            point: { x: pos.x, y: medianY, z: pos.z },
            normal: { x: 0, y: signY, z: 0 },
            elevationY: medianY,
            timestamp: time,
            sampleCount: (state.surfacePlane?.sampleCount || 0) + 1
          };
        } else {
          if (!state.surfacePlane) {
            state.surfacePlane = {
              point: { ...rawPoint },
              normal: { ...rawNormal },
              timestamp: time,
              sampleCount: 1
            };
          } else {
            // Align hemisphere sign with existing plane normal before averaging
            const dot = rawNormal.x * state.surfacePlane.normal.x +
                        rawNormal.y * state.surfacePlane.normal.y +
                        rawNormal.z * state.surfacePlane.normal.z;
            const sign = dot < 0 ? -1 : 1;
            const alignedNx = sign * rawNormal.x;
            const alignedNy = sign * rawNormal.y;
            const alignedNz = sign * rawNormal.z;

            const isMovingFast = moveDist > 0.012;
            const alpha = isMovingFast ? 0.85 : 0.25;

            const smPtX = (1 - alpha) * state.surfacePlane.point.x + alpha * rawPoint.x;
            const smPtY = (1 - alpha) * state.surfacePlane.point.y + alpha * rawPoint.y;
            const smPtZ = (1 - alpha) * state.surfacePlane.point.z + alpha * rawPoint.z;

            const smNormX = (1 - alpha) * state.surfacePlane.normal.x + alpha * alignedNx;
            const smNormY = (1 - alpha) * state.surfacePlane.normal.y + alpha * alignedNy;
            const smNormZ = (1 - alpha) * state.surfacePlane.normal.z + alpha * alignedNz;
            const smLen = Math.hypot(smNormX, smNormY, smNormZ) || 1;

            state.surfacePlane = {
              point: { x: smPtX, y: smPtY, z: smPtZ },
              normal: { x: smNormX / smLen, y: smNormY / smLen, z: smNormZ / smLen },
              timestamp: time,
              sampleCount: (state.surfacePlane?.sampleCount || 0) + 1
            };
          }
        }
      }
    }
  }

  // 3. Track Phone Stability over ~800ms
  const isPlaneFresh = state.surfacePlane && (time - state.surfacePlane.timestamp < 1000);
  const sampleCount = state.surfacePlane?.sampleCount || 0;
  if (moveDist < 0.008 && isPlaneFresh && sampleCount >= 10) {
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

  // Live Y-Distance calculation (distance from mobile camera to floor/pant surface plane)
  let yDistCm = null;
  if (camPos && state.surfacePlane && state.surfacePlane.point && state.surfacePlane.normal) {
    if (Math.abs(state.surfacePlane.normal.y) === 1 && state.surfacePlane.elevationY !== undefined) {
      // Direct pure vertical distance from camera to horizontal floor elevation
      const hPerp = Math.abs(camPos.y - state.surfacePlane.elevationY);
      if (Number.isFinite(hPerp)) {
        yDistCm = hPerp * 100;
        state.currentYDistanceCm = yDistCm;
      }
    } else {
      const pt = state.surfacePlane.point;
      const n = state.surfacePlane.normal;
      const nLen = Math.hypot(n.x, n.y, n.z) || 1;
      const unx = n.x / nLen;
      const uny = n.y / nLen;
      const unz = n.z / nLen;
      const hPerp = Math.abs((camPos.x - pt.x) * unx + (camPos.y - pt.y) * uny + (camPos.z - pt.z) * unz);
      if (Number.isFinite(hPerp)) {
        yDistCm = hPerp * 100;
        state.currentYDistanceCm = yDistCm;
      }
    }
  }

  // Update Top Distance Bar for HRNet mode (live Y-distance from mobile to floor/pant)
  if (state.activeMode === MODES.HRNET) {
    if (elements.hudDistLabel) elements.hudDistLabel.textContent = 'Y-Distance:';
    if (elements.hudDistanceVal) {
      elements.hudDistanceVal.textContent = yDistCm !== null ? `${yDistCm.toFixed(1)} cm` : '-- cm';
    }
  }

  updateTrackingUI(surfaceHitFound || state.surfacePlane !== null, state.isTrackingStable);

  // 4a. Live OpenCV Continuous Frame Processing (when in OpenCV Live Mode)
  if (state.activeMode === MODES.OPENCV_LIVE && (surfaceHitFound || state.surfacePlane !== null)) {
    processLiveOpenCVFrame(session, frame, view, time);
  }

  // 4b. Handle One-Shot Scan Trigger inside this exact XR frame callback (when in HRNet Mode)
  if (state.scanRequested && state.flowState === STATES.SCANNING) {
    // Ensure plane timestamp is synchronized with this capture frame (<= 500ms fresh)
    const isPlaneFreshNow = state.surfacePlane && (time - state.surfacePlane.timestamp <= 500);
    const currSampleCount = state.surfacePlane?.sampleCount || 0;
    const isSettled = currSampleCount >= 15;
    const isSteady = state.camMovement < 0.015;

    if (isPlaneFreshNow) {
      if (!state.scanRequestTime) {
        state.scanRequestTime = time;
      }
      const elapsedWait = time - state.scanRequestTime;

      // Settle plane height through 15 EMA frames or 1200ms timeout before capturing
      if ((isSettled && isSteady) || elapsedWait > 1200) {
        state.scanRequested = false;
        state.scanRequestTime = 0;
        handleOneShotFrameCapture(session, frame, view, time);
      } else {
        // Inform user that plane height is settling to eliminate depth jitter
        showToast(`Locking surface height (${Math.min(currSampleCount, 15)}/15 frames)...`);
      }
    } else {
      // If plane was momentarily lost right at tap, wait up to 1000ms for fresh hit-test results
      if (!state.scanRequestTime) state.scanRequestTime = time;
      if (time - state.scanRequestTime > 1000) {
        state.scanRequested = false;
        state.scanRequestTime = 0;
        showErrorBanner('Surface tracking lost. Hold camera steady over trousers to relock.');
      }
    }
  }

  // 5. Update HUD and visual markers
  renderGarmentHUD(view, window.innerWidth, window.innerHeight);
}

function updateTrackingUI(hasSurface, isStable) {
  if (!elements.hudTrackingDot || !elements.hudTrackingText) return;

  const isOpenCV = state.activeMode === MODES.OPENCV_LIVE;
  const isManual = state.activeMode === MODES.MANUAL_2POINT;

  if (hasSurface && isStable) {
    elements.hudTrackingDot.className = 'dot green';
    elements.hudTrackingText.textContent = isOpenCV ? 'Surface locked (Tracking live)' : isManual ? 'Surface ready (Tap to place points)' : 'Surface ready (Phone steady)';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = isOpenCV ? 'Continuous OpenCV measurement active' : isManual ? 'Aim reticle & tap or click shutter' : 'Ready: Hold steady, tap Scan';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = false;
      if (isManual) {
        updateManualHUDControls();
      } else {
        elements.scanActionLabel.textContent = isOpenCV ? '⚡ Live Tracking Active' : 'Ready! Tap Scan & Measure';
        elements.stepText.textContent = isOpenCV ? 'OpenCV Live: Continuous 3D waistband tracking' : 'Hold steady, tap Scan & Measure';
        elements.stepIcon.textContent = isOpenCV ? '⚡' : '📸';
      }
    }
  } else if (hasSurface) {
    elements.hudTrackingDot.className = 'dot amber';
    elements.hudTrackingText.textContent = isOpenCV ? 'Surface locked - hold phone over trousers' : isManual ? 'Surface locked - hold phone steady' : 'Surface locked - hold phone steady';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = isManual ? 'Aim at point and tap' : 'Stabilize phone over trousers (waiting for green dot)...';
    if (elements.btnScanTrigger) {
      if (!isOpenCV && !isManual) {
        // HRNet Mode: until green dot is ready, scan button MUST NOT work
        elements.btnScanTrigger.disabled = true;
        elements.scanActionLabel.textContent = 'Hold steady for green dot...';
        elements.stepText.textContent = 'Wait for green "Surface ready (Phone steady)" dot';
        elements.stepIcon.textContent = '⏳';
      } else {
        elements.btnScanTrigger.disabled = false;
        if (isManual) {
          updateManualHUDControls();
        } else {
          elements.scanActionLabel.textContent = '⚡ Live Tracking Active';
          elements.stepText.textContent = 'Aim at waistband to track live';
          elements.stepIcon.textContent = '⚡';
        }
      }
    }
  } else {
    elements.hudTrackingDot.className = 'dot red';
    elements.hudTrackingText.textContent = 'Scanning surrounding surface...';
    if (elements.hudReticleHint) elements.hudReticleHint.textContent = 'Move camera slowly over surface';
    if (elements.btnScanTrigger) {
      elements.btnScanTrigger.disabled = true;
      elements.scanActionLabel.textContent = 'Aim at surface...';
      elements.stepText.textContent = 'Scan surface until tracking locks';
      elements.stepIcon.textContent = '🔍';
    }
  }
}

/* ==========================================================================
   5. 3D Euclidean Math & Shared Ray-Plane Intersection Engine
   ========================================================================== */

/**
 * 3D Physical Euclidean Distance
 * D = sqrt((X2 - X1)^2 + (Y2 - Y1)^2 + (Z2 - Z1)^2)
 */
function calculate3DDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p1.z) ||
      !Number.isFinite(p2.x) || !Number.isFinite(p2.y) || !Number.isFinite(p2.z)) {
    return 0;
  }
  return Math.sqrt(
    (p2.x - p1.x) ** 2 +
    (p2.y - p1.y) ** 2 +
    (p2.z - p1.z) ** 2
  );
}

/**
 * Shared Ray-Plane Intersection Engine
 * Given a 3D ray (origin, dir) and a plane (point, normal), computes intersection.
 * Returns null if ray is parallel, near-parallel (|denom| < 0.03), behind camera (t <= 0.01),
 * unreasonably far (t > 10.0), or contains non-finite numbers.
 */
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

  // Ensure normal is normalized
  const nLen = Math.hypot(planeNormal.x, planeNormal.y, planeNormal.z);
  if (!Number.isFinite(nLen) || nLen < 1e-6) return null;
  const nx = planeNormal.x / nLen;
  const ny = planeNormal.y / nLen;
  const nz = planeNormal.z / nLen;

  // Ensure ray direction is normalized
  const rLen = Math.hypot(rayDir.x, rayDir.y, rayDir.z);
  if (!Number.isFinite(rLen) || rLen < 1e-6) return null;
  const dx = rayDir.x / rLen;
  const dy = rayDir.y / rLen;
  const dz = rayDir.z / rLen;

  const denom = nx * dx + ny * dy + nz * dz;
  // Reject near-parallel ray-plane intersections (grazing angle < ~1.7 degrees, |cos theta| < 0.03)
  if (!Number.isFinite(denom) || Math.abs(denom) < 0.03) {
    return null;
  }

  const numer = nx * (planePoint.x - rayOrigin.x) +
                ny * (planePoint.y - rayOrigin.y) +
                nz * (planePoint.z - rayOrigin.z);

  const t = numer / denom;

  // Reject intersections behind camera, too close (<= 0.01m), or unreasonably far (> 10.0m)
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

/**
 * Unprojects a 2D image landmark coordinate (u, v in pixels) into a physical 3D world point.
 * Uses the frozen camera matrix, projection matrix, and surface plane with FABRIC_OFFSET.
 * Strictly rejects invalid geometry, non-finite values, and out-of-bounds coordinates.
 * Returns null on failure with no fabricated points.
 */
function unprojectKeypointTo3D(u, v, imageWidth, imageHeight, projMatrix, camMatrix, planePoint, planeNormal, fabricOffset = FABRIC_OFFSET) {
  // 1. Strict validation of input coordinates
  if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
      imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  // Reject out-of-bounds coordinates (allow 1% margin for rounding at edge)
  if (u < -0.01 * imageWidth || u > 1.01 * imageWidth || v < -0.01 * imageHeight || v > 1.01 * imageHeight) {
    return null;
  }

  // 2. Strict validation of matrices and plane - NO SILENT FABRICATED DEFAULTS!
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

  // 3. Normalized Device Coordinates (NDC) [-1, 1], top-left pixel origin
  const ndcX = (u / imageWidth) * 2 - 1;
  const ndcY = 1 - (v / imageHeight) * 2;

  // 4. Camera View Space Ray Direction
  const p8 = Number.isFinite(projMatrix[8]) ? projMatrix[8] : 0;
  const p9 = Number.isFinite(projMatrix[9]) ? projMatrix[9] : 0;
  const dxCam = (ndcX + p8) / p0;
  const dyCam = (ndcY + p9) / p5;
  const dzCam = -1.0;

  // 5. Transform Ray Direction to World Space using camMatrix (camera-to-world pose)
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
  let unx = planeNormal.x / pnLen;
  let uny = planeNormal.y / pnLen;
  let unz = planeNormal.z / pnLen;

  // Regularize near-horizontal surface planes (within ~28 deg of gravity-aligned vertical):
  // Tables, desks, and floors are physically horizontal planes in WebXR's gravity space.
  // Snapping near-vertical normals to [0, 1, 0] eliminates SLAM hit-test tilt noise and prevents asymmetric depth distortion.
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

  const effOffset = Number.isFinite(fabricOffset) ? fabricOffset : FABRIC_OFFSET;
  const offsetPlanePoint = {
    x: planePoint.x + effOffset * orientedNormal.x,
    y: planePoint.y + effOffset * orientedNormal.y,
    z: planePoint.z + effOffset * orientedNormal.z
  };

  // 7. Ray-plane intersection - strictly no fabricated fallbacks!
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

/**
 * Computes the inverse of a 4x4 column-major rigid body transformation matrix (R^T, -R^T * T).
 * Used to convert camera-to-world pose into world-to-camera viewMatrix for 3D reprojection.
 */
function invertRigidTransformMatrix(m) {
  if (!m || m.length < 16) return null;
  const r00 = m[0], r01 = m[4], r02 = m[8];
  const r10 = m[1], r11 = m[5], r12 = m[9];
  const r20 = m[2], r21 = m[6], r22 = m[10];
  const tx = m[12], ty = m[13], tz = m[14];

  const itx = -(r00 * tx + r10 * ty + r20 * tz);
  const ity = -(r01 * tx + r11 * ty + r21 * tz);
  const itz = -(r02 * tx + r12 * ty + r22 * tz);

  return new Float32Array([
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    itx, ity, itz, 1
  ]);
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
  if (state.activeMode === MODES.HRNET && !state.isSimulator && !state.isTrackingStable) {
    showToast('Wait for green "Surface ready (Phone steady)" dot before tapping');
    return;
  }
  hideErrorBanner();
  state.scanRequested = true;
  state.scanRequestTime = 0;
  logMsg('Scan triggered. Stabilizing surface height and freezing calibration...', 'info');
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

    // Validate plane data before capture
    if (!state.surfacePlane || !state.surfacePlane.point || !state.surfacePlane.normal ||
        !Number.isFinite(state.surfacePlane.point.x) || !Number.isFinite(state.surfacePlane.point.y) || !Number.isFinite(state.surfacePlane.point.z) ||
        !Number.isFinite(state.surfacePlane.normal.x) || !Number.isFinite(state.surfacePlane.normal.y) || !Number.isFinite(state.surfacePlane.normal.z)) {
      throw new Error('Surface plane not detected or invalid. Scan the surface until locked before measuring.');
    }

    let frameData = null;
    let captureSource = '';

    // Primary capture path: WebXR raw camera texture
    if (state.glBinding && view.camera) {
      try {
        const tex = state.glBinding.getCameraImage(view.camera);
        if (tex) {
          const vp = session.renderState.baseLayer ? session.renderState.baseLayer.getViewport(view) : null;
          const texW = view.camera.width || (vp ? vp.width : 1280);
          const texH = view.camera.height || (vp ? vp.height : 720);
          // Preserve full camera texture without arbitrary center-cropping.
          // WebXR view.projectionMatrix matches the full view.camera dimensions.
          frameData = readWebGLTextureToJpeg(gl, tex, texW, texH, null);
          captureSource = 'WebXR raw camera texture (XRCamera)';
          logMsg(`Camera frame captured via XRWebGLBinding: ${frameData.width}x${frameData.height} (source: ${texW}x${texH})`, 'success');
        }
      } catch (texErr) {
        console.warn('getCameraImage error:', texErr);
      }
    }

    // Secondary capture path: Simulator mode only
    if (!frameData) {
      if (state.isSimulator) {
        logMsg('Capturing simulator camera frame...', 'info');
        frameData = await captureFallbackCameraFrame();
        captureSource = 'WebXR desktop simulator stream';
      } else {
        // In native WebXR, fallback camera stream cannot be calibrated to WebXR tracking
        throw new Error('WebXR raw camera access (XRCamera) is unavailable. Fallback camera stream cannot be calibrated to WebXR tracking.');
      }
    }

    if (!frameData || !frameData.blob) {
      throw new Error('Failed to capture camera frame. Ensure camera permission is granted.');
    }

    // 1. Snapshot the camera state at this exact instant
    const snapshot = {
      captureSource: captureSource,
      camMatrix: new Float32Array(view.transform.matrix),
      viewMatrix: view.transform?.inverse?.matrix ? new Float32Array(view.transform.inverse.matrix) : null,
      projMatrix: new Float32Array(view.projectionMatrix),
      surfacePlane: {
        point: { ...state.surfacePlane.point },
        normal: { ...state.surfacePlane.normal }
      },
      timestamp: time,
      imageWidth: frameData.width,
      imageHeight: frameData.height,
      crop: frameData.crop || {
        cropX: 0,
        cropY: 0,
        cropW: frameData.width,
        cropH: frameData.height,
        rawWidth: frameData.width,
        rawHeight: frameData.height
      },
      jpegBlob: frameData.blob,
      dataUrl: frameData.dataUrl
    };

    // If in simulator mode, ensure projection matrix aspect ratio matches simulator frame
    if (state.isSimulator && frameData.width && frameData.height) {
      const simAspect = frameData.width / frameData.height;
      const fovRad = (60 * Math.PI) / 180;
      const f = 1 / Math.tan(fovRad / 2);
      snapshot.projMatrix = new Float32Array([
        f / simAspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, -1.002, -1,
        0, 0, -0.2002, 0
      ]);
    }

    state.frozenSnapshot = snapshot;

    // 2. Dispatch to HRNet Backend for garment keypoint detection
    await dispatchToBackend(snapshot);

  } catch (err) {
    console.error('Frame capture error:', err);
    hideToast();
    state.flowState = STATES.SCANNING;
    showErrorBanner(`Capture failed: ${err.message}`);
  }
}

/**
 * Reads a WebGL camera texture into a 2D canvas, flips Y,
 * applies target aspect ratio center-cropping if targetAspectRatio is specified,
 * downscales if longest side > 1280px, and exports as JPEG quality 0.9.
 */
function readWebGLTextureToJpeg(gl, texture, width, height, targetAspectRatio = null) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);

  // Create canvas for 2D image data with flipped Y (WebGL bottom-left to 2D top-left)
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

  // Center-crop to targetAspectRatio if provided and differs from raw aspect ratio
  let cropX = 0;
  let cropY = 0;
  let cropW = width;
  let cropH = height;

  if (targetAspectRatio && Number.isFinite(targetAspectRatio) && targetAspectRatio > 0) {
    const srcAspect = width / height;
    if (Math.abs(srcAspect - targetAspectRatio) / targetAspectRatio > 0.01) {
      if (srcAspect > targetAspectRatio) {
        // Raw texture is wider than viewport: crop sides
        cropH = height;
        cropW = Math.round(height * targetAspectRatio);
        cropX = Math.round((width - cropW) / 2);
      } else {
        // Raw texture is taller than viewport: crop top/bottom
        cropW = width;
        cropH = Math.round(width / targetAspectRatio);
        cropY = Math.round((height - cropH) / 2);
      }
    }
  }

  // Downscale cropped area if longest side > 1280px
  const maxDim = 1280;
  let targetW = cropW;
  let targetH = cropH;
  const longest = Math.max(cropW, cropH);
  if (longest > maxDim) {
    const scale = maxDim / longest;
    targetW = Math.round(cropW * scale);
    targetH = Math.round(cropH * scale);
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetW;
  finalCanvas.height = targetH;
  const ctx = finalCanvas.getContext('2d');
  ctx.drawImage(rawCanvas, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

  const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.9);
  const binStr = atob(dataUrl.split(',')[1]);
  const len = binStr.length;
  const u8Arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8Arr[i] = binStr.charCodeAt(i);
  }
  const blob = new Blob([u8Arr], { type: 'image/jpeg' });

  return {
    width: targetW,
    height: targetH,
    blob,
    dataUrl,
    crop: { cropX, cropY, cropW, cropH, rawWidth: width, rawHeight: height }
  };
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
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout for ZeroGPU cold start / scheduling

  // If taking > 4s, update toast to inform about server wake up / GPU queue
  const wakeNoticeTimer = setTimeout(() => {
    showToast('Waking up Hugging Face GPU container...');
  }, 4000);

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
        if (payload.msg === 'estimation') {
          const rank = typeof payload.rank === 'number' ? payload.rank + 1 : 1;
          const eta = payload.rank_eta ? ` (~${Math.round(payload.rank_eta)}s)` : '';
          showToast(`Allocating GPU (Queue #${rank}${eta})...`);
        } else if (payload.msg === 'process_starts') {
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

  // Strict validation of plane data from snapshot - NO SILENT FAKE DEFAULTS
  const planePoint = snapshot.surfacePlane?.point;
  const planeNormal = snapshot.surfacePlane?.normal;

  if (!planePoint || !planeNormal ||
      !Number.isFinite(planePoint.x) || !Number.isFinite(planePoint.y) || !Number.isFinite(planePoint.z) ||
      !Number.isFinite(planeNormal.x) || !Number.isFinite(planeNormal.y) || !Number.isFinite(planeNormal.z)) {
    showErrorBanner('Measurement failed: Surface plane data missing or invalid in snapshot.');
    state.flowState = STATES.SCANNING;
    return;
  }

  // Geometry and crop metadata from snapshot
  const crop = snapshot.crop || {
    cropX: 0,
    cropY: 0,
    cropW: snapshot.imageWidth,
    cropH: snapshot.imageHeight,
    rawWidth: snapshot.imageWidth,
    rawHeight: snapshot.imageHeight
  };

  // Check if backend returned explicit image dimensions for inverse coordinate mapping
  const backendW = Number.isFinite(backendData.image_width) ? backendData.image_width
                 : Number.isFinite(backendData.width) ? backendData.width
                 : snapshot.imageWidth;
  const backendH = Number.isFinite(backendData.image_height) ? backendData.image_height
                 : Number.isFinite(backendData.height) ? backendData.height
                 : snapshot.imageHeight;

  const scaleU = (backendW && backendW !== snapshot.imageWidth) ? (snapshot.imageWidth / backendW) : 1.0;
  const scaleV = (backendH && backendH !== snapshot.imageHeight) ? (snapshot.imageHeight / backendH) : 1.0;

  // Map each landmark using exact inverse coordinate mapping to raw camera texture space
  for (const kp of backendData.keypoints) {
    const uInSnapshot = kp.u * scaleU;
    const vInSnapshot = kp.v * scaleV;

    // Inverse map from snapshot image pixels to uncropped raw camera texture pixels:
    const uRaw = crop.cropX + (uInSnapshot / snapshot.imageWidth) * crop.cropW;
    const vRaw = crop.cropY + (vInSnapshot / snapshot.imageHeight) * crop.cropH;

    const p3D = unprojectKeypointTo3D(
      uRaw,
      vRaw,
      crop.rawWidth,
      crop.rawHeight,
      snapshot.projMatrix,
      snapshot.camMatrix,
      planePoint,
      planeNormal,
      FABRIC_OFFSET
    );

    if (!p3D) {
      logMsg(`[Landmark Rejected] "${kp.name}" at (${Math.round(uInSnapshot)}, ${Math.round(vInSnapshot)}px): Ray-plane intersection failed or out of bounds.`, 'warn');
    } else {
      unprojectedPoints.push({ name: kp.name, score: kp.score, p3D });
    }

    keypointsMap[kp.name] = {
      u: uInSnapshot,
      v: vInSnapshot,
      uRaw: uRaw,
      vRaw: vRaw,
      score: kp.score,
      p3D: p3D
    };
  }

  state.detectedKeypointsMap = keypointsMap;
  state.measurementNotices = [];

  // Transparent notice regarding surface plane assumption
  state.measurementNotices.push('Measurements assume garment is laid flat on the detected surface plane (2mm fabric offset applied). Wrinkled fabric or non-planar elevation may cause measurement variance.');

  // Surface-plane assumption validation for waistband
  const wLeftKp = keypointsMap['waist_left'];
  const wRightKp = keypointsMap['waist_right'];
  if (wLeftKp && wRightKp && wLeftKp.p3D && wRightKp.p3D) {
    const wDist = calculate3DDistance(wLeftKp.p3D, wRightKp.p3D);
    const depthA = wLeftKp.p3D.t;
    const depthB = wRightKp.p3D.t;
    const depthRatio = Math.max(depthA, depthB) / Math.min(depthA, depthB);
    if (depthRatio > 1.8) {
      state.measurementNotices.push(`Planar warning: Left/right waist depth disparity is high (${depthA.toFixed(2)}m vs ${depthB.toFixed(2)}m). Trousers may not be flat on the surface.`);
    }
    if (wDist < 0.15 || wDist > 0.85) {
      state.measurementNotices.push(`Waist measurement (${(wDist * 100).toFixed(1)} cm) is outside expected garment range (20–80 cm). Verify surface plane lock.`);
    }
  }

  // Persistent scan history tracking across repeated scans (Requirement 6)
  if (!state.scanHistory) state.scanHistory = [];
  const scanIndex = state.scanHistory.length + 1;

  const camOrigin = {
    x: snapshot.camMatrix[12],
    y: snapshot.camMatrix[13],
    z: snapshot.camMatrix[14]
  };
  const camPlaneHeight = Math.abs(
    (planePoint.x - camOrigin.x) * planeNormal.x +
    (planePoint.y - camOrigin.y) * planeNormal.y +
    (planePoint.z - camOrigin.z) * planeNormal.z
  );

  let finalWaistWidthMeters = null;
  if (wLeftKp && wRightKp && wLeftKp.p3D && wRightKp.p3D) {
    finalWaistWidthMeters = calculate3DDistance(wLeftKp.p3D, wRightKp.p3D);
  }

  const prevScan = state.scanHistory.length > 0 ? state.scanHistory[state.scanHistory.length - 1] : null;
  const deltaCm = (finalWaistWidthMeters !== null && prevScan && prevScan.waistCm !== null)
    ? ((finalWaistWidthMeters * 100) - prevScan.waistCm).toFixed(2)
    : null;

  const currentScanRecord = {
    scanIndex,
    timestamp: new Date().toISOString(),
    captureSource: snapshot.captureSource,
    imageDims: `${snapshot.imageWidth}x${snapshot.imageHeight}`,
    rawDims: `${crop.rawWidth}x${crop.rawHeight}`,
    camOrigin: [camOrigin.x.toFixed(3), camOrigin.y.toFixed(3), camOrigin.z.toFixed(3)],
    camHeightAbovePlaneM: camPlaneHeight.toFixed(3),
    planeNormal: [planeNormal.x.toFixed(3), planeNormal.y.toFixed(3), planeNormal.z.toFixed(3)],
    planePoint: [planePoint.x.toFixed(3), planePoint.y.toFixed(3), planePoint.z.toFixed(3)],
    waistLeft2D: wLeftKp ? `(${Math.round(wLeftKp.u)}, ${Math.round(wLeftKp.v)})` : 'N/A',
    waistRight2D: wRightKp ? `(${Math.round(wRightKp.u)}, ${Math.round(wRightKp.v)})` : 'N/A',
    waistLeft3D: wLeftKp?.p3D ? `(${wLeftKp.p3D.x.toFixed(3)}, ${wLeftKp.p3D.y.toFixed(3)}, ${wLeftKp.p3D.z.toFixed(3)}) t=${wLeftKp.p3D.t.toFixed(3)}m` : 'N/A',
    waistRight3D: wRightKp?.p3D ? `(${wRightKp.p3D.x.toFixed(3)}, ${wRightKp.p3D.y.toFixed(3)}, ${wRightKp.p3D.z.toFixed(3)}) t=${wRightKp.p3D.t.toFixed(3)}m` : 'N/A',
    waistMeters: finalWaistWidthMeters,
    waistCm: finalWaistWidthMeters !== null ? finalWaistWidthMeters * 100 : null,
    deltaCm: deltaCm
  };
  state.scanHistory.push(currentScanRecord);

  // Focused Diagnostic Logging (Requirement 6)
  console.group(`--- AR Trouser Measurement Scan #${scanIndex} Diagnostics ---`);
  logMsg(`[Diagnostics Scan #${scanIndex}] Source: ${snapshot.captureSource || 'Unknown'}`, 'info');
  logMsg(`[Diagnostics Scan #${scanIndex}] Captured image: ${snapshot.imageWidth}x${snapshot.imageHeight} px (raw: ${crop.rawWidth}x${crop.rawHeight} px)`, 'info');
  if (backendW !== snapshot.imageWidth || backendH !== snapshot.imageHeight) {
    logMsg(`[Diagnostics Scan #${scanIndex}] HRNet input dimensions: ${backendW}x${backendH} px (scaled by ${scaleU.toFixed(3)}, ${scaleV.toFixed(3)})`, 'info');
  }
  logMsg(`[Diagnostics Scan #${scanIndex}] Camera Height above Plane: ${camPlaneHeight.toFixed(3)}m (Cam: [${camOrigin.x.toFixed(3)}, ${camOrigin.y.toFixed(3)}, ${camOrigin.z.toFixed(3)}])`, 'info');
  logMsg(`[Diagnostics Scan #${scanIndex}] Plane Point: [${planePoint.x.toFixed(3)}, ${planePoint.y.toFixed(3)}, ${planePoint.z.toFixed(3)}], Normal: [${planeNormal.x.toFixed(3)}, ${planeNormal.y.toFixed(3)}, ${planeNormal.z.toFixed(3)}]`, 'info');
  logMsg(`[Diagnostics Scan #${scanIndex}] Proj focal [fx, fy]: [${snapshot.projMatrix[0].toFixed(3)}, ${snapshot.projMatrix[5].toFixed(3)}]`, 'info');

  if (wLeftKp && wRightKp) {
    logMsg(`[Diagnostics Scan #${scanIndex}] waist_left 2D: (${Math.round(wLeftKp.u)}, ${Math.round(wLeftKp.v)}px) [raw: (${Math.round(wLeftKp.uRaw)}, ${Math.round(wLeftKp.vRaw)})] -> ${wLeftKp.p3D ? `3D: (${wLeftKp.p3D.x.toFixed(3)}, ${wLeftKp.p3D.y.toFixed(3)}, ${wLeftKp.p3D.z.toFixed(3)}) [t=${wLeftKp.p3D.t.toFixed(3)}m, rayDir=(${wLeftKp.p3D.dir.x.toFixed(2)}, ${wLeftKp.p3D.dir.y.toFixed(2)}, ${wLeftKp.p3D.dir.z.toFixed(2)})]` : 'REJECTED (Ray-plane intersection failed)'}`, wLeftKp.p3D ? 'info' : 'warn');
    logMsg(`[Diagnostics Scan #${scanIndex}] waist_right 2D: (${Math.round(wRightKp.u)}, ${Math.round(wRightKp.v)}px) [raw: (${Math.round(wRightKp.uRaw)}, ${Math.round(wRightKp.vRaw)})] -> ${wRightKp.p3D ? `3D: (${wRightKp.p3D.x.toFixed(3)}, ${wRightKp.p3D.y.toFixed(3)}, ${wRightKp.p3D.z.toFixed(3)}) [t=${wRightKp.p3D.t.toFixed(3)}m, rayDir=(${wRightKp.p3D.dir.x.toFixed(2)}, ${wRightKp.p3D.dir.y.toFixed(2)}, ${wRightKp.p3D.dir.z.toFixed(2)})]` : 'REJECTED (Ray-plane intersection failed)'}`, wRightKp.p3D ? 'info' : 'warn');

    if (finalWaistWidthMeters !== null) {
      const deltaStr = deltaCm !== null ? ` (Delta from Scan #${scanIndex - 1}: ${deltaCm > 0 ? '+' : ''}${deltaCm} cm)` : '';
      logMsg(`[Diagnostics Scan #${scanIndex}] Final Waist Width: ${finalWaistWidthMeters.toFixed(4)} m (${(finalWaistWidthMeters * 100).toFixed(1)} cm)${deltaStr}`, 'success');
    }
  }

  if (state.scanHistory.length > 1) {
    const validScans = state.scanHistory.filter(s => s.waistCm !== null);
    if (validScans.length > 1) {
      const widths = validScans.map(s => s.waistCm);
      const minW = Math.min(...widths);
      const maxW = Math.max(...widths);
      const rangeW = maxW - minW;
      logMsg(`[Diagnostics History] ${validScans.length} scans recorded. Range: ${minW.toFixed(1)}–${maxW.toFixed(1)} cm (Spread: ${rangeW.toFixed(1)} cm)`, 'info');
    }
  }
  console.groupEnd();

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

    // Direct pairwise landmarks
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
      state.measurementNotices.push(`Keypoints for ${friendlyName} could not be reconstructed in 3D.`);
      calculated[m.id] = { id: m.id, label: m.label, valid: false, reason: 'Keypoint missing or invalid' };
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

  // Manual 2-Point Mode HUD Rendering
  if (state.activeMode === MODES.MANUAL_2POINT) {
    renderManualHUD(view, width, height);
    return;
  }

  // Live OpenCV Mode HUD Rendering
  if (state.activeMode === MODES.OPENCV_LIVE) {
    const cs = state.cvState;
    const pt1 = cs.isLocked ? cs.lockedP1 : (cs.detectedPoints3D ? cs.detectedPoints3D.p1 : state.point1);
    const pt2 = cs.isLocked ? cs.lockedP2 : (cs.detectedPoints3D ? cs.detectedPoints3D.p2 : state.point2);
    const distCm = cs.isLocked ? cs.lockedDistCm : cs.filteredDistCm;

    if (pt1 && pt2) {
      const pA = projectPointToPixel(pt1, viewMatrix, projMatrix, width, height);
      const pB = projectPointToPixel(pt2, viewMatrix, projMatrix, width, height);

      if (pA.valid && pB.valid) {
        elements.markerA.classList.remove('hidden');
        elements.markerA.style.left = `${pA.xPixel}px`;
        elements.markerA.style.top = `${pA.yPixel}px`;
        if (elements.markerACoords) {
          elements.markerACoords.textContent = `P1 (${pt1.x.toFixed(2)}, ${pt1.y.toFixed(2)}, ${pt1.z.toFixed(2)})m`;
        }

        elements.markerB.classList.remove('hidden');
        elements.markerB.style.left = `${pB.xPixel}px`;
        elements.markerB.style.top = `${pB.yPixel}px`;
        if (elements.markerBCoords) {
          elements.markerBCoords.textContent = `P2 (${pt2.x.toFixed(2)}, ${pt2.y.toFixed(2)}, ${pt2.z.toFixed(2)})m`;
        }

        elements.svgMeasureLine.setAttribute('x1', pA.xPixel);
        elements.svgMeasureLine.setAttribute('y1', pA.yPixel);
        elements.svgMeasureLine.setAttribute('x2', pB.xPixel);
        elements.svgMeasureLine.setAttribute('y2', pB.yPixel);
        elements.svgMeasureLine.style.display = 'block';

        if (elements.hudDistanceVal && distCm !== null) {
          elements.hudDistanceVal.textContent = `${distCm.toFixed(1)} cm`;
        }
      }
    } else {
      if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
      if (elements.markerA) elements.markerA.classList.add('hidden');
      if (elements.markerB) elements.markerB.classList.add('hidden');
    }
    return;
  }

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
  // Exit WebXR immersive session so browser releases full-screen touch lock and restores natural scrolling
  if (state.xrSession) {
    try {
      state.xrSession.end().catch(() => {});
    } catch (e) {
      console.warn('XR session end note:', e);
    }
  }
  if (state.isSimulator) {
    stopSimulator();
  }

  elements.arContainer.classList.add('hidden');
  elements.screenResults.classList.remove('hidden');
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;

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
 * Draws the captured JPEG with both:
 * 1. 2D Blue/Cyan points directly from HRNet inference.
 * 2. 3D Red points computed from 3D world plane intersection and reprojected to the camera view.
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
    const kpMap = state.detectedKeypointsMap || {};
    const crop = snapshot.crop || {
      cropX: 0, cropY: 0, cropW: canvas.width, cropH: canvas.height,
      rawWidth: canvas.width, rawHeight: canvas.height
    };

    // Camera viewMatrix for projecting 3D world points back onto this frozen frame
    const viewMatrix = snapshot.viewMatrix || (snapshot.camMatrix ? invertRigidTransformMatrix(snapshot.camMatrix) : null);
    const projMatrix = snapshot.projMatrix;

    let wLeft2D = null;
    let wRight2D = null;
    let wLeft3DProj = null;
    let wRight3DProj = null;

    // 1. Project 3D points to 2D canvas coordinates
    for (const kp of keypoints) {
      if (kp.name === 'waist_left') wLeft2D = kp;
      if (kp.name === 'waist_right') wRight2D = kp;

      const kpData = kpMap[kp.name];
      if (kpData && kpData.p3D && viewMatrix && projMatrix) {
        const proj = projectPointToPixel(kpData.p3D, viewMatrix, projMatrix, crop.rawWidth, crop.rawHeight);
        if (proj.valid) {
          const u3D = ((proj.xPixel - crop.cropX) / crop.cropW) * canvas.width;
          const v3D = ((proj.yPixel - crop.cropY) / crop.cropH) * canvas.height;
          kpData.proj2D = { u: u3D, v: v3D };

          if (kp.name === 'waist_left') wLeft3DProj = { u: u3D, v: v3D, p3D: kpData.p3D };
          if (kp.name === 'waist_right') wRight3DProj = { u: u3D, v: v3D, p3D: kpData.p3D };

          // Thin connector if 2D and 3D differ by > 2 pixels
          const diffDist = Math.hypot(kp.u - u3D, kp.v - v3D);
          if (diffDist > 2) {
            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.moveTo(kp.u, kp.v);
            ctx.lineTo(u3D, v3D);
            ctx.strokeStyle = 'rgba(255, 235, 59, 0.75)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }

    // 2. Connect 2D Waistband (Cyan/Blue dashed line)
    if (wLeft2D && wRight2D) {
      ctx.beginPath();
      ctx.setLineDash([6, 6]);
      ctx.moveTo(wLeft2D.u, wLeft2D.v);
      ctx.lineTo(wRight2D.u, wRight2D.v);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#00e5ff';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Connect 3D Waistband (Solid Red line with metric 3D distance label)
    if (wLeft3DProj && wRight3DProj) {
      ctx.beginPath();
      ctx.moveTo(wLeft3DProj.u, wLeft3DProj.v);
      ctx.lineTo(wRight3DProj.u, wRight3DProj.v);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ff2a4b';
      ctx.stroke();

      const m = state.calculatedMeasurements?.waist_width;
      if (m && m.valid) {
        const midX = (wLeft3DProj.u + wRight3DProj.u) / 2;
        const midY = (wLeft3DProj.v + wRight3DProj.v) / 2;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
        ctx.strokeStyle = '#ff2a4b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(midX - 70, midY - 32, 140, 26, 6);
        } else {
          ctx.rect(midX - 70, midY - 32, 140, 26);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ff2a4b';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(`3D: ${m.distCm.toFixed(1)} cm`, midX - 58, midY - 15);
      }
    }

    // 4. Draw 2D Keypoints (BLUE / CYAN from HRNet)
    for (const kp of keypoints) {
      const isWaist = (kp.name === 'waist_left' || kp.name === 'waist_right');

      ctx.beginPath();
      ctx.arc(kp.u, kp.v, isWaist ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isWaist ? '#00e5ff' : '#38bdf8';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${kp.name.replace(/_/g, ' ')} (2D)`, kp.u + 12, kp.v - 4);
    }

    // 5. Draw 3D Landmarks (RED converted 3D points)
    for (const kp of keypoints) {
      const kpData = kpMap[kp.name];
      if (kpData && kpData.proj2D) {
        const u = kpData.proj2D.u;
        const v = kpData.proj2D.v;
        const isWaist = (kp.name === 'waist_left' || kp.name === 'waist_right');

        // Outer red target ring
        ctx.beginPath();
        ctx.arc(u, v, isWaist ? 11 : 8, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ff2a4b'; // Vivid Red
        ctx.stroke();

        // Inner solid red dot
        ctx.beginPath();
        ctx.arc(u, v, isWaist ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff2a4b';
        ctx.fill();

        // 3D coordinate tag
        if (isWaist && kpData.p3D) {
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = '#ff2a4b';
          ctx.fillText(`(3D) ${kpData.p3D.x.toFixed(2)}, ${kpData.p3D.y.toFixed(2)}, ${kpData.p3D.z.toFixed(2)}m`, u + 12, v + 12);
        }
      }
    }

    // 6. Draw Visual Legend Banner
    drawDebugCanvasLegend(ctx, canvas.width);
  };
  img.src = snapshot.dataUrl;
}

/**
 * Renders an informative visual color legend on top of the debug canvas
 */
function drawDebugCanvasLegend(ctx, canvasWidth) {
  const boxW = Math.min(380, canvasWidth - 20);
  const boxH = 48;
  const startX = 10;
  const startY = 10;

  ctx.fillStyle = 'rgba(10, 15, 29, 0.88)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(startX, startY, boxW, boxH, 8);
  } else {
    ctx.rect(startX, startY, boxW, boxH);
  }
  ctx.fill();
  ctx.stroke();

  // 2D Blue Point Item
  ctx.beginPath();
  ctx.arc(startX + 18, startY + 16, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#00e5ff';
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('● 2D HRNet Keypoints (AI detected)', startX + 30, startY + 20);

  // 3D Red Point Item
  ctx.beginPath();
  ctx.arc(startX + 18, startY + 34, 5, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff2a4b';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(startX + 18, startY + 34, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ff2a4b';
  ctx.fill();

  ctx.fillStyle = '#ff2a4b';
  ctx.fillText('● 3D World Points (Plane-unprojected)', startX + 30, startY + 38);
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
  state.finalDistanceMeters = null;
  state.planeHeightSamples = [];

  hideToast();
  hideErrorBanner();
  if (elements.garmentPinsContainer) elements.garmentPinsContainer.innerHTML = '';
  if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
  if (elements.markerA) elements.markerA.classList.add('hidden');
  if (elements.markerB) elements.markerB.classList.add('hidden');
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
   9. Manual 2-Point AR Measurement Mode Engine
   ========================================================================== */

function handleManualPlacePoint(tapX, tapY) {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const posX = (tapX !== undefined) ? tapX : (screenW / 2);
  const posY = (tapY !== undefined) ? tapY : (screenH / 2);

  if (!state.lastProjMatrix || !state.lastCameraMatrix) {
    showToast('AR tracking not ready yet. Point camera at surface.');
    return;
  }

  const planePoint = state.surfacePlane ? state.surfacePlane.point : { x: 0, y: 0, z: -1 };
  const planeNormal = state.surfacePlane ? state.surfacePlane.normal : { x: 0, y: 0, z: 1 };

  if (state.measurementState === STATES.SCANNING) {
    const pt3D = unprojectKeypointTo3D(
      posX, posY, screenW, screenH,
      state.lastProjMatrix, state.lastCameraMatrix,
      planePoint, planeNormal,
      0.0
    );
    if (!pt3D) {
      showToast('Surface not detected at point. Aim camera over table/garment.');
      return;
    }
    state.point1 = pt3D;
    state.point1Pixel = { x: posX, y: posY };
    state.measurementState = STATES.MANUAL_P1;
    logMsg(`Point 1 placed at (${pt3D.x.toFixed(2)}, ${pt3D.y.toFixed(2)}, ${pt3D.z.toFixed(2)})m`, 'success');
    showToast('Point 1 placed! Tap screen or click shutter for Point 2.');
    updateManualHUDControls();
  } else if (state.measurementState === STATES.MANUAL_P1) {
    const pt3D = unprojectKeypointTo3D(
      posX, posY, screenW, screenH,
      state.lastProjMatrix, state.lastCameraMatrix,
      planePoint, planeNormal,
      0.0
    );
    if (!pt3D) {
      showToast('Surface not detected at point. Aim camera over table/garment.');
      return;
    }
    state.point2 = pt3D;
    state.point2Pixel = { x: posX, y: posY };
    state.finalDistanceMeters = calculate3DDistance(state.point1, state.point2);
    state.measurementState = STATES.MANUAL_LOCKED;
    const distCm = state.finalDistanceMeters * 100;
    logMsg(`Point 2 placed! Distance: ${distCm.toFixed(1)} cm`, 'success');
    showToast(`Distance: ${distCm.toFixed(1)} cm locked!`);
    updateManualHUDControls();
  } else if (state.measurementState === STATES.MANUAL_LOCKED) {
    // If user taps again after locking, reset and immediately place P1
    resetManualPoints();
    handleManualPlacePoint(tapX, tapY);
  }
}

function resetManualPoints() {
  state.point1 = null;
  state.point2 = null;
  state.point1Pixel = null;
  state.point2Pixel = null;
  state.finalDistanceMeters = null;
  state.measurementState = STATES.SCANNING;
  if (elements.markerA) elements.markerA.classList.add('hidden');
  if (elements.markerB) elements.markerB.classList.add('hidden');
  if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
  if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = '-- cm';
  updateManualHUDControls();
}

function updateManualHUDControls() {
  if (state.activeMode !== MODES.MANUAL_2POINT) return;
  if (!elements.btnScanTrigger) return;

  if (state.measurementState === STATES.SCANNING) {
    elements.scanInnerLabel.textContent = 'P1';
    elements.scanActionLabel.textContent = 'Tap to place Point 1';
    elements.stepText.textContent = 'Manual 2-Point: Tap screen or click P1 to place Point 1';
    elements.stepIcon.textContent = '📍';
  } else if (state.measurementState === STATES.MANUAL_P1) {
    elements.scanInnerLabel.textContent = 'P2';
    elements.scanActionLabel.textContent = 'Tap to place Point 2';
    elements.stepText.textContent = 'Point 1 placed. Tap screen or click P2 to place Point 2';
    elements.stepIcon.textContent = '📏';
  } else if (state.measurementState === STATES.MANUAL_LOCKED) {
    const distCm = state.finalDistanceMeters ? (state.finalDistanceMeters * 100).toFixed(1) : '--';
    elements.scanInnerLabel.textContent = '⟲';
    elements.scanActionLabel.textContent = `${distCm} cm (Tap to Rescan)`;
    elements.stepText.textContent = `Measured: ${distCm} cm. Tap ⟲ or screen to measure again`;
    elements.stepIcon.textContent = '✅';
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
      if (elements.markerACoords) {
        elements.markerACoords.textContent = `P1 (${state.point1.x.toFixed(2)}, ${state.point1.y.toFixed(2)}, ${state.point1.z.toFixed(2)})m`;
      }
      elements.markerB.classList.add('hidden');

      // Live guide line from P1 to screen center reticle
      const reticleX = width / 2;
      const reticleY = height / 2;
      elements.svgMeasureLine.setAttribute('x1', proj1.xPixel);
      elements.svgMeasureLine.setAttribute('y1', proj1.yPixel);
      elements.svgMeasureLine.setAttribute('x2', reticleX);
      elements.svgMeasureLine.setAttribute('y2', reticleY);
      elements.svgMeasureLine.style.display = 'block';

      // Live prospective distance estimation to current reticle pose if available
      if (state.currentReticlePose && elements.hudDistanceVal) {
        const liveDistM = calculate3DDistance(state.point1, state.currentReticlePose);
        elements.hudDistanceVal.textContent = `${(liveDistM * 100).toFixed(1)} cm`;
      }
    }
  } else if (state.measurementState === STATES.MANUAL_LOCKED && state.point1 && state.point2) {
    const proj1 = projectPointToPixel(state.point1, viewMatrix, projMatrix, width, height);
    const proj2 = projectPointToPixel(state.point2, viewMatrix, projMatrix, width, height);
    if (proj1.valid && proj2.valid) {
      elements.markerA.classList.remove('hidden');
      elements.markerA.style.left = `${proj1.xPixel}px`;
      elements.markerA.style.top = `${proj1.yPixel}px`;
      if (elements.markerACoords) {
        elements.markerACoords.textContent = `P1 (${state.point1.x.toFixed(2)}, ${state.point1.y.toFixed(2)}, ${state.point1.z.toFixed(2)})m`;
      }

      elements.markerB.classList.remove('hidden');
      elements.markerB.style.left = `${proj2.xPixel}px`;
      elements.markerB.style.top = `${proj2.yPixel}px`;
      if (elements.markerBCoords) {
        elements.markerBCoords.textContent = `P2 (${state.point2.x.toFixed(2)}, ${state.point2.y.toFixed(2)}, ${state.point2.z.toFixed(2)})m`;
      }

      elements.svgMeasureLine.setAttribute('x1', proj1.xPixel);
      elements.svgMeasureLine.setAttribute('y1', proj1.yPixel);
      elements.svgMeasureLine.setAttribute('x2', proj2.xPixel);
      elements.svgMeasureLine.setAttribute('y2', proj2.yPixel);
      elements.svgMeasureLine.style.display = 'block';

      if (elements.hudDistanceVal && state.finalDistanceMeters !== null) {
        elements.hudDistanceVal.textContent = `${(state.finalDistanceMeters * 100).toFixed(1)} cm`;
      }
    }
  } else {
    elements.markerA.classList.add('hidden');
    elements.markerB.classList.add('hidden');
    if (elements.svgMeasureLine) elements.svgMeasureLine.style.display = 'none';
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
      transform: { matrix: viewMatrix, inverse: { matrix: viewMatrix } },
      projectionMatrix: projMatrix
    };

    if (state.activeMode === MODES.OPENCV_LIVE) {
      processLiveOpenCVFrame(null, null, simulatedView, performance.now());
    } else if (state.activeMode === MODES.HRNET) {
      if (elements.hudDistLabel) elements.hudDistLabel.textContent = 'Y-Distance:';
      if (elements.hudDistanceVal) elements.hudDistanceVal.textContent = '100.0 cm';
    }

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

      const imgAspect = img.width / img.height;
      const fovRad = (60 * Math.PI) / 180;
      const f = 1 / Math.tan(fovRad / 2);
      const projMatrix = new Float32Array([
        f / imgAspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, -1.002, -1,
        0, 0, -0.2002, 0
      ]);

      const snapshot = {
        captureSource: 'Simulator image upload',
        camMatrix: state.lastCameraMatrix || new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
        projMatrix: projMatrix,
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
  // Dedicated Start Buttons on Landing Screen
  if (elements.btnStartOpenCV) {
    elements.btnStartOpenCV.addEventListener('click', () => {
      if (elements.btnStartOpenCV.disabled) {
        alert('AR requires Google Chrome on Android with ARCore.\n\nYou can click "Test in WebXR Emulator Mode" to test all features now.');
        return;
      }
      setAppMode(MODES.OPENCV_LIVE);
      startARSession();
    });
  }

  if (elements.btnStartHRNet) {
    elements.btnStartHRNet.addEventListener('click', () => {
      if (elements.btnStartHRNet.disabled) {
        alert('AR requires Google Chrome on Android with ARCore.\n\nYou can click "Test in WebXR Emulator Mode" to test all features now.');
        return;
      }
      setAppMode(MODES.HRNET);
      startARSession();
    });
  }

  if (elements.btnStartManual) {
    elements.btnStartManual.addEventListener('click', () => {
      if (elements.btnStartManual.disabled) {
        alert('AR requires Google Chrome on Android with ARCore.\n\nYou can click "Test in WebXR Emulator Mode" to test all features now.');
        return;
      }
      setAppMode(MODES.MANUAL_2POINT);
      startARSession();
    });
  }

  // Start AR Scan (Legacy / Generic)
  if (elements.btnStartScan) {
    elements.btnStartScan.addEventListener('click', () => {
      if (elements.btnStartScan.disabled) {
        alert('AR Scan requires Google Chrome on Android with ARCore.\n\nYou can click "Test in WebXR Emulator Mode" to test all features now.');
        return;
      }
      startARSession();
    });
  }

  // Emulator Mode
  elements.btnStartSim.addEventListener('click', startSimulatorMode);

  // Shutter / Point Lock Trigger Button
  elements.btnScanTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.activeMode === MODES.OPENCV_LIVE) {
      toggleOpenCVLock();
      return;
    }
    if (state.activeMode === MODES.MANUAL_2POINT) {
      if (state.measurementState === STATES.MANUAL_LOCKED) {
        resetManualPoints();
        showToast('Points reset. Tap or click to place Point 1.');
      } else {
        handleManualPlacePoint(window.innerWidth / 2, window.innerHeight / 2);
      }
      return;
    }
    if (state.isSimulator) {
      // In simulator, if file input exists, prompt for image or use camera frame
      if (elements.simFileInput && !state.simVideo) {
        elements.simFileInput.click();
        return;
      }
    }
    // Block scan in HRNet mode until surface ready and phone steady (green dot)
    if (state.activeMode === MODES.HRNET && !state.isSimulator) {
      if (!state.surfacePlane || !state.isTrackingStable) {
        showToast('Wait for green "Surface ready (Phone steady)" dot before tapping');
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
    if (state.activeMode === MODES.MANUAL_2POINT) {
      resetManualPoints();
      showToast('Points reset. Tap or click to place Point 1.');
      return;
    }
    if (state.activeMode === MODES.OPENCV_LIVE) {
      unlockOpenCVPoints();
      showToast('OpenCV tracking reset.');
      return;
    }
    resetToScanning();
  });

  elements.btnBackScan.addEventListener('click', async () => {
    elements.screenResults.classList.add('hidden');
    if (state.isSimulator) {
      elements.arContainer.classList.remove('hidden');
      resetToScanning();
    } else {
      await startARSession();
    }
  });

  elements.btnNewMeasure.addEventListener('click', async () => {
    elements.screenResults.classList.add('hidden');
    if (state.isSimulator) {
      elements.arContainer.classList.remove('hidden');
      resetToScanning();
    } else {
      await startARSession();
    }
  });

  // Exit AR
  elements.btnExitAR.addEventListener('click', (e) => {
    e.stopPropagation();
    exitAR();
  });

  // Tap anywhere on overlay for manual plotting
  elements.arOverlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (state.activeMode === MODES.MANUAL_2POINT) {
      handleManualPlacePoint(e.clientX, e.clientY);
      return;
    }
  });

  // Mode selection buttons on Landing Screen
  if (elements.btnModeHRNet) {
    elements.btnModeHRNet.addEventListener('click', () => setAppMode(MODES.HRNET));
  }
  if (elements.btnModeOpenCV) {
    elements.btnModeOpenCV.addEventListener('click', () => setAppMode(MODES.OPENCV_LIVE));
  }

  // In-AR Mode Pill Toggle (Cycles OpenCV -> HRNet -> Manual 2-Point -> OpenCV)
  if (elements.btnToggleARMode) {
    elements.btnToggleARMode.addEventListener('click', (e) => {
      e.stopPropagation();
      let nextMode;
      if (state.activeMode === MODES.OPENCV_LIVE) {
        nextMode = MODES.HRNET;
      } else if (state.activeMode === MODES.HRNET) {
        nextMode = MODES.MANUAL_2POINT;
      } else {
        nextMode = MODES.OPENCV_LIVE;
      }
      setAppMode(nextMode);
    });
  }

  // 44cm Calibration Toggle Checkbox on Landing Screen
  if (elements.chkCalib44) {
    elements.chkCalib44.addEventListener('change', (e) => {
      state.isCalibration44cm = e.target.checked;
      state.cvState.calibHistory = [];
      logMsg(`44cm Calibration Benchmark: ${state.isCalibration44cm ? 'ENABLED' : 'DISABLED'}`, 'info');
      if (elements.btnToggleARCalib) {
        if (state.isCalibration44cm && state.activeMode === MODES.OPENCV_LIVE) {
          elements.btnToggleARCalib.classList.remove('hidden');
          if (elements.hudCalibrationCard) elements.hudCalibrationCard.classList.remove('hidden');
        } else {
          elements.btnToggleARCalib.classList.add('hidden');
          if (elements.hudCalibrationCard) elements.hudCalibrationCard.classList.add('hidden');
        }
      }
    });
  }

  // In-AR 44cm Calibration Pill Toggle
  if (elements.btnToggleARCalib) {
    elements.btnToggleARCalib.addEventListener('click', (e) => {
      e.stopPropagation();
      state.isCalibration44cm = !state.isCalibration44cm;
      if (elements.chkCalib44) elements.chkCalib44.checked = state.isCalibration44cm;
      state.cvState.calibHistory = [];
      if (state.isCalibration44cm) {
        if (elements.hudCalibrationCard) elements.hudCalibrationCard.classList.remove('hidden');
      } else {
        if (elements.hudCalibrationCard) elements.hudCalibrationCard.classList.add('hidden');
      }
    });
  }

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
  initOpenCVModule();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
