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

  // Circle background
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Label text
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

  // Rounded rect background
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

  // Text
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
  private reticle: THREE.Mesh;

  // XR
  private xrSession: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private localSpace: XRReferenceSpace | null = null;

  // Scene objects
  private markerGroupA: THREE.Group | null = null;
  private markerGroupB: THREE.Group | null = null;
  private measureLine: THREE.Line | null = null;
  private midLabel: THREE.Sprite | null = null;

  // State
  private pointA: Point3D | null = null;
  private pointB: Point3D | null = null;
  private step: MeasurementStep = 'idle';
  private trackingStatus: TrackingStatus = 'detecting';
  private ended = false;

  private callbacks: ArSessionCallbacks;
  private boundSelect: () => void;

  constructor(canvas: HTMLCanvasElement, callbacks: ArSessionCallbacks) {
    this.callbacks = callbacks;

    // ── Renderer ──────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = false;

    // ── Scene ─────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20,
    );

    const ambient = new THREE.AmbientLight(0xffffff, 2.0);
    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(1, 3, 2);
    this.scene.add(ambient, directional);

    // ── Reticle ───────────────────────────────────────────────────────────
    const ringGeo = new THREE.RingGeometry(0.05, 0.08, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const innerGeo = new THREE.CircleGeometry(0.016, 32).rotateX(-Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });

    this.reticle = new THREE.Group() as unknown as THREE.Mesh;
    const reticleGroup = new THREE.Group();
    reticleGroup.add(new THREE.Mesh(ringGeo, ringMat));
    reticleGroup.add(new THREE.Mesh(innerGeo, innerMat));
    reticleGroup.matrixAutoUpdate = false;
    reticleGroup.visible = false;

    // Use the group as the reticle (cast)
    this.reticle = reticleGroup as unknown as THREE.Mesh;
    this.scene.add(reticleGroup);

    this.boundSelect = this.handleSelect.bind(this);
  }

  // ─── Session start ───────────────────────────────────────────────────────

  async start(overlayRoot: Element): Promise<void> {
    if (!navigator.xr) {
      this.callbacks.onError('ar-unsupported');
      return;
    }

    try {
      // Session init — dom-overlay and local-floor are optional
      const sessionInit = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: overlayRoot },
      } as XRSessionInit;

      this.xrSession = await navigator.xr.requestSession(
        'immersive-ar',
        sessionInit,
      );
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

      // Reference spaces
      this.localSpace = await this.xrSession.requestReferenceSpace('local');
      const viewerSpace = await this.xrSession.requestReferenceSpace('viewer');

      // Hit-test source (test rays from viewer perspective)
      // @ts-expect-error requestHitTestSource is part of the hit-test module
      this.hitTestSource = await this.xrSession.requestHitTestSource({
        space: viewerSpace,
      });

      this.xrSession.addEventListener('select', this.boundSelect);
      this.xrSession.addEventListener('end', this.handleSessionEnd.bind(this));

      this.step = 'detecting';
      this.callbacks.onStep('detecting');

      this.renderer.setAnimationLoop(this.renderLoop.bind(this));
    } catch (err) {
      console.error('AR setup error:', err);
      this.callbacks.onError('session-failed');
    }
  }

  // ─── Render loop (called every XR frame) ─────────────────────────────────

  private renderLoop(_timestamp: number, frame: XRFrame | undefined): void {
    if (!frame || !this.hitTestSource || !this.localSpace) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const results: XRHitTestResult[] = frame.getHitTestResults(
      this.hitTestSource,
    );

    const reticleGroup = this.reticle as unknown as THREE.Group;

    if (results.length > 0) {
      const hit = results[0];
      const pose = hit.getPose(this.localSpace);

      if (pose) {
        reticleGroup.visible = true;
        reticleGroup.matrixAutoUpdate = false;
        reticleGroup.matrix.fromArray(pose.transform.matrix);
        reticleGroup.matrix.decompose(
          reticleGroup.position,
          reticleGroup.quaternion,
          reticleGroup.scale,
        );

        if (this.trackingStatus !== 'good') {
          this.trackingStatus = 'good';
          this.callbacks.onTrackingStatus('good');
          // Advance from detecting to place-a
          if (this.step === 'detecting') {
            this.step = 'place-a';
            this.callbacks.onStep('place-a');
          }
        }
      }
    } else {
      reticleGroup.visible = false;
      if (
        this.trackingStatus !== 'detecting' &&
        this.step !== 'measured'
      ) {
        this.trackingStatus = 'detecting';
        this.callbacks.onTrackingStatus('detecting');
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ─── Tap handler ─────────────────────────────────────────────────────────

  private handleSelect(): void {
    const reticleGroup = this.reticle as unknown as THREE.Group;
    if (!reticleGroup.visible) return;
    if (this.step !== 'place-a' && this.step !== 'place-b') return;

    const pos: Point3D = {
      x: reticleGroup.position.x,
      y: reticleGroup.position.y,
      z: reticleGroup.position.z,
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

    // Sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 24, 24),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.25,
        metalness: 0.6,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.3,
      }),
    );
    group.add(sphere);

    // Thin vertical stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
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
    // Remove old line/label
    if (this.measureLine) disposeLine(this.measureLine, this.scene);
    if (this.midLabel) disposeSprite(this.midLabel, this.scene);

    // Line
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

    // Midpoint label
    const mid = new THREE.Vector3(
      (a.x + b.x) / 2,
      Math.max(a.y, b.y) + 0.06,
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
    if (this.markerGroupA) {
      disposeGroup(this.markerGroupA, this.scene);
      this.markerGroupA = null;
    }
    if (this.markerGroupB) {
      disposeGroup(this.markerGroupB, this.scene);
      this.markerGroupB = null;
    }
    if (this.measureLine) {
      disposeLine(this.measureLine, this.scene);
      this.measureLine = null;
    }
    if (this.midLabel) {
      disposeSprite(this.midLabel, this.scene);
      this.midLabel = null;
    }
    this.pointA = null;
    this.pointB = null;
    this.step = 'place-a';
    this.callbacks.onStep('place-a');
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.xrSession) {
      this.xrSession
        .end()
        .catch(() => {/* session may already be ended */});
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
