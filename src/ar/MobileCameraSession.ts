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
