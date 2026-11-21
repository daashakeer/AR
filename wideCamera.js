/**
 * Wide-FOV Camera Capture Subsystem for AR Garment Measurement
 * 
 * Provides:
 * 1. CameraDiagnostics: Probes WebXR vs getUserMedia, resolution, zoom, lenses, constraints.
 * 2. WideCameraController: Acquires widest usable 4:3 rear-facing stream with minimum zoom.
 * 3. CameraDeviceSelector: Discovers and toggles between available rear camera devices/lenses.
 * 4. CameraPreview: Zero-distortion live preview with correct orientation and aspect ratio.
 * 5. GarmentFramingOverlay: Trouser framing guide to ensure waist-to-hem fits within FOV.
 */

// ==============================================================================
// 1. CameraDiagnostics
// ==============================================================================

export class CameraDiagnostics {
  /**
   * Performs comprehensive hardware & browser diagnostics on all exposed cameras.
   * @param {Object} [xrState] - Optional state from active WebXR session.
   * @returns {Promise<Object>} Diagnostic report object
   */
  static async runDiagnostics(xrState = null) {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      hasEnumerateDevices: !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices),
      webxr: {
        isAvailable: !!navigator.xr,
        activeSession: !!(xrState && xrState.xrSession),
        cameraAccessSupported: typeof XRWebGLBinding !== 'undefined' && 'getCameraImage' in (XRWebGLBinding.prototype || {}),
        viewCameraWidth: xrState?.view?.camera?.width || null,
        viewCameraHeight: xrState?.view?.camera?.height || null
      },
      videoDevices: [],
      rearDevices: [],
      probedCapabilities: null,
      probedSettings: null,
      zoomSupported: false,
      zoomRange: null,
      summary: ''
    };

    if (!report.hasMediaDevices) {
      report.summary = 'MediaDevices API not supported on this browser/platform.';
      return report;
    }

    try {
      // 1. Enumerate all connected media devices
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput');

      report.videoDevices = videoDevices.map((d, idx) => ({
        index: idx,
        deviceId: d.deviceId ? `${d.deviceId.substring(0, 8)}...` : 'unknown',
        fullDeviceId: d.deviceId,
        label: d.label || `Camera ${idx + 1} (Permission needed to view label)`,
        groupId: d.groupId ? `${d.groupId.substring(0, 8)}...` : 'unknown',
        isRearCandidate: CameraDeviceSelector.isRearFacingCandidate(d)
      }));

      report.rearDevices = report.videoDevices.filter(d => d.isRearCandidate);

      // 2. Probe primary rear camera capabilities via temporary test stream
      let probeStream = null;
      try {
        probeStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
            aspectRatio: { ideal: 4 / 3 }
          }
        });

        const track = probeStream.getVideoTracks()[0];
        if (track) {
          const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
          const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};

          report.probedCapabilities = caps;
          report.probedSettings = settings;

          if (caps.zoom) {
            report.zoomSupported = true;
            report.zoomRange = {
              min: caps.zoom.min,
              max: caps.zoom.max,
              step: caps.zoom.step,
              current: settings.zoom || caps.zoom.min
            };
          }
        }
      } catch (probeErr) {
        report.probeError = probeErr.message;
      } finally {
        if (probeStream) {
          probeStream.getTracks().forEach(t => t.stop());
        }
      }

      // 3. Compose readable summary
      const rearCount = report.rearDevices.length;
      const zoomText = report.zoomSupported ? `Zoom supported (${report.zoomRange.min}x - ${report.zoomRange.max}x)` : 'No optical/digital zoom API';
      const resText = report.probedSettings ? `${report.probedSettings.width}x${report.probedSettings.height} (aspect ${report.probedSettings.aspectRatio?.toFixed(2) || 'N/A'})` : 'Resolution unprobed';

      report.summary = `Detected ${videoDevices.length} cameras (${rearCount} rear-facing candidates). ${resText}. ${zoomText}.`;

    } catch (err) {
      report.summary = `Diagnostics error: ${err.message}`;
    }

    return report;
  }

  /**
   * Logs diagnostics report to console and optional log output callback.
   */
  static logReport(report, logFn = console.log) {
    logFn('--- 📷 CAMERA & OPTICAL DIAGNOSTICS REPORT ---');
    logFn(`Timestamp: ${report.timestamp}`);
    logFn(`WebXR AR Camera: ${report.webxr.activeSession ? 'ACTIVE' : 'INACTIVE'} (Raw Access: ${report.webxr.cameraAccessSupported ? 'YES' : 'NO'})`);
    logFn(`Total Video Devices: ${report.videoDevices.length}`);
    report.videoDevices.forEach(d => {
      logFn(`  • [${d.isRearCandidate ? 'REAR' : 'FRONT/OTHER'}] ${d.label} (ID: ${d.deviceId})`);
    });
    if (report.probedSettings) {
      logFn(`Probed Settings: ${report.probedSettings.width}x${report.probedSettings.height}, Aspect: ${report.probedSettings.aspectRatio || (report.probedSettings.width / report.probedSettings.height).toFixed(2)}`);
    }
    if (report.zoomSupported) {
      logFn(`Zoom Capabilities: Min: ${report.zoomRange.min}x, Max: ${report.zoomRange.max}x, Step: ${report.zoomRange.step}`);
    } else {
      logFn('Zoom Control: Not exposed by browser MediaStreamTrack');
    }
    logFn(`Summary: ${report.summary}`);
    logFn('---------------------------------------------');
  }
}

// ==============================================================================
// 2. CameraDeviceSelector
// ==============================================================================

export class CameraDeviceSelector {
  constructor() {
    this.devices = [];
    this.rearDevices = [];
    this.currentIndex = 0;
  }

  /**
   * Heuristic to test if a device is likely rear-facing.
   * Checks labels for keywords and common Android Camera2 naming conventions.
   */
  static isRearFacingCandidate(device) {
    if (!device) return false;
    const label = (device.label || '').toLowerCase();

    // Positive rear keywords
    const isExplicitRear = label.includes('back') ||
                          label.includes('rear') ||
                          label.includes('environment') ||
                          label.includes('world') ||
                          label.includes('facing back') ||
                          label.includes('camera 0') || // standard main rear on many Androids
                          label.includes('camera 2');   // standard ultrawide rear on many Androids

    // Negative front keywords
    const isExplicitFront = label.includes('front') ||
                           label.includes('user') ||
                           label.includes('selfie') ||
                           label.includes('camera 1'); // standard front on many Androids

    if (isExplicitFront) return false;
    if (isExplicitRear) return true;

    // If label is empty (permission not yet granted), treat as candidate to allow probing
    return !label;
  }

  /**
   * Updates list of available rear camera devices.
   */
  async updateDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      this.devices = [];
      this.rearDevices = [];
      return [];
    }

    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all.filter(d => d.kind === 'videoinput');
    this.rearDevices = this.devices.filter(d => CameraDeviceSelector.isRearFacingCandidate(d));

    // Fallback: if no devices explicitly identified as rear, allow all video devices
    if (this.rearDevices.length === 0 && this.devices.length > 0) {
      this.rearDevices = [...this.devices];
    }

    return this.rearDevices;
  }

  /**
   * Returns current active camera device object.
   */
  getCurrentDevice() {
    if (this.rearDevices.length === 0) return null;
    return this.rearDevices[this.currentIndex % this.rearDevices.length];
  }

  /**
   * Steps to the next available rear camera device index.
   */
  getNextDeviceId() {
    if (this.rearDevices.length <= 1) return null;
    this.currentIndex = (this.currentIndex + 1) % this.rearDevices.length;
    return this.rearDevices[this.currentIndex].deviceId;
  }
}

// ==============================================================================
// 3. WideCameraController
// ==============================================================================

export class WideCameraController {
  constructor(options = {}) {
    this.deviceSelector = new CameraDeviceSelector();
    this.activeStream = null;
    this.activeTrack = null;
    this.activeSettings = null;
    this.activeCapabilities = null;
    this.activeZoom = 1.0;
    this.minZoom = 1.0;
    this.isAcquiring = false;
    this.lastError = null;

    this.onStreamChanged = options.onStreamChanged || null;
    this.onStatus = options.onStatus || null;
  }

  /**
   * Acquires the widest usable rear-camera stream with ideal 4:3 configuration.
   * Uses ideal constraints with graceful fallbacks (never exact).
   * @param {string} [preferredDeviceId] - Optional specific deviceId to acquire.
   * @returns {Promise<MediaStream>}
   */
  async acquireWideStream(preferredDeviceId = null) {
    if (this.isAcquiring) return this.activeStream;
    this.isAcquiring = true;
    this.lastError = null;

    if (this.onStatus) this.onStatus('Configuring wide-angle camera...', 'loading');

    // 1. Refresh available devices
    await this.deviceSelector.updateDevices();

    // 2. Build prioritized constraint configurations
    // Preference: 4:3 aspect ratio, highest practical resolution, minimum zoom
    const constraintTiers = [
      // Tier 1: Preferred 4:3 High-Res (Full sensor aspect ratio on standard mobile sensors)
      {
        audio: false,
        video: {
          deviceId: preferredDeviceId ? { ideal: preferredDeviceId } : undefined,
          facingMode: preferredDeviceId ? undefined : { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: 4 / 3 }
        }
      },
      // Tier 2: 4:3 Standard Res
      {
        audio: false,
        video: {
          deviceId: preferredDeviceId ? { ideal: preferredDeviceId } : undefined,
          facingMode: preferredDeviceId ? undefined : { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          aspectRatio: { ideal: 4 / 3 }
        }
      },
      // Tier 3: General Environment Camera (Browser selects default resolution)
      {
        audio: false,
        video: {
          deviceId: preferredDeviceId ? { ideal: preferredDeviceId } : undefined,
          facingMode: preferredDeviceId ? undefined : { ideal: 'environment' }
        }
      },
      // Tier 4: Basic Video (Last resort fallback)
      {
        audio: false,
        video: true
      }
    ];

    let acquiredStream = null;
    let usedTier = -1;

    for (let i = 0; i < constraintTiers.length; i++) {
      try {
        acquiredStream = await navigator.mediaDevices.getUserMedia(constraintTiers[i]);
        if (acquiredStream && acquiredStream.getVideoTracks().length > 0) {
          usedTier = i;
          break;
        }
      } catch (err) {
        console.warn(`WideCameraController: Tier ${i + 1} acquisition failed:`, err.message);
      }
    }

    if (!acquiredStream) {
      this.isAcquiring = false;
      this.lastError = new Error('Could not access any rear camera. Please check camera permissions.');
      if (this.onStatus) this.onStatus(this.lastError.message, 'error');
      throw this.lastError;
    }

    // Stop previously running stream if any
    this.stopStream();

    this.activeStream = acquiredStream;
    this.activeTrack = acquiredStream.getVideoTracks()[0];

    // 3. Inspect track capabilities and apply minimum zoom if available
    await this.applyMinimumZoom(this.activeTrack);

    // 4. Record active track settings
    this.activeSettings = typeof this.activeTrack.getSettings === 'function' ? this.activeTrack.getSettings() : {};
    this.activeCapabilities = typeof this.activeTrack.getCapabilities === 'function' ? this.activeTrack.getCapabilities() : {};

    this.isAcquiring = false;

    const width = this.activeSettings.width || 'Unknown';
    const height = this.activeSettings.height || 'Unknown';
    const aspect = (this.activeSettings.width && this.activeSettings.height)
      ? (this.activeSettings.width / this.activeSettings.height).toFixed(2)
      : 'N/A';
    const zoomLabel = this.minZoom < 1.0 ? `Zoom: ${this.minZoom}x (Ultra-Wide)` : `Zoom: ${this.minZoom}x`;

    const statusMsg = `Wide Camera Active: ${width}×${height} (${aspect}) • ${zoomLabel}`;
    if (this.onStatus) this.onStatus(statusMsg, 'success');

    if (this.onStreamChanged) {
      this.onStreamChanged(this.activeStream, this.activeSettings);
    }

    return this.activeStream;
  }

  /**
   * Attempts to set the minimum available zoom value on the track.
   * If minimum zoom is < 1.0 (e.g. 0.5 or 0.6), this engages the hardware ultra-wide lens.
   * @param {MediaStreamTrack} track
   */
  async applyMinimumZoom(track) {
    if (!track || typeof track.getCapabilities !== 'function') return;

    try {
      const capabilities = track.getCapabilities();
      if (capabilities && capabilities.zoom) {
        this.minZoom = capabilities.zoom.min;
        const currentZoom = (typeof track.getSettings === 'function' ? track.getSettings().zoom : null) || 1.0;

        // Apply min zoom if available and different from current
        if (typeof this.minZoom === 'number' && this.minZoom <= currentZoom) {
          try {
            await track.applyConstraints({
              advanced: [{ zoom: this.minZoom }]
            });
            this.activeZoom = this.minZoom;
          } catch (zoomErr) {
            console.warn('WideCameraController: Could not apply minimum zoom constraint:', zoomErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('WideCameraController: Zoom inspection error:', e);
    }
  }

  /**
   * Switches to the next available rear camera device.
   * Verifies that the new stream works before committing.
   */
  async switchCamera() {
    const nextDeviceId = this.deviceSelector.getNextDeviceId();
    if (!nextDeviceId) {
      if (this.onStatus) this.onStatus('Only one rear camera detected on this device.', 'info');
      return this.activeStream;
    }

    try {
      return await this.acquireWideStream(nextDeviceId);
    } catch (err) {
      console.warn('WideCameraController: Switch camera failed, rolling back to default:', err);
      return await this.acquireWideStream(null);
    }
  }

  /**
   * Captures a high-resolution, uncropped 2D frame snapshot from the active wide video stream.
   * @param {HTMLVideoElement} videoElement
   * @returns {Promise<{width: number, height: number, blob: Blob, dataUrl: string}>}
   */
  async captureFrame(videoElement) {
    if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      throw new Error('Wide camera video stream is not currently playing or ready for capture.');
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));

    return {
      width,
      height,
      aspectRatio: width / height,
      blob,
      dataUrl,
      zoom: this.activeZoom,
      crop: {
        cropX: 0,
        cropY: 0,
        cropW: width,
        cropH: height,
        rawWidth: width,
        rawHeight: height
      }
    };
  }

  /**
   * Stops all active camera stream tracks and releases hardware resources.
   */
  stopStream() {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.activeStream = null;
      this.activeTrack = null;
    }
  }
}

// ==============================================================================
// 4. GarmentFramingOverlay
// ==============================================================================

export class GarmentFramingOverlay {
  /**
   * Injects the trouser framing guide SVG and guidance banners into the target preview container.
   * @param {HTMLElement} container
   */
  static renderFramingGuide(container) {
    let overlay = container.querySelector('.wide-framing-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'wide-framing-overlay';
    overlay.innerHTML = `
      <!-- Dynamic SVG Trouser Framing Guide Silhouette -->
      <svg class="framing-svg-guide" viewBox="0 0 400 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="guideGlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#2997ff" stop-opacity="0.9" />
            <stop offset="50%" stop-color="#00e5ff" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#30d158" stop-opacity="0.9" />
          </linearGradient>
        </defs>

        <!-- Waistband Alignment Area (Top) -->
        <rect x="50" y="45" width="300" height="40" rx="8" class="guide-waist-zone" />
        <line x1="50" y1="65" x2="350" y2="65" class="guide-line guide-waist-line" />
        <text x="200" y="38" class="guide-text" text-anchor="middle">━ ALIGN WAISTBAND HERE ━</text>

        <!-- Trouser Outline (Waist down to hems) -->
        <!-- Left Leg Outer / Outseam -->
        <path d="M 60,65 L 50,150 L 70,350 L 90,540" class="guide-line guide-outer-seam" />
        <!-- Right Leg Outer / Outseam -->
        <path d="M 340,65 L 350,150 L 330,350 L 310,540" class="guide-line guide-outer-seam" />

        <!-- Crotch & Inner Seams (Inseam) -->
        <path d="M 170,540 L 190,320 L 200,230 L 210,320 L 230,540" class="guide-line guide-inner-seam" />

        <!-- Hem Alignment Area (Bottom) -->
        <rect x="70" y="520" width="120" height="35" rx="6" class="guide-hem-zone" />
        <rect x="210" y="520" width="120" height="35" rx="6" class="guide-hem-zone" />
        <line x1="60" y1="540" x2="340" y2="540" class="guide-line guide-hem-line" />
        <text x="200" y="580" class="guide-text" text-anchor="middle">━ ALIGN HEMS HERE ━</text>
      </svg>

      <!-- Real-time Framing Guidance Banner -->
      <div class="framing-status-banner" id="wide-framing-status">
        <span class="framing-status-icon">📐</span>
        <span class="framing-status-text">Fit entire trousers inside framing guide</span>
      </div>
    `;

    container.appendChild(overlay);
    return overlay;
  }

  /**
   * Updates framing guidance message based on detected keypoints or distance.
   */
  static updateGuidance(message, isWarning = false) {
    const banner = document.getElementById('wide-framing-status');
    if (!banner) return;
    const textEl = banner.querySelector('.framing-status-text');
    if (textEl) textEl.textContent = message;

    if (isWarning) {
      banner.classList.add('warning');
    } else {
      banner.classList.remove('warning');
    }
  }
}

// ==============================================================================
// 5. CameraPreview
// ==============================================================================

export class CameraPreview {
  /**
   * Initializes and mounts the Wide Capture Preview inside the target container.
   * @param {HTMLElement} targetParent - Element to host the preview (e.g. arOverlay)
   * @param {WideCameraController} controller
   * @param {Object} options
   */
  static create(targetParent, controller, options = {}) {
    let container = document.getElementById('wide-camera-preview-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'wide-camera-preview-container';
      container.className = 'wide-camera-container hidden';
      container.innerHTML = `
        <!-- Live Wide Video Element -->
        <div class="wide-video-wrapper">
          <video id="wide-preview-video" class="wide-preview-video" autoplay playsinline muted></video>
        </div>

        <!-- Top Controls / Lens Switcher Bar -->
        <div class="wide-controls-top">
          <div class="wide-pill-group">
            <span id="wide-lens-indicator" class="wide-pill">📷 4:3 Wide (1x)</span>
            <span id="wide-res-indicator" class="wide-pill wide-res-pill">1920×1440</span>
          </div>

          <button type="button" id="btn-switch-camera" class="wide-icon-btn" title="Switch Rear Lens / Camera" style="display:none;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
              <path d="M21 21v-5h-5"></path>
            </svg>
            <span class="btn-lens-label">Switch Lens</span>
          </button>
        </div>

        <!-- Setup / Loading Spinner State -->
        <div id="wide-camera-loader" class="wide-loader-overlay hidden">
          <div class="toast-spinner"></div>
          <span id="wide-loader-text">Acquiring wide-angle lens...</span>
        </div>

        <!-- Error Notification State -->
        <div id="wide-camera-error" class="wide-error-banner hidden">
          <span id="wide-error-text">Camera error</span>
          <button type="button" id="btn-wide-retry" class="btn btn-small btn-secondary">Retry</button>
        </div>
      `;

      targetParent.appendChild(container);

      // Render trouser framing guide overlay inside container
      GarmentFramingOverlay.renderFramingGuide(container);

      // Wire Camera Switch Button
      const btnSwitch = container.querySelector('#btn-switch-camera');
      if (btnSwitch) {
        btnSwitch.addEventListener('click', async (e) => {
          e.stopPropagation();
          btnSwitch.disabled = true;
          try {
            await controller.switchCamera();
            CameraPreview.updateHeader(container, controller);
          } finally {
            btnSwitch.disabled = false;
          }
        });
      }

      // Wire Retry Button
      const btnRetry = container.querySelector('#btn-wide-retry');
      if (btnRetry) {
        btnRetry.addEventListener('click', async (e) => {
          e.stopPropagation();
          CameraPreview.showError(container, false);
          try {
            await controller.acquireWideStream();
          } catch (err) {}
        });
      }
    }

    return container;
  }

  /**
   * Attaches stream to video element and starts playback.
   */
  static attachStream(container, stream, controller) {
    const video = container.querySelector('#wide-preview-video');
    if (!video) return;

    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play().catch(e => console.warn('Preview video play warning:', e));
      CameraPreview.updateHeader(container, controller);
      CameraPreview.showLoader(container, false);
    };
  }

  /**
   * Updates top lens and resolution badges based on active controller state.
   */
  static updateHeader(container, controller) {
    const lensBadge = container.querySelector('#wide-lens-indicator');
    const resBadge = container.querySelector('#wide-res-indicator');
    const switchBtn = container.querySelector('#btn-switch-camera');

    if (lensBadge) {
      const zoom = controller.activeZoom || 1.0;
      const zoomStr = zoom < 1.0 ? `${zoom.toFixed(1)}x (Ultra-Wide)` : `${zoom.toFixed(1)}x (Wide)`;
      const currentDev = controller.deviceSelector.getCurrentDevice();
      const label = currentDev?.label ? (currentDev.label.length > 20 ? `${currentDev.label.substring(0, 18)}...` : currentDev.label) : 'Rear Camera';
      lensBadge.textContent = `📷 ${label} • ${zoomStr}`;
    }

    if (resBadge && controller.activeSettings) {
      const w = controller.activeSettings.width || 0;
      const h = controller.activeSettings.height || 0;
      const aspect = w && h ? (w / h).toFixed(2) : '4:3';
      resBadge.textContent = `${w}×${h} (${aspect})`;
    }

    if (switchBtn) {
      // Only show switch button if multiple rear cameras are available
      const count = controller.deviceSelector.rearDevices.length;
      switchBtn.style.display = count > 1 ? 'inline-flex' : 'none';
    }
  }

  static showLoader(container, show = true, message = 'Acquiring camera...') {
    const loader = container.querySelector('#wide-camera-loader');
    const text = container.querySelector('#wide-loader-text');
    if (loader) {
      if (show) loader.classList.remove('hidden');
      else loader.classList.add('hidden');
    }
    if (text && message) text.textContent = message;
  }

  static showError(container, show = true, message = 'Camera error') {
    const errorEl = container.querySelector('#wide-camera-error');
    const text = container.querySelector('#wide-error-text');
    if (errorEl) {
      if (show) errorEl.classList.remove('hidden');
      else errorEl.classList.add('hidden');
    }
    if (text && message) text.textContent = message;
  }

  static setVisible(container, visible = true) {
    if (!container) return;
    if (visible) {
      container.classList.remove('hidden');
    } else {
      container.classList.add('hidden');
    }
  }
}
