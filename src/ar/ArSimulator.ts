/**
 * ArSimulator — Desktop and Non-AR 3D Interactive Simulator.
 *
 * Implements the same callback contract as ArSession, rendering a virtual 3D room
 * (floor, table, walls, obstacles) with mouse-look and WASD navigation.
 * Uses Three.js Raycaster to simulate WebXR hit-testing with realistic surface normals.
 */

import * as THREE from 'three';
import {
  Point3D,
  euclideanDistance,
  getLineOrientation,
  LineOrientation,
} from '../utils/distance';
import {
  ArSessionCallbacks,
  MeasurementStep,
  TrackingStatus,
  GuidanceStatus,
} from './ArSession';
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
import type { CaptureResult } from './captureTypes';


interface MarkerItem {
  point: Point3D;
  group: THREE.Group;
}

export class ArSimulator {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Reticle
  private reticleGroup: THREE.Group;
  private reticleRingMat: THREE.MeshBasicMaterial;

  // Garment Auto-Measure State
  private garmentMeshGroup: THREE.Group | null = null;
  private isScanningGarment = false;

  // Smoothing
  private poseFilter = new AdaptivePoseFilter({
    minAlpha: 0.15,
    maxAlpha: 0.85,
    deadbandMeters: 0.002,
  });

  // Measurement State
  private markers: MarkerItem[] = [];
  private measurementLines: THREE.Line[] = [];
  private distanceLabels: THREE.Sprite[] = [];
  private livePreviewLine: THREE.Line | null = null;
  private livePreviewLabel: THREE.Sprite | null = null;

  // Raycaster for simulated hit-testing
  private raycaster = new THREE.Raycaster();
  private hittableMeshes: THREE.Mesh[] = [];

  // Camera Navigation Controls
  private isPointerDown = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private cameraPitch = -0.3; // Look slightly downwards
  private cameraYaw = 0;
  private moveVelocity = new THREE.Vector3();
  private keysDown = new Set<string>();

  // State
  private step: MeasurementStep = 'idle';
  private trackingStatus: TrackingStatus = 'detecting';
  private currentSmoothedPos = new THREE.Vector3();
  private currentSmoothedQuat = new THREE.Quaternion();
  private hasHit = false;
  private animFrameId: number | null = null;
  private ended = false;

  private callbacks: ArSessionCallbacks;

  // Event handlers
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundResize: () => void;

  constructor(canvas: HTMLCanvasElement, callbacks: ArSessionCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    // ── Renderer ──────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ── Scene & Camera ────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e111a);
    this.scene.fog = new THREE.FogExp2(0x0e111a, 0.08);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.05,
      30
    );
    // Initial camera position (simulating a person standing in a room)
    this.camera.position.set(0, 1.4, 1.5);

    // ── Lighting ──────────────────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(3, 5, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    // ── Build Virtual 3D Room ─────────────────────────────────────────────
    this.buildVirtualRoom();

    // ── Holographic Reticle ───────────────────────────────────────────────
    this.reticleGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.045, 0.065, 32).rotateX(-Math.PI / 2);
    this.reticleRingMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.reticleGroup.add(new THREE.Mesh(ringGeo, this.reticleRingMat));

    const centerGeo = new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2);
    this.reticleGroup.add(new THREE.Mesh(
      centerGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    ));

    // Precision crosshairs
    const tickMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const tickPoints = [
      new THREE.Vector3(-0.04, 0.001, 0), new THREE.Vector3(-0.015, 0.001, 0),
      new THREE.Vector3(0.015, 0.001, 0),  new THREE.Vector3(0.04, 0.001, 0),
      new THREE.Vector3(0, 0.001, -0.04), new THREE.Vector3(0, 0.001, -0.015),
      new THREE.Vector3(0, 0.001, 0.015),  new THREE.Vector3(0, 0.001, 0.04),
    ];
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    this.reticleGroup.add(new THREE.LineSegments(tickGeo, tickMat));

    this.reticleGroup.visible = false;
    this.scene.add(this.reticleGroup);

    // ── Bind Event Listeners ──────────────────────────────────────────────
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundResize = this.handleResize.bind(this);
  }

  // ─── Build Realistic Virtual 3D Room ─────────────────────────────────────

  private buildVirtualRoom(): void {
    // 1. Checkered Room Floor (6m x 6m)
    const floorSize = 8;
    const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize, 16, 16);
    floorGeo.rotateX(-Math.PI / 2);

    // Grid floor texture canvas
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#181e2b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#222a3d';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillRect(256, 256, 256, 256);

    const floorTex = new THREE.CanvasTexture(canvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(8, 8);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.8,
      metalness: 0.1,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.hittableMeshes.push(floorMesh);

    // 2. Study Table / Desk (1.2m wide, 0.6m deep, 0.75m high)
    const tableTopGeo = new THREE.BoxGeometry(1.2, 0.05, 0.7);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b, // warm wood
      roughness: 0.4,
    });
    const tableTop = new THREE.Mesh(tableTopGeo, tableMat);
    tableTop.position.set(0, 0.75, -0.6);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    this.scene.add(tableTop);
    this.hittableMeshes.push(tableTop);

    // 4 Table Legs
    const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.73, 12);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
    const legOffsets = [
      [-0.54, 0.365, -0.88],
      [0.54, 0.365, -0.88],
      [-0.54, 0.365, -0.32],
      [0.54, 0.365, -0.32],
    ];
    legOffsets.forEach(([x, y, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, y, z);
      leg.castShadow = true;
      this.scene.add(leg);
      this.hittableMeshes.push(leg);
    });

    // 3. Laptop / Box on Table
    const boxGeo = new THREE.BoxGeometry(0.32, 0.18, 0.24);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(-0.25, 0.865, -0.6);
    box.castShadow = true;
    box.receiveShadow = true;
    this.scene.add(box);
    this.hittableMeshes.push(box);

    // 4. Back Wall
    const wallGeo = new THREE.BoxGeometry(floorSize, 3.2, 0.1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1f2638, roughness: 0.9 });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 1.6, -1.8);
    backWall.receiveShadow = true;
    this.scene.add(backWall);
    this.hittableMeshes.push(backWall);
  }

  // ─── Start Simulator ─────────────────────────────────────────────────────

  async start(_overlayRoot: Element): Promise<void> {
    window.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('resize', this.boundResize);

    // Simulate instant surface tracking acquisition
    this.step = 'detecting';
    this.callbacks.onStep('detecting');

    setTimeout(() => {
      if (!this.ended) {
        this.step = 'place-a';
        this.trackingStatus = 'good';
        this.callbacks.onTrackingStatus('good');
        this.callbacks.onStep('place-a');
      }
    }, 400);

    this.renderLoop();
  }

  // ─── Render Loop ─────────────────────────────────────────────────────────

  private renderLoop = (): void => {
    if (this.ended) return;

    this.updateCameraMovement();

    // Raycast from camera center (simulating camera center hit-test)
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const intersects = this.raycaster.intersectObjects(this.hittableMeshes, false);

    const now = performance.now();

    if (intersects.length > 0) {
      const hit = intersects[0];
      this.hasHit = true;

      // Extract hit position and normal
      const rawPos = hit.point;
      const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      normal.transformDirection(hit.object.matrixWorld);

      // Create quaternion aligned with surface normal
      const up = new THREE.Vector3(0, 1, 0);
      const rawQuat = new THREE.Quaternion().setFromUnitVectors(up, normal);

      // Filter position and quaternion
      const filtered = this.poseFilter.update(rawPos, rawQuat, now);
      this.currentSmoothedPos.copy(filtered.position);
      this.currentSmoothedQuat.copy(filtered.quaternion);

      this.reticleGroup.visible = true;
      this.reticleGroup.position.copy(filtered.position);
      this.reticleGroup.quaternion.copy(filtered.quaternion);

      // Camera distance calculation
      const distToSurface = this.camera.position.distanceTo(filtered.position);
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

      // Update live measurement line if Point A exists
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
    } else {
      this.hasHit = false;
      this.reticleGroup.visible = false;
      this.clearLivePreview();
      this.callbacks.onLiveDistance(null);
    }

    this.renderer.render(this.scene, this.camera);
    this.animFrameId = requestAnimationFrame(this.renderLoop);
  };

  // ─── Camera Movement & Controls ──────────────────────────────────────────

  private updateCameraMovement(): void {
    const moveSpeed = 0.025;
    const forward = new THREE.Vector3(
      -Math.sin(this.cameraYaw),
      0,
      -Math.cos(this.cameraYaw)
    ).normalize();
    const right = new THREE.Vector3(
      Math.cos(this.cameraYaw),
      0,
      -Math.sin(this.cameraYaw)
    ).normalize();

    this.moveVelocity.set(0, 0, 0);

    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) {
      this.moveVelocity.add(forward);
    }
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) {
      this.moveVelocity.sub(forward);
    }
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) {
      this.moveVelocity.sub(right);
    }
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) {
      this.moveVelocity.add(right);
    }

    if (this.moveVelocity.lengthSq() > 0) {
      this.moveVelocity.normalize().multiplyScalar(moveSpeed);
      this.camera.position.add(this.moveVelocity);
    }

    // Apply pitch and yaw
    const euler = new THREE.Euler(this.cameraPitch, this.cameraYaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  private handlePointerDown(e: PointerEvent): void {
    // If clicking on a button or UI overlay element, ignore camera rotation
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.hud-result-card') || target.closest('.debug-panel')) {
      return;
    }

    this.isPointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isPointerDown) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    const rotSpeed = 0.0035;
    this.cameraYaw -= dx * rotSpeed;
    this.cameraPitch -= dy * rotSpeed;
    this.cameraPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.cameraPitch));
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    // If it was a quick click without much dragging (< 6 pixels), treat as a tap select
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.hud-result-card') || target.closest('.debug-panel')) {
      return;
    }

    this.handleSelect();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    this.keysDown.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      this.handleSelect();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
  }

  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ─── Tap / Select Placement ──────────────────────────────────────────────

  public handleSelect(): void {
    if (!this.hasHit || !this.reticleGroup.visible) return;
    if (this.step !== 'place-a' && this.step !== 'place-b') return;

    const pos: Point3D = {
      x: this.currentSmoothedPos.x,
      y: this.currentSmoothedPos.y,
      z: this.currentSmoothedPos.z,
    };

    if (this.step === 'place-a') {
      const group = this.createMarkerMesh('A', pos, '#00b4d8');
      this.markers.push({ point: pos, group });
      feedback.triggerPointPlaced();

      this.callbacks.onPointA(pos);
      this.callbacks.onPointsChange(this.markers.map((m) => m.point));

      this.step = 'place-b';
      this.callbacks.onStep('place-b');
    } else if (this.step === 'place-b') {
      const group = this.createMarkerMesh('B', pos, '#ff7043');
      this.markers.push({ point: pos, group });

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

  // ─── Meshes & Visuals ────────────────────────────────────────────────────

  private createMarkerMesh(label: string, pos: Point3D, color: string): THREE.Group {
    const group = new THREE.Group();

    // Ground ring
    const ringGeo = new THREE.RingGeometry(0.015, 0.03, 24).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    group.add(new THREE.Mesh(ringGeo, ringMat));

    // Pin base sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 16, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color) })
    );
    sphere.position.y = 0.014;
    group.add(sphere);

    // Stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.05, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    stem.position.y = 0.045;
    group.add(stem);

    // Label Sprite
    const sprite = this.makeLabelSprite(label, color);
    sprite.scale.set(0.075, 0.075, 1);
    sprite.position.y = 0.095;
    group.add(sprite);

    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);
    return group;
  }

  private makeLabelSprite(label: string, color: string): THREE.Sprite {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, size / 2, size / 2 + 2);

    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 999;
    return sprite;
  }

  private drawPermanentMeasurement(a: Point3D, b: Point3D, distMeters: number): void {
    const points = [
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(lineGeo, lineMat);
    this.scene.add(line);
    this.measurementLines.push(line);

    // Midpoint label
    const mid = new THREE.Vector3(
      (a.x + b.x) / 2,
      Math.max(a.y, b.y) + 0.065,
      (a.z + b.z) / 2
    );
    const cm = (distMeters * 100).toFixed(1);
    const label = this.makeDistanceSprite(`${cm} cm`);
    label.scale.set(0.22, 0.07, 1);
    label.position.copy(mid);
    this.scene.add(label);
    this.distanceLabels.push(label);
  }

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
    this.livePreviewLabel = this.makeDistanceSprite(`${cm} cm`);
    this.livePreviewLabel.scale.set(0.18, 0.055, 1);
    this.livePreviewLabel.position.copy(mid);
    this.scene.add(this.livePreviewLabel);
  }

  private makeDistanceSprite(text: string): THREE.Sprite {
    const w = 320;
    const h = 100;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;

    ctx.fillStyle = 'rgba(10, 14, 24, 0.88)';
    ctx.roundRect ? ctx.roundRect(0, 0, w, h, 20) : ctx.rect(0, 0, w, h);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1000;
    return sprite;
  }

  private clearLivePreview(): void {
    if (this.livePreviewLine) this.livePreviewLine.visible = false;
    if (this.livePreviewLabel) {
      this.scene.remove(this.livePreviewLabel);
      this.livePreviewLabel.geometry.dispose();
      (this.livePreviewLabel.material as THREE.SpriteMaterial).map?.dispose();
      this.livePreviewLabel.material.dispose();
      this.livePreviewLabel = null;
    }
  }

  // ─── Undo & Reset ────────────────────────────────────────────────────────

  undoLastPoint(): void {
    if (this.markers.length === 0) return;
    feedback.triggerUndo();
    this.clearLivePreview();

    if (this.step === 'measured') {
      const last = this.markers.pop();
      if (last) this.scene.remove(last.group);

      const lastLine = this.measurementLines.pop();
      if (lastLine) this.scene.remove(lastLine);

      const lastLabel = this.distanceLabels.pop();
      if (lastLabel) this.scene.remove(lastLabel);

      this.step = 'place-b';
      this.callbacks.onStep('place-b');
      this.callbacks.onPointB(null as unknown as Point3D);
      this.callbacks.onPointsChange(this.markers.map((m) => m.point));
      this.callbacks.onOrientation(null);
    } else if (this.step === 'place-b') {
      const last = this.markers.pop();
      if (last) this.scene.remove(last.group);

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
      const dataUrl = this.renderer.domElement.toDataURL('image/jpeg', 0.85);
      const scanResult = await detectGarmentLandmarks(dataUrl);
      if (!scanResult.success || !scanResult.landmarks) {
        throw new Error(scanResult.error || 'Failed to detect garment landmarks');
      }

      // In the 3D room, study table top is at Y = 0.775
      const isLookingAtTable = this.camera.position.y > 0.5 && this.camera.position.z > -1.2;
      const planeY = isLookingAtTable ? 0.775 : 0.0;
      const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);

      const pWL = unprojectLandmarkToPlane(scanResult.landmarks.waist_left, this.camera, tablePlane);
      const pWR = unprojectLandmarkToPlane(scanResult.landmarks.waist_right, this.camera, tablePlane);
      if (!pWL || !pWR) throw new Error('Unprojection failed');

      const pInseam = scanResult.landmarks.inseam ? unprojectLandmarkToPlane(scanResult.landmarks.inseam, this.camera, tablePlane) || undefined : undefined;
      const pAnkleL = scanResult.landmarks.outer_ankle_left ? unprojectLandmarkToPlane(scanResult.landmarks.outer_ankle_left, this.camera, tablePlane) || undefined : undefined;
      const pAnkleR = scanResult.landmarks.outer_ankle_right ? unprojectLandmarkToPlane(scanResult.landmarks.outer_ankle_right, this.camera, tablePlane) || undefined : undefined;

      const garment3D: Garment3DPoints = {
        waistLeft: pWL,
        waistRight: pWR,
        inseam: pInseam,
        outerAnkleLeft: pAnkleL,
        outerAnkleRight: pAnkleR,
      };

      const metrics = calculateGarmentMetrics(garment3D, scanResult.pantType || 'Trousers');

      if (this.garmentMeshGroup) {
        this.scene.remove(this.garmentMeshGroup);
      }
      this.garmentMeshGroup = buildGarment3DMeshes(garment3D, metrics);
      this.scene.add(this.garmentMeshGroup);

      feedback.triggerMeasurementComplete();
      this.callbacks.onGarmentMeasured?.(metrics);
      this.callbacks.onDistance(metrics.waistWidthMeters);

      return metrics;
    } catch (err) {
      console.error('[ArSimulator] Garment scan failed:', err);
      return null;
    } finally {
      this.isScanningGarment = false;
      this.callbacks.onGarmentScanning?.(false);
    }
  }

  /**
   * Captures the current Three.js rendered scene image plus synthetic calibration data.
   * All values are clearly labelled as 'simulator' source — not real device measurements.
   */
  async captureImage(): Promise<CaptureResult> {
    const capturedAt = new Date().toISOString();

    // Image: Three.js canvas render (synthetic 3D room, not a real camera)
    const imageDataUrl = this.renderer.domElement.toDataURL('image/jpeg', 0.92);
    const imageWidth = this.renderer.domElement.width;
    const imageHeight = this.renderer.domElement.height;

    // Z_m: Euclidean distance from simulator camera to the raycaster hit point
    let Z_m: number | null = null;
    if (this.hasHit) {
      Z_m = this.camera.position.distanceTo(this.currentSmoothedPos);
    }

    // fx / fy: derived from the Three.js PerspectiveCamera parameters
    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const fy_pixels = (imageHeight / 2) / Math.tan(vFovRad / 2);
    const fx_pixels = fy_pixels * this.camera.aspect;

    // Camera pose
    const cameraPose: CaptureResult['cameraPose'] = {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      quaternion: {
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z,
        w: this.camera.quaternion.w,
      },
    };

    const planePosition = this.hasHit
      ? { x: this.currentSmoothedPos.x, y: this.currentSmoothedPos.y, z: this.currentSmoothedPos.z }
      : null;
    const planeNormal = this.hasHit
      ? (() => { const n = new THREE.Vector3(0,1,0).applyQuaternion(this.currentSmoothedQuat); return { x: n.x, y: n.y, z: n.z }; })()
      : null;

    const reliabilityNote = [
      'Image: SIMULATOR render (not a real camera — do not use for measurements)',
      Z_m !== null ? `Z: ${Z_m.toFixed(3)} m (synthetic raycaster, not real)` : 'Z: no hit',
      `fx=${fx_pixels.toFixed(1)} px, fy=${fy_pixels.toFixed(1)} px (synthetic Three.js FOV)`,
    ].join(' | ');

    const result: CaptureResult = {
      imageDataUrl,
      imageWidth,
      imageHeight,
      Z_m,
      distanceSource: 'simulator',
      fx_pixels,
      fy_pixels,
      intrinsicsSource: 'simulator',
      cameraPose,
      planePosition,
      planeNormal,
      projectionMatrix: null,
      capturedAt,
      trackingValid: this.hasHit,
      reliabilityNote,
    };

    this.callbacks.onCapture?.(result);
    return result;
  }

  reset(): void {
    this.clearLivePreview();

    if (this.garmentMeshGroup) {
      this.scene.remove(this.garmentMeshGroup);
      this.garmentMeshGroup = null;
    }

    this.markers.forEach((m) => this.scene.remove(m.group));
    this.markers = [];
    this.measurementLines.forEach((l) => this.scene.remove(l));
    this.measurementLines = [];
    this.distanceLabels.forEach((lbl) => this.scene.remove(lbl));
    this.distanceLabels = [];

    this.poseFilter.reset();

    this.step = 'place-a';
    this.callbacks.onStep('place-a');
    this.callbacks.onPointsChange([]);
    this.callbacks.onLiveDistance(null);
    this.callbacks.onOrientation(null);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }

    window.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('resize', this.boundResize);

    this.callbacks.onEnd();
  }
}
