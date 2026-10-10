import * as THREE from 'three';
import { GarmentLandmarks, NormalizedPoint } from '../utils/garmentApi';

export interface GarmentMetrics {
  waistWidthMeters: number;
  waistWidthCm: number;
  waistWidthInches: number;
  fullWaistInches: number;
  recommendedSize: number;
  outseamMeters: number;
  outseamInches: number;
  inseamMeters: number;
  inseamInches: number;
  pantType: string;
}

export interface Garment3DPoints {
  waistLeft: THREE.Vector3;
  waistCenter?: THREE.Vector3;
  waistRight: THREE.Vector3;
  inseam?: THREE.Vector3;
  outerAnkleLeft?: THREE.Vector3;
  outerAnkleRight?: THREE.Vector3;
}

/**
 * Unprojects a 2D normalized screen point (0..1) onto a 3D physical world plane.
 */
export function unprojectLandmarkToPlane(
  point: NormalizedPoint,
  camera: THREE.PerspectiveCamera,
  plane: THREE.Plane
): THREE.Vector3 | null {
  // Convert 0..1 to Normalized Device Coordinates (-1..1)
  const ndcX = point.x * 2 - 1;
  const ndcY = -(point.y * 2) + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const hitPoint = new THREE.Vector3();
  const intersect = raycaster.ray.intersectPlane(plane, hitPoint);

  return intersect ? hitPoint : null;
}

/**
 * Calculates real-world metric dimensions from 3D garment points.
 */
export function calculateGarmentMetrics(
  points: Garment3DPoints,
  pantType: string = 'Jeans'
): GarmentMetrics {
  // 1. Flat Waist Width
  const waistWidthMeters = points.waistLeft.distanceTo(points.waistRight);
  const waistWidthCm = waistWidthMeters * 100;
  const waistWidthInches = waistWidthMeters * 39.3701;

  // Garment sizing formula: circumference is approx flat width * 2 minus 1 inch for ease/seam allowance
  const fullWaistInches = Math.max(24, Math.round((waistWidthInches * 2) - 1));
  const recommendedSize = fullWaistInches;

  // 2. Outseam Length (Waist Left to Outer Ankle Left, or Right)
  let outseamMeters = 0;
  if (points.outerAnkleLeft) {
    outseamMeters = points.waistLeft.distanceTo(points.outerAnkleLeft);
  } else if (points.outerAnkleRight) {
    outseamMeters = points.waistRight.distanceTo(points.outerAnkleRight);
  } else {
    outseamMeters = waistWidthMeters * 2.4; // proportional fallback
  }
  const outseamInches = outseamMeters * 39.3701;

  // 3. Inseam Length (Crotch Inseam to Ankle)
  let inseamMeters = 0;
  if (points.inseam && points.outerAnkleLeft) {
    inseamMeters = points.inseam.distanceTo(points.outerAnkleLeft);
  } else {
    inseamMeters = outseamMeters * 0.76; // standard pant proportion
  }
  const inseamInches = inseamMeters * 39.3701;

  return {
    waistWidthMeters,
    waistWidthCm,
    waistWidthInches,
    fullWaistInches,
    recommendedSize,
    outseamMeters,
    outseamInches,
    inseamMeters,
    inseamInches,
    pantType,
  };
}

/**
 * Creates 3D AR meshes representing the garment landmarks, connecting lines, and badges.
 */
export function buildGarment3DMeshes(
  points: Garment3DPoints,
  metrics: GarmentMetrics
): THREE.Group {
  const root = new THREE.Group();

  // Color Palette
  const WAIST_COLOR = 0x00e5ff; // Electric Cyan
  const INSEAM_COLOR = 0x00ff88; // Emerald Green
  const ANKLE_COLOR = 0xff7043; // Neon Orange

  // 1. Landmark Holographic Pins
  const addPin = (pos: THREE.Vector3, color: number, label: string) => {
    const pin = new THREE.Group();

    // Ground contact ring
    const ringGeo = new THREE.RingGeometry(0.012, 0.024, 20).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    pin.add(new THREE.Mesh(ringGeo, ringMat));

    // Center pin head
    const headGeo = new THREE.SphereGeometry(0.014, 16, 16);
    const headMat = new THREE.MeshBasicMaterial({ color });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.025;
    pin.add(head);

    // Label Sprite
    const sprite = makeMiniLabel(label, color);
    sprite.position.y = 0.06;
    pin.add(sprite);

    pin.position.copy(pos);
    root.add(pin);
  };

  addPin(points.waistLeft, WAIST_COLOR, 'Waist L');
  addPin(points.waistRight, WAIST_COLOR, 'Waist R');
  if (points.inseam) addPin(points.inseam, INSEAM_COLOR, 'Inseam');
  if (points.outerAnkleLeft) addPin(points.outerAnkleLeft, ANKLE_COLOR, 'Ankle L');
  if (points.outerAnkleRight) addPin(points.outerAnkleRight, ANKLE_COLOR, 'Ankle R');

  // 2. Waistband Measurement Line
  const waistPoints = [points.waistLeft, points.waistRight];
  const waistLineGeo = new THREE.BufferGeometry().setFromPoints(waistPoints);
  const waistLineMat = new THREE.LineBasicMaterial({ color: WAIST_COLOR, linewidth: 3 });
  root.add(new THREE.Line(waistLineGeo, waistLineMat));

  // 3. Floating Waistband Dimension Badge
  const waistMid = new THREE.Vector3()
    .addVectors(points.waistLeft, points.waistRight)
    .multiplyScalar(0.5);
  waistMid.y += 0.07;

  const waistText = `Waist: ${metrics.recommendedSize} in (${metrics.waistWidthCm.toFixed(1)} cm)`;
  const waistBadge = makeFloatingBadge(waistText, WAIST_COLOR);
  waistBadge.position.copy(waistMid);
  root.add(waistBadge);

  // 4. Outseam Lines (Waist to Ankle)
  if (points.outerAnkleLeft) {
    const outseamLGeo = new THREE.BufferGeometry().setFromPoints([points.waistLeft, points.outerAnkleLeft]);
    root.add(new THREE.Line(outseamLGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.7 })));
  }
  if (points.outerAnkleRight) {
    const outseamRGeo = new THREE.BufferGeometry().setFromPoints([points.waistRight, points.outerAnkleRight]);
    root.add(new THREE.Line(outseamRGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.7 })));
  }

  return root;
}

function makeMiniLabel(text: string, colorHex: number): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;

  ctx.fillStyle = 'rgba(10, 14, 24, 0.85)';
  ctx.roundRect ? ctx.roundRect(0, 0, 256, 96, 20) : ctx.rect(0, 0, 256, 96);
  ctx.fill();

  const color = new THREE.Color(colorHex);
  ctx.strokeStyle = `#${color.getHexString()}`;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 48);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.12, 0.045, 1);
  return sprite;
}

function makeFloatingBadge(text: string, colorHex: number): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 440;
  cv.height = 110;
  const ctx = cv.getContext('2d')!;

  ctx.fillStyle = 'rgba(10, 14, 24, 0.9)';
  ctx.roundRect ? ctx.roundRect(0, 0, 440, 110, 24) : ctx.rect(0, 0, 440, 110);
  ctx.fill();

  const color = new THREE.Color(colorHex);
  ctx.strokeStyle = `#${color.getHexString()}`;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 220, 55);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.24, 0.06, 1);
  return sprite;
}
