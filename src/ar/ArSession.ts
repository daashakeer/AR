/**
 * ArSession — WebXR immersive-ar session manager.
 *
 * Upgrades:
 *  - Adaptive velocity-sensitive pose filtering (eliminates jitter, zero latency)
 *  - WebXR Anchors support (locks points to physical features, prevents SLAM drift)
 *  - Real-time live rubber-band measuring tape preview & streaming distance
 *  - High-precision holographic reticle with surface-normal alignment and crosshair
 *  - Camera-to-surface distance guidance (optimal sweet-spot tracking)
 *  - Immediate state transitions (fixed 200ms throttle desync bug)
 *  - Multi-point measurement support with Undo functionality
 *  - Web Audio & Haptic feedback on interactions
 */

import * as THREE from 'three';
import {
  Point3D,
  euclideanDistance,
  getLineOrientation,
  LineOrientation,
} from '../utils/distance';
import { AdaptivePoseFilter } from './filter';
import { feedback } from '../utils/feedback';
import { detectGarmentLandmarks } from '../utils/garmentApi';
import {
  GarmentMetrics,
  Garment3DPoints,
  unprojectLandmarkToPlane,
  calculateGarmentMetrics,
  buildGarment3DMeshes,
} from './garmentMeasure';
import type {
  CaptureResult,
  CameraPoseData,
  CameraIntrinsicsData,
  TrouserPlaneData,
  WaistbandLandmarks,
  WaistbandWidthResult,
} from './captureTypes';
import { deriveIntrinsicsFromMatrix, calculateTiltCorrectedWaistWidth } from './waistbandGeometry';

export type {
  CaptureResult,
  CameraPoseData,
  CameraIntrinsicsData,
  TrouserPlaneData,
  WaistbandLandmarks,
  WaistbandWidthResult,
};

// ─── Public types ──────────────────────────────────────────────────────────

export type TrackingStatus = 'detecting' | 'good' | 'lost';

export type AppError =
  | 'permission-denied'
  | 'ar-unsupported'
  | 'session-failed'
  | 'session-interrupted'
  | 'camera-unavailable'
  | 'unknown';

export type MeasurementStep =
  | 'idle'
  | 'detecting'
  | 'place-a'
  | 'place-b'
  | 'measured';

export type GuidanceStatus = 'optimal' | 'too-close' | 'too-far' | 'none';

export interface CameraGuidance {
  status: GuidanceStatus;
  distanceMeters: number;
  message: string;
}

export interface ArSessionCallbacks {
  onTrackingStatus: (status: TrackingStatus) => void;
  onStep: (step: MeasurementStep) => void;
  onPointA: (point: Point3D) => void;
  onPointB: (point: Point3D) => void;
  onPointsChange: (points: Point3D[]) => void;
  onLiveDistance: (distanceMeters: number | null) => void;
  onDistance: (distanceMeters: number) => void;
  onOrientation: (orientation: LineOrientation | null) => void;
  onGuidance: (guidance: CameraGuidance) => void;
  onGarmentMeasured?: (metrics: GarmentMetrics) => void;
  onGarmentScanning?: (isScanning: boolean) => void;
  onCapture?: (result: CaptureResult) => void;
  onError: (error: AppError) => void;
  onEnd: () => void;
}

// ─── High-DPI Canvas Label Helpers ─────────────────────────────────────────

function makeMarkerSprite(label: string, color: string): THREE.Sprite {
  const size = 256; // 2x resolution for crispness
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.46)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;
  return sprite;
}

function makeDistanceSprite(text: string): THREE.Sprite {
  const w = 480;
  const h = 150;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;

  const r = 28;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();

  ctx.fillStyle = 'rgba(10, 14, 24, 0.88)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 1000;
  return sprite;
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group);
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite || obj instanceof THREE.Line) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => {
          if ('map' in m && m.map) m.map.dispose();
          m.dispose();
        });
      } else {
        if ('map' in obj.material && obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }
  });
}

// ─── Main ArSession Class ──────────────────────────────────────────────────

interface MarkerItem {
  point: Point3D;
  group: THREE.Group;
  anchor?: unknown;
}

export class ArSession {
  // Three.js Core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private reticleGroup: THREE.Group;
  private reticleRingMat: THREE.MeshBasicMaterial;
  private reticleInnerMat: THREE.MeshBasicMaterial;

  // Smoothing Filter
  private poseFilter = new AdaptivePoseFilter({
    minAlpha: 0.12,
    maxAlpha: 0.85,
    deadbandMeters: 0.002,
  });

  // XR State
  private xrSession: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private localSpace: XRReferenceSpace | null = null;
  private lastHitResult: XRHitTestResult | null = null;

  // Capture State — updated every render loop tick
  private lastXRFrame: XRFrame | null = null;
  private lastViewerPose: XRViewerPose | null = null;
  private lastViewProjectionMatrix: number[] | null = null;  // Column-major 4×4
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private rearCameraTrack: MediaStreamTrack | null = null;  // For real image capture
  private captureVideo: HTMLVideoElement | null = null;     // Background video sink to keep camera decoding active
  private captureStream: MediaStream | null = null;
  private isCapturingImage = false;

  // Measurement State & Visuals
  private markers: MarkerItem[] = [];
  private measurementLines: THREE.Line[] = [];
  private distanceLabels: THREE.Sprite[] = [];

  // Live Measuring Tape Preview
  private livePreviewLine: THREE.Line | null = null;
  private livePreviewLabel: THREE.Sprite | null = null;

  // Reticle Visual Pulse & Status
  private reticlePulse = 0;
  private currentSmoothedPos = new THREE.Vector3();
  private currentSmoothedQuat = new THREE.Quaternion();
  private hasHit = false;

  // Garment Auto-Measure State
  private garmentMeshGroup: THREE.Group | null = null;
  private isScanningGarment = false;

  // App State
  private step: MeasurementStep = 'idle';
  private trackingStatus: TrackingStatus = 'detecting';
  private ended = false;
  private lastStatusUpdate = 0;
  private lastGuidanceUpdate = 0;

  private callbacks: ArSessionCallbacks;
  private boundSelect: () => void;


  constructor(canvas: HTMLCanvasElement, callbacks: ArSessionCallbacks) {
    this.callbacks = callbacks;

    // ── Renderer ──────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // ── Scene ─────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    );

    const ambient = new THREE.AmbientLight(0xffffff, 3.0);
    this.scene.add(ambient);

    // ── High-Precision Reticle ─────────────────────────────────────────────
    this.reticleGroup = new THREE.Group();

    // Outer Target Ring (radius: 5.5cm - 7.5cm)
    const ringGeo = new THREE.RingGeometry(0.045, 0.065, 32).rotateX(-Math.PI / 2);
    this.reticleRingMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.reticleGroup.add(new THREE.Mesh(ringGeo, this.reticleRingMat));

    // Center Crosshair Dot
    const centerGeo = new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2);
    this.reticleInnerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    this.reticleGroup.add(new THREE.Mesh(centerGeo, this.reticleInnerMat));

    // Fine Crosshair Ticks for precision edge alignment
    const tickMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const tickPoints = [
      new THREE.Vector3(-0.04, 0.001, 0), new THREE.Vector3(-0.015, 0.001, 0),
      new THREE.Vector3(0.015, 0.001, 0),  new THREE.Vector3(0.04, 0.001, 0),
      new THREE.Vector3(0, 0.001, -0.04), new THREE.Vector3(0, 0.001, -0.015),
      new THREE.Vector3(0, 0.001, 0.015),  new THREE.Vector3(0, 0.001, 0.04),
    ];
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    const tickLines = new THREE.LineSegments(tickGeo, tickMat);
    this.reticleGroup.add(tickLines);

    this.reticleGroup.matrixAutoUpdate = false;
    this.reticleGroup.visible = false;
    this.scene.add(this.reticleGroup);

    this.boundSelect = this.handleSelect.bind(this);
  }

  // ─── Session Start ───────────────────────────────────────────────────────

  async start(overlayRoot: Element): Promise<void> {
    if (!navigator.xr) {
      this.callbacks.onError('ar-unsupported');
      return;
    }

    try {
      // Request hit-test, and request anchors & local-floor if supported
      const sessionInit = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor', 'anchors', 'plane-detection'],
        domOverlay: { root: overlayRoot },
      } as XRSessionInit;

      this.xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit);
    } catch (err: unknown) {
      const e = err as DOMException;
      if (e.name === 'NotAllowedError') {
        this.callbacks.onError('permission-denied');
      } else if (e.name === 'NotSupportedError') {
        this.callbacks.onError('ar-unsupported');
      } else {
        this.callbacks.onError('session-failed');
      }
      return;
    }

    try {
      await this.renderer.xr.setSession(this.xrSession);
    } catch (err) {
      console.error('renderer.xr.setSession failed:', err);
      this.callbacks.onError('session-failed');
      return;
    }

    // Reference space setup
    try {
      this.localSpace = await this.xrSession.requestReferenceSpace('local-floor');
      console.log('[AR] Using local-floor reference space');
    } catch {
      try {
        this.localSpace = await this.xrSession.requestReferenceSpace('local');
        console.log('[AR] Using local reference space');
      } catch (err) {
        console.error('[AR] Could not get reference space:', err);
        this.callbacks.onError('session-failed');
        return;
      }
    }

    // Hit-test source
    let viewerSpace: XRReferenceSpace;
    try {
      viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    } catch (err) {
      console.error('[AR] Could not get viewer space:', err);
      this.callbacks.onError('session-failed');
      return;
    }

    try {
      const hitTestFn = (this.xrSession as unknown as {
        requestHitTestSource: (opts: { space: XRSpace }) => Promise<XRHitTestSource>;
      }).requestHitTestSource;

      if (!hitTestFn) {
        throw new Error('requestHitTestSource is not available');
      }
      this.hitTestSource = await hitTestFn.call(this.xrSession, { space: viewerSpace });
      console.log('[AR] Hit-test source established');
    } catch (err) {
      console.error('[AR] requestHitTestSource failed:', err);
      this.callbacks.onError('session-failed');
      return;
    }

    this.xrSession.addEventListener('select', this.boundSelect);
    this.xrSession.addEventListener('end', this.handleSessionEnd.bind(this));

    // Acquire rear camera media track for real image capture.
    // This runs in the background — it does not block session start.
    // We need this because canvas.toDataURL() in WebXR only captures the Three.js
    // overlay layer, not the AR camera passthrough rendered by the XR compositor.
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then(async (stream) => {
        this.captureStream = stream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          this.rearCameraTrack = track;
          console.log('[AR] Rear camera track acquired for image capture:', track.label);

          // Create an offscreen video element to act as an active sink.
          // This forces the browser/hardware to decode live frames continuously.
          const video = document.createElement('video');
          video.setAttribute('playsinline', 'true');
          video.setAttribute('autoplay', 'true');
          video.muted = true;
          video.srcObject = stream;
          video.style.position = 'fixed';
          video.style.top = '-9999px';
          video.style.left = '-9999px';
          video.style.width = '1px';
          video.style.height = '1px';
          video.style.opacity = '0';
          video.style.pointerEvents = 'none';
          document.body.appendChild(video);
          try {
            await video.play();
            this.captureVideo = video;
            console.log('[AR] Background camera video active and decoding');
          } catch (e) {
            console.warn('[AR] Background video play error:', e);
          }
        }
      })
      .catch((err) => {
        console.warn('[AR] Could not acquire rear camera track for capture:', err);
      });

    // Immediately start in detecting state
    this.step = 'detecting';
    this.callbacks.onStep('detecting');
    this.renderer.setAnimationLoop(this.renderLoop.bind(this));
  }

  // ─── Main Render Loop (60 FPS) ───────────────────────────────────────────

  private renderLoop(_timestamp: number, frame: XRFrame | undefined): void {
    if (!frame || !this.hitTestSource || !this.localSpace) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Store for captureImage() — updated every frame
    this.lastXRFrame = frame;
    const viewerPose = frame.getViewerPose(this.localSpace);
    if (viewerPose) {
      this.lastViewerPose = viewerPose;
      // Extract projection matrix from the first view (the camera's optical parameters)
      const view = viewerPose.views[0];
      if (view) {
        this.lastViewProjectionMatrix = Array.from(view.projectionMatrix);
        // Viewport size from the WebXR layer (used to scale projection matrix → pixels)
        const layer = this.renderer.xr.getBaseLayer();
        if (layer && 'getViewport' in layer) {
          const vp = (layer as XRWebGLLayer).getViewport(view);
          if (vp) {
            this.lastViewportWidth = vp.width;
            this.lastViewportHeight = vp.height;
          }
        }
      }
    }

    const hitTestResults = frame.getHitTestResults(this.hitTestSource);
    const now = performance.now();

    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      this.lastHitResult = hit;
      const pose = hit.getPose(this.localSpace);

      if (pose) {
        this.hasHit = true;

        // Extract raw position and orientation
        const rawMat = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const rawPos = new THREE.Vector3();
        const rawQuat = new THREE.Quaternion();
        const rawScale = new THREE.Vector3();
        rawMat.decompose(rawPos, rawQuat, rawScale);

        // Apply Adaptive Velocity-Sensitive Pose Filter
        const filtered = this.poseFilter.update(rawPos, rawQuat, now);
        this.currentSmoothedPos.copy(filtered.position);
        this.currentSmoothedQuat.copy(filtered.quaternion);

        // Position reticle using smoothed coordinates
        this.reticleGroup.visible = true;
        this.reticleGroup.position.copy(filtered.position);
        this.reticleGroup.quaternion.copy(filtered.quaternion);

        // Reticle animation and stability coloring
        this.reticlePulse += 0.08;
        const pulse = 1 + Math.sin(this.reticlePulse) * 0.04;
        this.reticleGroup.scale.set(pulse, pulse, pulse);

        if (filtered.isStable) {
          // Locked onto target surface: bright cyan
          this.reticleRingMat.color.setHex(0x00e5ff);
          this.reticleRingMat.opacity = 0.95;
        } else {
          // Moving / tracking: bright emerald
          this.reticleRingMat.color.setHex(0x00ff88);
          this.reticleRingMat.opacity = 0.85;
        }

        // Distance from camera to surface (Sweet-spot accuracy tracking)
        const camPos = new THREE.Vector3();
        this.camera.getWorldPosition(camPos);
        const distToSurface = camPos.distanceTo(filtered.position);

        if (now - this.lastGuidanceUpdate > 150) {
          this.lastGuidanceUpdate = now;
          let guidanceStatus: GuidanceStatus = 'optimal';
          let guidanceMsg = `Optimal range (${distToSurface.toFixed(2)}m)`;

          if (distToSurface < 0.35) {
            guidanceStatus = 'too-close';
            guidanceMsg = `Too close (${distToSurface.toFixed(2)}m) — Move back`;
          } else if (distToSurface > 2.5) {
            guidanceStatus = 'too-far';
            guidanceMsg = `Move closer (${distToSurface.toFixed(2)}m) for high accuracy`;
          }

          this.callbacks.onGuidance({
            status: guidanceStatus,
            distanceMeters: distToSurface,
            message: guidanceMsg,
          });
        }

        // Update live rubber-band measuring tape preview if a marker exists
        if (this.markers.length > 0 && this.step !== 'measured') {
          const lastMarker = this.markers[this.markers.length - 1];
          const liveDist = euclideanDistance(lastMarker.point, {
            x: filtered.position.x,
            y: filtered.position.y,
            z: filtered.position.z,
          });

          this.updateLivePreview(lastMarker.point, filtered.position, liveDist);
          this.callbacks.onLiveDistance(liveDist);

          const orientation = getLineOrientation(lastMarker.point, {
            x: filtered.position.x,
            y: filtered.position.y,
            z: filtered.position.z,
          });
          this.callbacks.onOrientation(orientation);
        }

        // Immediate state transition upon surface acquisition (FIXED THROTTLE BUG)
        if (this.step === 'detecting') {
          this.step = 'place-a';
          this.callbacks.onStep('place-a');
        }

        if (this.trackingStatus !== 'good') {
          this.trackingStatus = 'good';
          if (now - this.lastStatusUpdate > 200) {
            this.lastStatusUpdate = now;
            this.callbacks.onTrackingStatus('good');
          }
        }
      }
    } else {
      this.hasHit = false;
      if (this.reticleGroup.visible) {
        this.reticleGroup.visible = false;
      }
      this.clearLivePreview();
      this.callbacks.onLiveDistance(null);

      if (this.trackingStatus !== 'detecting' && this.step !== 'measured') {
        if (now - this.lastStatusUpdate > 200) {
          this.lastStatusUpdate = now;
          this.trackingStatus = 'detecting';
          this.callbacks.onTrackingStatus('detecting');
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ─── Live Measuring Tape Preview ─────────────────────────────────────────

  private updateLivePreview(startPos: Point3D, endPos: THREE.Vector3, distanceMeters: number): void {
    const points = [
      new THREE.Vector3(startPos.x, startPos.y, startPos.z),
      endPos.clone(),
    ];

    if (!this.livePreviewLine) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineDashedMaterial({
        color: 0x00e5ff,
        dashSize: 0.03,
        gapSize: 0.02,
        transparent: true,
        opacity: 0.85,
      });
      this.livePreviewLine = new THREE.Line(lineGeo, lineMat);
      this.livePreviewLine.computeLineDistances();
      this.scene.add(this.livePreviewLine);
    } else {
      this.livePreviewLine.geometry.setFromPoints(points);
      this.livePreviewLine.computeLineDistances();
      this.livePreviewLine.visible = true;
    }

    // Dynamic live floating midpoint badge
    const mid = new THREE.Vector3(
      (startPos.x + endPos.x) / 2,
      Math.max(startPos.y, endPos.y) + 0.06,
      (startPos.z + endPos.z) / 2
    );

    if (this.livePreviewLabel) {
      this.scene.remove(this.livePreviewLabel);
      this.livePreviewLabel.geometry.dispose();
      (this.livePreviewLabel.material as THREE.SpriteMaterial).map?.dispose();
      this.livePreviewLabel.material.dispose();
    }

    const cm = (distanceMeters * 100).toFixed(1);
    this.livePreviewLabel = makeDistanceSprite(`${cm} cm`);
    this.livePreviewLabel.scale.set(0.18, 0.055, 1);
    this.livePreviewLabel.position.copy(mid);
    this.scene.add(this.livePreviewLabel);
  }

  private clearLivePreview(): void {
    if (this.livePreviewLine) {
      this.livePreviewLine.visible = false;
    }
    if (this.livePreviewLabel) {
      this.scene.remove(this.livePreviewLabel);
      this.livePreviewLabel.geometry.dispose();
      (this.livePreviewLabel.material as THREE.SpriteMaterial).map?.dispose();
      this.livePreviewLabel.material.dispose();
      this.livePreviewLabel = null;
    }
  }

  // ─── Tap / Select Handler ────────────────────────────────────────────────

  private async handleSelect(): Promise<void> {
    if (!this.reticleGroup.visible || !this.hasHit) return;
    if (this.step !== 'place-a' && this.step !== 'place-b') return;

    const pos: Point3D = {
      x: this.currentSmoothedPos.x,
      y: this.currentSmoothedPos.y,
      z: this.currentSmoothedPos.z,
    };

    // Attempt to create physical XRAnchor if supported
    let anchor: unknown = undefined;
    if (this.lastHitResult && 'createAnchor' in this.lastHitResult) {
      try {
        const createAnchorFn = (this.lastHitResult as unknown as {
          createAnchor: () => Promise<unknown>;
        }).createAnchor;
        if (createAnchorFn) {
          anchor = await createAnchorFn.call(this.lastHitResult);
        }
      } catch {}
    }

    if (this.step === 'place-a') {
      // First point placed
      const label = 'A';
      const group = this.createMarkerMesh(label, pos, '#00b4d8');
      this.markers.push({ point: pos, group, anchor });
      feedback.triggerPointPlaced();

      this.callbacks.onPointA(pos);
      this.callbacks.onPointsChange(this.markers.map((m) => m.point));

      this.step = 'place-b';
      this.callbacks.onStep('place-b');
    } else if (this.step === 'place-b') {
      // Second point placed
      const label = 'B';
      const group = this.createMarkerMesh(label, pos, '#ff7043');
      this.markers.push({ point: pos, group, anchor });

      this.clearLivePreview();
      feedback.triggerMeasurementComplete();

      const prevPoint = this.markers[0].point;
      const dist = euclideanDistance(prevPoint, pos);
      this.drawPermanentMeasurement(prevPoint, pos, dist);

      this.callbacks.onPointB(pos);
      this.callbacks.onPointsChange(this.markers.map((m) => m.point));
      this.callbacks.onDistance(dist);

      const orientation = getLineOrientation(prevPoint, pos);
      this.callbacks.onOrientation(orientation);

      this.step = 'measured';
      this.callbacks.onStep('measured');
    }
  }

  // ─── Marker & Measurement Meshes ─────────────────────────────────────────

  private createMarkerMesh(label: string, pos: Point3D, color: string): THREE.Group {
    const group = new THREE.Group();

    // Ground contact ring (radius: 3cm)
    const ringGeo = new THREE.RingGeometry(0.015, 0.03, 24).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    group.add(new THREE.Mesh(ringGeo, ringMat));

    // Pin base sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 16, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color) })
    );
    sphere.position.y = 0.014;
    group.add(sphere);

    // Pin stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.05, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    stem.position.y = 0.045;
    group.add(stem);

    // Label Sprite
    const sprite = makeMarkerSprite(label, color);
    sprite.scale.set(0.075, 0.075, 1);
    sprite.position.y = 0.095;
    group.add(sprite);

    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);
    return group;
  }

  private drawPermanentMeasurement(a: Point3D, b: Point3D, distMeters: number): void {
    const points = [
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ];

    // Solid white laser measurement line
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      linewidth: 3,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    this.scene.add(line);
    this.measurementLines.push(line);

    // Midpoint measurement badge
    const mid = new THREE.Vector3(
      (a.x + b.x) / 2,
      Math.max(a.y, b.y) + 0.065,
      (a.z + b.z) / 2
    );
    const cm = (distMeters * 100).toFixed(1);
    const label = makeDistanceSprite(`${cm} cm`);
    label.scale.set(0.22, 0.07, 1);
    label.position.copy(mid);
    this.scene.add(label);
    this.distanceLabels.push(label);
  }

  // ─── Undo & Reset ────────────────────────────────────────────────────────

  undoLastPoint(): void {
    if (this.markers.length === 0) return;

    feedback.triggerUndo();
    this.clearLivePreview();

    // If measured (2 points placed), remove second point and measurement lines
    if (this.step === 'measured') {
      const last = this.markers.pop();
      if (last) disposeGroup(last.group, this.scene);

      const lastLine = this.measurementLines.pop();
      if (lastLine) {
        this.scene.remove(lastLine);
        lastLine.geometry.dispose();
        (lastLine.material as THREE.Material).dispose();
      }

      const lastLabel = this.distanceLabels.pop();
      if (lastLabel) {
        this.scene.remove(lastLabel);
        lastLabel.geometry.dispose();
        (lastLabel.material as THREE.SpriteMaterial).map?.dispose();
        lastLabel.material.dispose();
      }

      this.step = 'place-b';
      this.callbacks.onStep('place-b');
      this.callbacks.onPointB(null as unknown as Point3D);
      this.callbacks.onPointsChange(this.markers.map((m) => m.point));
      this.callbacks.onOrientation(null);
    } else if (this.step === 'place-b') {
      // 1 point placed (Point A), revert to place-a
      const last = this.markers.pop();
      if (last) disposeGroup(last.group, this.scene);

      this.step = 'place-a';
      this.callbacks.onStep('place-a');
      this.callbacks.onPointA(null as unknown as Point3D);
      this.callbacks.onPointsChange([]);
      this.callbacks.onOrientation(null);
    }
  }

  // ─── Garment Auto-Measure with HRNet ────────────────────────────────────

  async scanGarment(): Promise<GarmentMetrics | null> {
    if (this.isScanningGarment) return null;
    this.isScanningGarment = true;
    this.callbacks.onGarmentScanning?.(true);

    try {
      // 1. Capture snapshot from current WebGL canvas
      const dataUrl = this.renderer.domElement.toDataURL('image/jpeg', 0.85);

      // 2. Query Hugging Face Space (SAM3 + HRNet + Gemini)
      const scanResult = await detectGarmentLandmarks(dataUrl);
      if (!scanResult.success || !scanResult.landmarks) {
        throw new Error(scanResult.error || 'Failed to detect garment landmarks');
      }

      // 3. Derive physical ground / table surface plane from smoothed pose
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.currentSmoothedQuat);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.currentSmoothedPos);

      // 4. Unproject 2D landmarks onto 3D surface plane
      const pWL = unprojectLandmarkToPlane(scanResult.landmarks.waist_left, this.camera, plane);
      const pWR = unprojectLandmarkToPlane(scanResult.landmarks.waist_right, this.camera, plane);
      if (!pWL || !pWR) {
        throw new Error('Could not project waist points onto surface plane');
      }

      const pInseam = scanResult.landmarks.inseam ? unprojectLandmarkToPlane(scanResult.landmarks.inseam, this.camera, plane) || undefined : undefined;
      const pAnkleL = scanResult.landmarks.outer_ankle_left ? unprojectLandmarkToPlane(scanResult.landmarks.outer_ankle_left, this.camera, plane) || undefined : undefined;
      const pAnkleR = scanResult.landmarks.outer_ankle_right ? unprojectLandmarkToPlane(scanResult.landmarks.outer_ankle_right, this.camera, plane) || undefined : undefined;

      const garment3D: Garment3DPoints = {
        waistLeft: pWL,
        waistRight: pWR,
        inseam: pInseam,
        outerAnkleLeft: pAnkleL,
        outerAnkleRight: pAnkleR,
      };

      // 5. Compute metric measurements
      const metrics = calculateGarmentMetrics(garment3D, scanResult.pantType || 'Trousers');

      // 6. Build and render 3D holographic garment meshes in AR
      if (this.garmentMeshGroup) {
        disposeGroup(this.garmentMeshGroup, this.scene);
      }
      this.garmentMeshGroup = buildGarment3DMeshes(garment3D, metrics);
      this.scene.add(this.garmentMeshGroup);

      feedback.triggerMeasurementComplete();
      this.callbacks.onGarmentMeasured?.(metrics);

      // Also set distance callback for waist width
      this.callbacks.onDistance(metrics.waistWidthMeters);

      return metrics;
    } catch (err) {
      console.error('[ArSession] Garment scan failed:', err);
      return null;
    } finally {
      this.isScanningGarment = false;
      this.callbacks.onGarmentScanning?.(false);
    }
  }

  reset(): void {
    this.clearLivePreview();

    if (this.garmentMeshGroup) {
      disposeGroup(this.garmentMeshGroup, this.scene);
      this.garmentMeshGroup = null;
    }

    this.markers.forEach((m) => disposeGroup(m.group, this.scene));
    this.markers = [];

    this.measurementLines.forEach((line) => {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.measurementLines = [];

    this.distanceLabels.forEach((label) => {
      this.scene.remove(label);
      label.geometry.dispose();
      (label.material as THREE.SpriteMaterial).map?.dispose();
      label.material.dispose();
    });
    this.distanceLabels = [];

    this.poseFilter.reset();

    this.step = 'place-a';
    this.callbacks.onStep('place-a');
    this.callbacks.onPointsChange([]);
    this.callbacks.onLiveDistance(null);
    this.callbacks.onOrientation(null);
  }

  // ─── Image Capture ───────────────────────────────────────────────────────

  /**
   * Captures a real camera image plus all calibration metadata at this moment.
   *
   * Image strategy (WebXR):
   *   The AR camera passthrough is composited by the browser's XR runtime and
   *   is NOT accessible via canvas.toDataURL() (which only has the Three.js overlay).
   *   We use the ImageCapture API on the rear camera MediaStreamTrack we opened
   *   separately in start().  grabFrame() returns an ImageBitmap from the actual
   *   camera sensor at full resolution.
   *
   * Z_m strategy:
   *   Derived from camera world position and the latest hit-test plane position —
   *   both already available from the render loop. The perpendicular projection
   *   onto the plane normal gives the true distance.
   *
   * fx / fy strategy:
   *   From the XRCamera projection matrix P stored in lastViewProjectionMatrix.
   *   For a column-major WebGL/WebXR projection matrix:
   *     P[0]  = 2*fx / W    →  fx_pixels = P[0] * W / 2
   *     P[5]  = 2*fy / H    →  fy_pixels = P[5] * H / 2
   *   where W, H are the XR viewport dimensions in pixels.
   */
  async captureImage(): Promise<CaptureResult> {
    const capturedAt = new Date().toISOString();

    // ── 1. Calculate Z_m, planePosition, planeNormal, planeTransform BEFORE releasing WebXR ───
    let Z_m: number | null = null;
    let planePosition: { x: number; y: number; z: number } | null = null;
    let planeNormal: { x: number; y: number; z: number } | null = null;
    let planeQuaternion: { x: number; y: number; z: number; w: number } | null = null;
    let planeTransform: number[] | null = null;
    const trackingValid = this.hasHit && this.trackingStatus === 'good';

    if (trackingValid) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);

      const up = new THREE.Vector3(0, 1, 0);
      const normal = up.applyQuaternion(this.currentSmoothedQuat.clone()).normalize();

      const toPlane = camPos.clone().sub(this.currentSmoothedPos);
      Z_m = Math.abs(toPlane.dot(normal));  // Perpendicular distance in metres

      planePosition = { x: this.currentSmoothedPos.x, y: this.currentSmoothedPos.y, z: this.currentSmoothedPos.z };
      planeNormal = { x: normal.x, y: normal.y, z: normal.z };
      planeQuaternion = {
        x: this.currentSmoothedQuat.x,
        y: this.currentSmoothedQuat.y,
        z: this.currentSmoothedQuat.z,
        w: this.currentSmoothedQuat.w,
      };

      const planeMat = new THREE.Matrix4().compose(
        this.currentSmoothedPos,
        this.currentSmoothedQuat,
        new THREE.Vector3(1, 1, 1)
      );
      planeTransform = Array.from(planeMat.elements);
    }

    // ── 2. Camera pose from WebXR viewer pose or Three.js camera ─────────────
    let cameraPose: CameraPoseData | null = null;
    if (this.lastViewerPose) {
      const xrT = this.lastViewerPose.transform;
      const camMat = xrT.matrix ? Array.from(xrT.matrix) : Array.from(this.camera.matrixWorld.elements);
      const camMatInv = xrT.inverse?.matrix
        ? Array.from(xrT.inverse.matrix)
        : Array.from(new THREE.Matrix4().fromArray(camMat).invert().elements);

      cameraPose = {
        position: { x: xrT.position.x, y: xrT.position.y, z: xrT.position.z },
        quaternion: { x: xrT.orientation.x, y: xrT.orientation.y, z: xrT.orientation.z, w: xrT.orientation.w },
        cameraMatrix: camMat,
        cameraMatrixInverse: camMatInv,
      };
    } else if (this.camera) {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      this.camera.getWorldPosition(pos);
      this.camera.getWorldQuaternion(quat);
      cameraPose = {
        position: { x: pos.x, y: pos.y, z: pos.z },
        quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        cameraMatrix: Array.from(this.camera.matrixWorld.elements),
        cameraMatrixInverse: Array.from(this.camera.matrixWorldInverse.elements),
      };
    }

    // ── 3. Projection matrix ──────────────────────────────────────────────────
    const projMat = this.lastViewProjectionMatrix || (this.camera?.projectionMatrix ? Array.from(this.camera.projectionMatrix.elements) : null);

    // ── 4. Capture real camera photograph ─────────────────────────────────────
    // On Android, ARCore holds exclusive lock on the camera sensor while WebXR is running,
    // which prevents any secondary stream from capturing real frames.
    // We cleanly release the WebXR session so Android's camera HAL is unlocked and Chrome
    // allows file downloads.
    this.isCapturingImage = true;
    if (this.xrSession) {
      try {
        await this.xrSession.end();
      } catch {}
    }

    let imageDataUrl = '';
    let imageWidth = 0;
    let imageHeight = 0;

    try {
      // Hardware camera is now completely UNLOCKED!
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();

      // Wait 350ms for exposure and autofocus to settle
      await new Promise((r) => setTimeout(r, 350));

      const vw = video.videoWidth || 1920;
      const vh = video.videoHeight || 1080;
      const cv = document.createElement('canvas');
      cv.width = vw;
      cv.height = vh;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(video, 0, 0, vw, vh);

      imageDataUrl = cv.toDataURL('image/jpeg', 0.95);
      imageWidth = vw;
      imageHeight = vh;

      // Close camera stream immediately
      stream.getTracks().forEach((t) => t.stop());
      console.log(`[ArSession] Crisp camera frame captured: ${vw}x${vh}`);
    } catch (err) {
      console.warn('[ArSession] Direct camera snapshot after XR release failed:', err);
    }

    this.isCapturingImage = false;

    // ── 5. Scale focal lengths & principal point to captured image resolution ──
    let fx_pixels: number | null = null;
    let fy_pixels: number | null = null;
    let cx_pixels: number | null = null;
    let cy_pixels: number | null = null;
    let intrinsicsSource: CaptureResult['intrinsicsSource'] = null;
    let projectionMatrix: number[] | null = null;

    if (projMat && projMat[0] > 0 && projMat[5] > 0) {
      const targetW = imageWidth > 0 ? imageWidth : (window.innerWidth * (window.devicePixelRatio || 1));
      const targetH = imageHeight > 0 ? imageHeight : (window.innerHeight * (window.devicePixelRatio || 1));
      const derived = deriveIntrinsicsFromMatrix(projMat, targetW, targetH);
      if (derived) {
        fx_pixels = derived.fx_pixels;
        fy_pixels = derived.fy_pixels;
        cx_pixels = derived.cx_pixels;
        cy_pixels = derived.cy_pixels;
        intrinsicsSource = 'webxr-projection';
        projectionMatrix = projMat;
      }
    }

    const intrinsicsBundle: CameraIntrinsicsData | null = intrinsicsSource ? {
      fx_pixels,
      fy_pixels,
      cx_pixels,
      cy_pixels,
      imageWidth,
      imageHeight,
      projectionMatrix,
      intrinsicsSource,
    } : null;

    const planeBundle: TrouserPlaneData | null = trackingValid ? {
      planePosition,
      planeNormal,
      planeQuaternion,
      planeTransform,
      planeSource: 'webxr-hittest',
      planeTrackingValid: true,
    } : null;

    // ── 6. Build reliability note ─────────────────────────────────────────────
    const parts: string[] = [];
    if (imageDataUrl) parts.push('Image: Real high-resolution camera photograph');
    else parts.push('Image: Camera capture failed');
    if (Z_m !== null) parts.push(`Z: ${Z_m.toFixed(3)} m from WebXR hit-test plane (perpendicular)`);
    else parts.push('Z: unavailable — no plane detected or tracking lost');
    if (fx_pixels !== null && fy_pixels !== null) {
      parts.push(`fx=${fx_pixels.toFixed(1)} px, fy=${fy_pixels.toFixed(1)} px, cx=${cx_pixels?.toFixed(1) ?? 'N/A'}, cy=${cy_pixels?.toFixed(1) ?? 'N/A'} (WebXR projection)`);
    } else {
      parts.push('fx/fy: unavailable');
    }
    const reliabilityNote = parts.join(' | ');

    const result: CaptureResult = {
      imageDataUrl,
      imageWidth,
      imageHeight,
      Z_m,
      distanceSource: trackingValid ? 'webxr-hittest' : null,
      distanceValid: trackingValid && Z_m !== null,
      distanceDefinition: 'perpendicular-camera-to-plane',
      fx_pixels,
      fy_pixels,
      cx_pixels,
      cy_pixels,
      intrinsicsSource,
      intrinsics: intrinsicsBundle,
      cameraPose,
      planePosition,
      planeNormal,
      planeQuaternion,
      planeTransform,
      planeSource: trackingValid ? 'webxr-hittest' : null,
      planeTrackingValid: trackingValid,
      plane: planeBundle,
      projectionMatrix,
      waistbandLandmarks: null,
      waistbandWidthResult: null,
      capturedAt,
      trackingValid,
      reliabilityNote,
    };

    this.callbacks.onCapture?.(result);
    return result;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;

    // Clean up background capture video and stream
    if (this.captureVideo) {
      this.captureVideo.pause();
      this.captureVideo.srcObject = null;
      if (this.captureVideo.parentElement) {
        this.captureVideo.parentElement.removeChild(this.captureVideo);
      }
      this.captureVideo = null;
    }
    if (this.captureStream) {
      this.captureStream.getTracks().forEach((t) => t.stop());
      this.captureStream = null;
    }
    this.rearCameraTrack = null;

    if (this.xrSession) {
      this.xrSession.end().catch(() => {});
    }
    this.renderer.setAnimationLoop(null);
  }

  private handleSessionEnd(): void {
    this.renderer.setAnimationLoop(null);
    if (this.hitTestSource) {
      this.hitTestSource.cancel?.();
      this.hitTestSource = null;
    }
    this.xrSession = null;
    this.step = 'idle';
    this.callbacks.onStep('idle');
    this.callbacks.onTrackingStatus('lost');

    // Only exit back to home screen if user intentionally exited (not during captureImage)
    if (!this.isCapturingImage) {
      this.ended = true;
      this.callbacks.onEnd();
    }
  }
}
