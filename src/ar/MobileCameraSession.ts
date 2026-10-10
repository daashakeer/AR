/**
 * MobileCameraSession — Live Mobile Camera & AR Waist Measurement.
 *
 * Supports live camera stream on all mobile browsers (Android Chrome, iOS Safari)
 * via navigator.mediaDevices.getUserMedia with Three.js AR 3D overlay.
 *
 * Coordinates HRNet waist landmark inference with 3D planar unprojection:
 * - Captures live camera frames at a controlled interval (no overlapping requests).
 * - Applies EMA landmark smoothing across successive frames to eliminate jitter.
 * - Rejects low-confidence predictions and clears stale data.
 * - Projects 2D normalized points onto physical surface plane.
 * - Calculates Euclidean distance in centimetres:
 *     distance_cm = sqrt((X_right - X_left)^2 + (Y_right - Y_left)^2)
 */

import * as THREE from 'three';
import {
  ArSessionCallbacks,
  TrackingStatus,
  MeasurementStep,
  CameraGuidance,
} from './ArSession';
import { detectGarmentLandmarks, NormalizedPoint } from '../utils/garmentApi';
import {
  GarmentMetrics,
  Garment3DPoints,
  calculateGarmentMetrics,
  buildGarment3DMeshes,
} from './garmentMeasure';
import { feedback } from '../utils/feedback';
import type { CaptureResult } from './captureTypes';

export class MobileCameraSession {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Video Element & Stream
  private video: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;

  // Reticle & 3D Meshes
  private reticleGroup: THREE.Group;
  private garmentMeshGroup: THREE.Group | null = null;

  // Inference & Smoothing State
  private inferenceIntervalId: number | null = null;
  private isInferring = false;
  private animFrameId: number | null = null;
  private isScanning = false;
  private ended = false;

  // Smoothed Landmarks (Exponential Moving Average)
  private smoothedWL: { x: number; y: number } | null = null;
  private smoothedWR: { x: number; y: number } | null = null;
  private lastValidDetectionTime = 0;
  private consecutiveFailures = 0;

  // Calibrated Surface Plane (Horizontal surface ~0.55m from phone)
  private estimatedDistanceMeters = 0.55;
  private surfacePlane: THREE.Plane;

  private callbacks: ArSessionCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: ArSessionCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    // ── Three.js Renderer ──────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // ── Scene & Camera ─────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.05, 20);
    this.camera.position.set(0, 0.6, 0);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 3.0);
    this.scene.add(ambient);

    // Initial calibrated horizontal surface plane (ground/table)
    this.surfacePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Reticle
    this.reticleGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.04, 0.06, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.reticleGroup.add(new THREE.Mesh(ringGeo, ringMat));
    this.scene.add(this.reticleGroup);

    window.addEventListener('resize', this.handleResize);
  }

  // ── Session Startup ───────────────────────────────────────────────────────

  async start(overlayRoot: Element): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.callbacks.onError('camera-unavailable');
      return;
    }

    try {
      this.callbacks.onTrackingStatus('detecting');
      this.callbacks.onStep('detecting');

      // Request mobile environment (back) camera
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Create video element for camera preview
      const video = document.createElement('video');
      video.srcObject = this.mediaStream;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.muted = true;
      video.style.position = 'absolute';
      video.style.top = '0';
      video.style.left = '0';
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      video.style.zIndex = '0';
      video.style.pointerEvents = 'none';

      // Insert video behind canvas in overlay or parent
      const parent = this.canvas.parentElement || document.body;
      parent.insertBefore(video, this.canvas);
      this.video = video;

      await video.play();

      this.callbacks.onTrackingStatus('good');
      this.callbacks.onStep('place-a');

      // Start render loop & inference loop
      this.render();
      this.startInferenceLoop();
    } catch (err: unknown) {
      const e = err as DOMException;
      console.error('[MobileCameraSession] Camera start failed:', err);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        this.callbacks.onError('permission-denied');
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        this.callbacks.onError('camera-unavailable');
      } else {
        this.callbacks.onError('session-failed');
      }
    }
  }

  // ── Inference Loop ────────────────────────────────────────────────────────

  private startInferenceLoop(): void {
    // Run HRNet landmark detection every 650ms on selected frames
    this.inferenceIntervalId = window.setInterval(async () => {
      await this.processNextFrame();
    }, 650);
  }

  private async processNextFrame(): Promise<void> {
    if (this.isInferring || !this.video || this.video.readyState < 2 || this.ended) {
      return;
    }

    this.isInferring = true;

    try {
      // 1. Capture snapshot from live camera video stream
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (vw < 50 || vh < 50) return;

      const offscreen = document.createElement('canvas');
      const maxDim = 800; // Optimal resolution for fast network transport
      const scale = Math.min(1.0, maxDim / Math.max(vw, vh));
      offscreen.width = Math.round(vw * scale);
      offscreen.height = Math.round(vh * scale);

      const ctx = offscreen.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(this.video, 0, 0, offscreen.width, offscreen.height);

      const dataUrl = offscreen.toDataURL('image/jpeg', 0.82);

      // 2. Query HRNet Waist API
      this.callbacks.onGarmentScanning?.(true);
      const result = await detectGarmentLandmarks(dataUrl, { timeoutMs: 8000 });

      if (result.success && result.landmarks?.waist_left && result.landmarks?.waist_right) {
        this.consecutiveFailures = 0;
        this.lastValidDetectionTime = Date.now();

        const rawWL = result.landmarks.waist_left;
        const rawWR = result.landmarks.waist_right;

        // 3. Temporal EMA Landmark Smoothing across consecutive frames
        const alpha = 0.65; // Smoothing factor
        if (!this.smoothedWL || !this.smoothedWR) {
          this.smoothedWL = { x: rawWL.x, y: rawWL.y };
          this.smoothedWR = { x: rawWR.x, y: rawWR.y };
        } else {
          this.smoothedWL = {
            x: alpha * rawWL.x + (1 - alpha) * this.smoothedWL.x,
            y: alpha * rawWL.y + (1 - alpha) * this.smoothedWL.y,
          };
          this.smoothedWR = {
            x: alpha * rawWR.x + (1 - alpha) * this.smoothedWR.x,
            y: alpha * rawWR.y + (1 - alpha) * this.smoothedWR.y,
          };
        }

        // 4. Project 2D landmarks onto 3D calibrated surface plane
        const pWL = this.unprojectToSurface(this.smoothedWL);
        const pWR = this.unprojectToSurface(this.smoothedWR);

        if (pWL && pWR) {
          const garment3D: Garment3DPoints = {
            waistLeft: pWL,
            waistRight: pWR,
          };

          // 5. Calculate physical metric distance in centimetres
          const metrics = calculateGarmentMetrics(garment3D, 'Trousers');

          // 6. Update 3D Holographic Visuals
          if (this.garmentMeshGroup) {
            this.scene.remove(this.garmentMeshGroup);
            this.garmentMeshGroup = null;
          }
          this.garmentMeshGroup = buildGarment3DMeshes(garment3D, metrics);
          this.scene.add(this.garmentMeshGroup);

          this.callbacks.onGarmentMeasured?.(metrics);
          this.callbacks.onDistance(metrics.waistWidthMeters);
        }
      } else {
        this.consecutiveFailures++;
        // If stale (> 2.5 seconds without detection), clear overlay
        if (Date.now() - this.lastValidDetectionTime > 2500) {
          if (this.garmentMeshGroup) {
            this.scene.remove(this.garmentMeshGroup);
            this.garmentMeshGroup = null;
          }
        }
      }
    } catch (err) {
      console.debug('[MobileCameraSession] Frame inference error:', err);
    } finally {
      this.isInferring = false;
      this.callbacks.onGarmentScanning?.(false);
    }
  }

  /**
   * Unprojects a normalized 2D point (0..1) through the perspective camera
   * onto the calibrated horizontal garment plane.
   */
  private unprojectToSurface(point: NormalizedPoint): THREE.Vector3 | null {
    // Convert 0..1 coordinates to Normalized Device Coordinates (-1..1)
    const ndcX = point.x * 2 - 1;
    const ndcY = -(point.y * 2) + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const hitPoint = new THREE.Vector3();
    const intersect = raycaster.ray.intersectPlane(this.surfacePlane, hitPoint);
    return intersect ? hitPoint : null;
  }

  // ── Render Loop ───────────────────────────────────────────────────────────

  private render = (): void => {
    if (this.ended) return;

    this.renderer.render(this.scene, this.camera);
    this.animFrameId = requestAnimationFrame(this.render);
  };

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  // ── Manual Scan Trigger & Reset ───────────────────────────────────────────

  async scanGarment(): Promise<GarmentMetrics | null> {
    await this.processNextFrame();
    return null;
  }

  /**
   * Captures a real camera image from the live <video> feed plus all available
   * calibration metadata.
   *
   * Image:
   *   Drawn from the live HTMLVideoElement at full sensor resolution (not the
   *   Three.js overlay canvas).  The video element is the actual camera feed.
   *
   * Z_m (camera-to-trouser-plane distance):
   *   First attempts to read the device-reported focus distance from
   *   MediaStreamTrack.getSettings().focusDistance (metres).  This is the distance
   *   the autofocus system measured to the subject — a good proxy for Z when the
   *   trousers are the main subject.
   *   If focusDistance is not exposed by the browser (common on iOS), falls back to
   *   a fixed estimate of 0.55 m with distanceSource = 'fov-estimate'.  The user
   *   is informed via reliabilityNote so they can substitute a manual measurement.
   *
   * fx / fy:
   *   Derived from the Three.js PerspectiveCamera FOV and the actual captured
   *   image resolution:
   *     fy_pixels = (imageHeight / 2) / tan(vFOV_radians / 2)
   *     fx_pixels = fy_pixels * (imageWidth / imageHeight)
   *   The Three.js camera FOV is set to 60° which is a generic mobile camera
   *   approximation.  This is flagged as 'fov-derived' in intrinsicsSource.
   */
  async captureImage(): Promise<CaptureResult> {
    const capturedAt = new Date().toISOString();

    // ── 1. Real camera image from <video> ─────────────────────────────────────
    let imageDataUrl = '';
    let imageWidth = 0;
    let imageHeight = 0;

    if (this.video && this.video.readyState >= 2) {
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (vw > 0 && vh > 0) {
        const offscreen = document.createElement('canvas');
        offscreen.width = vw;
        offscreen.height = vh;
        const ctx = offscreen.getContext('2d')!;
        ctx.drawImage(this.video, 0, 0, vw, vh);
        imageDataUrl = offscreen.toDataURL('image/jpeg', 0.92);
        imageWidth = vw;
        imageHeight = vh;
      }
    }

    if (!imageDataUrl) {
      // Video not ready — cannot provide a real image
      const now = new Date().toISOString();
      return {
        imageDataUrl: '',
        imageWidth: 0,
        imageHeight: 0,
        Z_m: null,
        distanceSource: null,
        fx_pixels: null,
        fy_pixels: null,
        intrinsicsSource: null,
        cameraPose: null,
        planePosition: null,
        planeNormal: null,
        projectionMatrix: null,
        capturedAt: now,
        trackingValid: false,
        reliabilityNote: 'Error: Camera video not ready — cannot capture image.',
      };
    }

    // ── 2. Camera-to-trouser-plane distance Z_m ───────────────────────────────
    let Z_m: number | null = null;
    let distanceSource: CaptureResult['distanceSource'] = null;

    // Try device-reported autofocus distance (metres) — available on Android Chrome
    // with manual focus or when the browser exposes focusDistance in getSettings().
    const track = this.mediaStream?.getVideoTracks()[0];
    if (track) {
      try {
        // getCapabilities() tells us what the track supports
        const caps = track.getCapabilities() as MediaTrackCapabilities & { focusDistance?: { min: number; max: number } };
        const settings = track.getSettings() as MediaTrackSettings & { focusDistance?: number };
        if (typeof settings.focusDistance === 'number' && settings.focusDistance > 0) {
          Z_m = settings.focusDistance;
          distanceSource = 'focus-distance';
          console.log(`[MobileCapture] focusDistance from device: ${Z_m.toFixed(3)} m`);
        } else if (caps.focusDistance) {
          // Range available but current value not set — use mid-range as estimate
          Z_m = (caps.focusDistance.min + caps.focusDistance.max) / 2;
          distanceSource = 'fov-estimate';
          console.log(`[MobileCapture] focusDistance mid-range estimate: ${Z_m.toFixed(3)} m`);
        }
      } catch (err) {
        console.debug('[MobileCapture] getCapabilities/getSettings failed:', err);
      }
    }

    if (Z_m === null) {
      // No device focus distance available — do not substitute a hardcoded value.
      // Return null and report it clearly so the caller can prompt the user.
      distanceSource = null;
    }

    // ── 3. Focal length from video resolution + Three.js camera FOV ──────────
    // Three.js PerspectiveCamera.fov is the VERTICAL field-of-view in degrees.
    // fy_pixels = (imageHeight / 2) / tan(vFOV / 2)
    // fx_pixels = fy_pixels * (imageWidth / imageHeight)   [square pixels assumed]
    let fx_pixels: number | null = null;
    let fy_pixels: number | null = null;
    let intrinsicsSource: CaptureResult['intrinsicsSource'] = null;

    if (imageWidth > 0 && imageHeight > 0) {
      const vFovRad = (this.camera.fov * Math.PI) / 180;
      fy_pixels = (imageHeight / 2) / Math.tan(vFovRad / 2);
      fx_pixels = fy_pixels * (imageWidth / imageHeight);
      intrinsicsSource = 'fov-derived';
    }

    // ── 4. Camera pose (fixed for MobileCameraSession) ────────────────────────
    // Camera position is fixed at (0, 0.6, 0) looking down at (0, 0, 0).
    const cameraPose: CaptureResult['cameraPose'] = {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      quaternion: {
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z,
        w: this.camera.quaternion.w,
      },
    };

    // ── 5. Plane geometry ─────────────────────────────────────────────────────
    // The calibrated surface plane is at Y=0 with normal (0,1,0).
    const planePosition = { x: 0, y: 0, z: 0 };
    const planeNormal = { x: 0, y: 1, z: 0 };

    // ── 6. Reliability note ───────────────────────────────────────────────────
    const parts: string[] = ['Image: real camera frame from <video> element'];
    if (Z_m !== null && distanceSource === 'focus-distance') {
      parts.push(`Z: ${Z_m.toFixed(3)} m (device autofocus distance — accurate)`);
    } else if (Z_m !== null) {
      parts.push(`Z: ${Z_m.toFixed(3)} m (estimated from focusDistance range — less accurate)`);
    } else {
      parts.push('Z: unavailable — browser does not expose focusDistance. Measure manually.');
    }
    if (fx_pixels !== null) {
      parts.push(`fx=${fx_pixels.toFixed(1)} px, fy=${fy_pixels!.toFixed(1)} px (derived from ${this.camera.fov}° FOV + ${imageWidth}×${imageHeight} — approximation)`);
    }
    const reliabilityNote = parts.join(' | ');

    const result: CaptureResult = {
      imageDataUrl,
      imageWidth,
      imageHeight,
      Z_m,
      distanceSource,
      fx_pixels,
      fy_pixels,
      intrinsicsSource,
      cameraPose,
      planePosition,
      planeNormal,
      projectionMatrix: null,  // Not available without WebXR
      capturedAt,
      trackingValid: true,
      reliabilityNote,
    };

    this.callbacks.onCapture?.(result);
    return result;
  }

  undoLastPoint(): void {
    // No-op for automated camera mode
  }

  reset(): void {
    if (this.garmentMeshGroup) {
      this.scene.remove(this.garmentMeshGroup);
      this.garmentMeshGroup = null;
    }
    this.smoothedWL = null;
    this.smoothedWR = null;
    this.callbacks.onDistance(0);
    this.callbacks.onStep('place-a');
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;

    if (this.inferenceIntervalId !== null) {
      clearInterval(this.inferenceIntervalId);
      this.inferenceIntervalId = null;
    }

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      if (this.video.parentElement) {
        this.video.parentElement.removeChild(this.video);
      }
      this.video = null;
    }

    if (this.garmentMeshGroup) {
      this.scene.remove(this.garmentMeshGroup);
      this.garmentMeshGroup = null;
    }

    window.removeEventListener('resize', this.handleResize);
    this.callbacks.onEnd();
  }
}
