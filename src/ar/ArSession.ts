/**
 * ArSession — WebXR immersive-ar session manager.
 *
 * Responsibilities:
 *  - Initialize Three.js renderer with XR enabled
 *  - Request WebXR immersive-ar session with hit-test
 *  - Run hit-test each frame to position the reticle on detected surfaces
 *  - Handle 'select' (tap) events to place markers
 *  - Compute real-world 3D distance between Point A and Point B
 *  - Render markers, line, and midpoint label in world space
 *  - Notify the React UI via callbacks
 *
 * Distance is computed in meters using the Euclidean formula:
 *   d = sqrt((x2-x1)^2 + (y2-y1)^2 + (z2-z1)^2)
 * No screen pixels are involved.
 */

import * as THREE from 'three';
import { Point3D, euclideanDistance } from '../utils/distance';

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

export interface ArSessionCallbacks {
  onTrackingStatus: (status: TrackingStatus) => void;
  onStep: (step: MeasurementStep) => void;
  onPointA: (point: Point3D) => void;
  onPointB: (point: Point3D) => void;
  onDistance: (distanceMeters: number) => void;
  onError: (error: AppError) => void;
  onEnd: () => void;
}

// ─── Canvas label helpers ──────────────────────────────────────────────────

function makeMarkerSprite(label: string, color: string): THREE.Sprite {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.45}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 2);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;
  return sprite;
}

function makeDistanceSprite(text: string): THREE.Sprite {
  const w = 320;
  const h = 100;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;

  const r = 18;
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
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 48px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 1000;
  return sprite;
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group);
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => {
          (m as THREE.SpriteMaterial).map?.dispose();
          m.dispose();
        });
      } else {
        (obj.material as THREE.SpriteMaterial).map?.dispose();
        obj.material.dispose();
      }
    }
  });
}

function disposeLine(line: THREE.Line, scene: THREE.Scene): void {
  scene.remove(line);
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

function disposeSprite(sprite: THREE.Sprite, scene: THREE.Scene): void {
  scene.remove(sprite);
  (sprite.material as THREE.SpriteMaterial).map?.dispose();
  sprite.material.dispose();
}

// ─── Main class ────────────────────────────────────────────────────────────

export class ArSession {
  // Three.js
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private reticleGroup: THREE.Group;

  // XR
  private xrSession: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private localSpace: XRReferenceSpace | null = null;

  // Scene objects
  private markerGroupA: THREE.Group | null = null;
  private markerGroupB: THREE.Group | null = null;
  private measureLine: THREE.Line | null = null;
  private midLabel: THREE.Sprite | null = null;

  // Reticle pulse animation
  private reticlePulse = 0;

  // State
  private pointA: Point3D | null = null;
  private pointB: Point3D | null = null;
  private step: MeasurementStep = 'idle';
  private trackingStatus: TrackingStatus = 'detecting';
  private ended = false;

  // Throttle React state updates (don't set state 60x/sec)
  private lastStatusUpdate = 0;

  private callbacks: ArSessionCallbacks;
  private boundSelect: () => void;

  constructor(canvas: HTMLCanvasElement, callbacks: ArSessionCallbacks) {
    this.callbacks = callbacks;

    // ── Renderer ──────────────────────────────────────────────────────────
    // antialias: false  → massive GPU saving on mobile
    // pixelRatio: 1     → let WebXR compositor handle resolution scaling
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,          // ← PERF: off saves ~30% GPU on mobile
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1); // ← PERF: XR compositor handles scaling
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = false;
    // Use a faster output color space
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // ── Scene ─────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20,
    );

    // Single ambient light is enough for AR — no shadows needed
    const ambient = new THREE.AmbientLight(0xffffff, 3.0);
    this.scene.add(ambient);

    // ── Reticle ───────────────────────────────────────────────────────────
    // Fewer segments (16/24 vs 32) → less GPU work
    const ringGeo = new THREE.RingGeometry(0.05, 0.08, 24).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const innerGeo = new THREE.CircleGeometry(0.016, 16).rotateX(-Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });

    this.reticleGroup = new THREE.Group();
    this.reticleGroup.add(new THREE.Mesh(ringGeo, ringMat));
    this.reticleGroup.add(new THREE.Mesh(innerGeo, innerMat));
    this.reticleGroup.matrixAutoUpdate = false;
    this.reticleGroup.visible = false;
    this.scene.add(this.reticleGroup);

    this.boundSelect = this.handleSelect.bind(this);
  }

  // ─── Session start ───────────────────────────────────────────────────────

  async start(overlayRoot: Element): Promise<void> {
    if (!navigator.xr) {
      this.callbacks.onError('ar-unsupported');
      return;
    }

    // ── 1. Request XR session ─────────────────────────────────────────────
    try {
      const sessionInit = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
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

    // ── 2. Set up Three.js XR ─────────────────────────────────────────────
    try {
      await this.renderer.xr.setSession(this.xrSession);
    } catch (err) {
      console.error('renderer.xr.setSession failed:', err);
      this.callbacks.onError('session-failed');
      return;
    }

    // ── 3. Reference spaces ───────────────────────────────────────────────
    // Try 'local-floor' first (better for flat surface detection),
    // fall back to 'local' which all AR-capable devices support.
    try {
      this.localSpace = await this.xrSession.requestReferenceSpace('local-floor');
      console.log('[AR] Using local-floor reference space');
    } catch {
      try {
        this.localSpace = await this.xrSession.requestReferenceSpace('local');
        console.log('[AR] Using local reference space');
      } catch (err) {
        console.error('[AR] Could not get any reference space:', err);
        this.callbacks.onError('session-failed');
        return;
      }
    }

    // ── 4. Hit-test source ────────────────────────────────────────────────
    // We test from the 'viewer' space (the camera) and get results
    // in localSpace (world coordinates).
    let viewerSpace: XRReferenceSpace;
    try {
      viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    } catch (err) {
      console.error('[AR] Could not get viewer space:', err);
      this.callbacks.onError('session-failed');
      return;
    }

    try {
      // requestHitTestSource is guaranteed by 'hit-test' in requiredFeatures
      const hitTestFn = (this.xrSession as unknown as {
        requestHitTestSource: (opts: { space: XRSpace }) => Promise<XRHitTestSource>;
      }).requestHitTestSource;

      if (!hitTestFn) {
        throw new Error('requestHitTestSource is not available');
      }
      this.hitTestSource = await hitTestFn.call(this.xrSession, { space: viewerSpace });
      console.log('[AR] Hit-test source created successfully');
    } catch (err) {
      console.error('[AR] requestHitTestSource failed:', err);
      this.callbacks.onError('session-failed');
      return;
    }

    // ── 5. Event listeners ────────────────────────────────────────────────
    this.xrSession.addEventListener('select', this.boundSelect);
    this.xrSession.addEventListener('end', this.handleSessionEnd.bind(this));

    // ── 6. Start render loop ─────────────────────────────────────────────
    this.step = 'detecting';
    this.callbacks.onStep('detecting');
    this.renderer.setAnimationLoop(this.renderLoop.bind(this));
  }

  // ─── Render loop (called every XR frame ~60fps) ───────────────────────────
  // Keep this as LEAN as possible — it runs every frame on the GPU thread.

  private renderLoop(_timestamp: number, frame: XRFrame | undefined): void {
    if (!frame) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!this.hitTestSource || !this.localSpace) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // ── Hit-test ──────────────────────────────────────────────────────────
    const hitTestResults = frame.getHitTestResults(this.hitTestSource);

    const now = performance.now();
    const shouldUpdateStatus = now - this.lastStatusUpdate > 200; // throttle to 5/sec

    if (hitTestResults.length > 0) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(this.localSpace);

      if (pose) {
        // Update reticle position using the XR world-space matrix
        this.reticleGroup.visible = true;
        this.reticleGroup.matrix.fromArray(pose.transform.matrix);
        this.reticleGroup.matrix.decompose(
          this.reticleGroup.position,
          this.reticleGroup.quaternion,
          this.reticleGroup.scale,
        );

        // Pulse the reticle scale for visual feedback
        this.reticlePulse += 0.08;
        const pulse = 1 + Math.sin(this.reticlePulse) * 0.06;
        this.reticleGroup.scale.set(pulse, pulse, pulse);

        if (this.trackingStatus !== 'good') {
          this.trackingStatus = 'good';
          if (shouldUpdateStatus) {
            this.lastStatusUpdate = now;
            this.callbacks.onTrackingStatus('good');
            if (this.step === 'detecting') {
              this.step = 'place-a';
              this.callbacks.onStep('place-a');
            }
          }
        }
      }
    } else {
      if (this.reticleGroup.visible) {
        this.reticleGroup.visible = false;
      }
      if (this.trackingStatus !== 'detecting' && this.step !== 'measured') {
        if (shouldUpdateStatus) {
          this.lastStatusUpdate = now;
          this.trackingStatus = 'detecting';
          this.callbacks.onTrackingStatus('detecting');
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ─── Tap handler ─────────────────────────────────────────────────────────

  private handleSelect(): void {
    if (!this.reticleGroup.visible) return;
    if (this.step !== 'place-a' && this.step !== 'place-b') return;

    const pos: Point3D = {
      x: this.reticleGroup.position.x,
      y: this.reticleGroup.position.y,
      z: this.reticleGroup.position.z,
    };

    if (this.step === 'place-a') {
      this.pointA = pos;
      this.placeMarker('A', pos, '#1a8cff');
      this.callbacks.onPointA(pos);
      this.step = 'place-b';
      this.callbacks.onStep('place-b');
    } else if (this.step === 'place-b' && this.pointA) {
      this.pointB = pos;
      this.placeMarker('B', pos, '#ff6b1a');
      this.callbacks.onPointB(pos);

      const dist = euclideanDistance(this.pointA, pos);
      this.drawMeasurement(this.pointA, pos, dist);
      this.callbacks.onDistance(dist);

      this.step = 'measured';
      this.callbacks.onStep('measured');
    }
  }

  // ─── 3D object helpers ────────────────────────────────────────────────────

  private placeMarker(label: 'A' | 'B', pos: Point3D, color: string): void {
    const group = new THREE.Group();

    // Simple sphere — low-poly for performance
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 12, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
    );
    group.add(sphere);

    // Thin vertical stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.06, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    stem.position.y = 0.048;
    group.add(stem);

    // Label sprite above the stem
    const sprite = makeMarkerSprite(label, color);
    sprite.scale.set(0.08, 0.08, 1);
    sprite.position.y = 0.1;
    group.add(sprite);

    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);

    if (label === 'A') {
      if (this.markerGroupA) disposeGroup(this.markerGroupA, this.scene);
      this.markerGroupA = group;
    } else {
      if (this.markerGroupB) disposeGroup(this.markerGroupB, this.scene);
      this.markerGroupB = group;
    }
  }

  private drawMeasurement(a: Point3D, b: Point3D, distMeters: number): void {
    if (this.measureLine) disposeLine(this.measureLine, this.scene);
    if (this.midLabel) disposeSprite(this.midLabel, this.scene);

    // Measurement line
    const points = [
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    this.measureLine = new THREE.Line(lineGeo, lineMat);
    this.scene.add(this.measureLine);

    // Midpoint floating label
    const mid = new THREE.Vector3(
      (a.x + b.x) / 2,
      Math.max(a.y, b.y) + 0.07,
      (a.z + b.z) / 2,
    );
    const cm = (distMeters * 100).toFixed(1);
    this.midLabel = makeDistanceSprite(`${cm} cm`);
    this.midLabel.scale.set(0.22, 0.07, 1);
    this.midLabel.position.copy(mid);
    this.scene.add(this.midLabel);
  }

  // ─── Reset / cleanup ─────────────────────────────────────────────────────

  reset(): void {
    if (this.markerGroupA) { disposeGroup(this.markerGroupA, this.scene); this.markerGroupA = null; }
    if (this.markerGroupB) { disposeGroup(this.markerGroupB, this.scene); this.markerGroupB = null; }
    if (this.measureLine)  { disposeLine(this.measureLine, this.scene);   this.measureLine = null; }
    if (this.midLabel)     { disposeSprite(this.midLabel, this.scene);    this.midLabel = null; }

    this.pointA = null;
    this.pointB = null;
    this.step = 'place-a';
    this.callbacks.onStep('place-a');
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.xrSession) {
      this.xrSession.end().catch(() => {/* already ended */});
    }
    this.renderer.setAnimationLoop(null);
  }

  private handleSessionEnd(): void {
    this.renderer.setAnimationLoop(null);
    if (this.hitTestSource) {
      this.hitTestSource.cancel?.();
      this.hitTestSource = null;
    }
    if (!this.ended) {
      this.ended = true;
      this.callbacks.onEnd();
    }
  }
}
