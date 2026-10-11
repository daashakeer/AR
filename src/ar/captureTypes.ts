/**
 * captureTypes.ts — Shared CaptureResult type for all AR session classes.
 *
 * Every captured trouser frame must return:
 *   - The actual camera image (not an overlay or simulator render)
 *   - Z_m: true perpendicular distance from the camera to the detected plane (metres)
 *   - fx_pixels / fy_pixels: calibrated focal length in pixel units for the captured image
 *   - Full camera pose and plane geometry at the moment of capture
 *
 * Source tags indicate how each value was obtained so callers can decide how much
 * to trust it. Values that cannot be determined are returned as null — never faked.
 */

/** How the camera-to-plane distance was derived. */
export type DistanceSource =
  | 'webxr-hittest'    // Perpendicular distance from camera to WebXR hit-test plane (most accurate)
  | 'focus-distance'   // Derived from MediaStreamTrack focusDistance (device-reported, metres)
  | 'fov-estimate'     // Estimated from Three.js camera FOV + plane assumption (least accurate)
  | 'simulator'        // Synthetic value from 3D room raycaster (not a real device)
  | null;

/** How the focal length & principal point were derived. */
export type IntrinsicsSource =
  | 'webxr-projection' // From XRCamera projectionMatrix supplied by the WebXR runtime (best)
  | 'fov-derived'      // Derived from video resolution + reported/set FOV (approximation)
  | 'simulator'        // Synthetic value from Three.js PerspectiveCamera (not real)
  | null;

/** Source of the detected surface plane. */
export type PlaneSource =
  | 'webxr-hittest'    // Tracked via WebXR hit-test API
  | 'floor-estimate'   // Calibrated horizontal floor/table estimate
  | 'simulator'        // Synthetic 3D room mesh intersection
  | null;

/** Camera pose at the exact frame of capture in world coordinates. */
export interface CameraPoseData {
  /** Camera position in world coordinates (metres). */
  position: { x: number; y: number; z: number };
  /** Camera orientation as a normalized quaternion {x, y, z, w}. */
  quaternion: { x: number; y: number; z: number; w: number };
  /** Camera-to-world 4x4 transformation matrix (16 floats, column-major). */
  cameraMatrix: number[];
  /** World-to-camera 4x4 transformation matrix / View matrix (16 floats, column-major). */
  cameraMatrixInverse: number[];
}

/** Camera intrinsic calibration parameters. */
export interface CameraIntrinsicsData {
  /** Horizontal focal length in pixels, scaled to image resolution. */
  fx_pixels: number | null;
  /** Vertical focal length in pixels, scaled to image resolution. */
  fy_pixels: number | null;
  /** Principal point X coordinate in pixels (image origin top-left). */
  cx_pixels: number | null;
  /** Principal point Y coordinate in pixels (image origin top-left). */
  cy_pixels: number | null;
  /** Width of the captured image in pixels. */
  imageWidth: number;
  /** Height of the captured image in pixels. */
  imageHeight: number;
  /** Full 4x4 projection matrix (column-major, WebXR convention). */
  projectionMatrix: number[] | null;
  /** Provenance of the intrinsics data. */
  intrinsicsSource: IntrinsicsSource;
}

/** Detected trouser support plane geometry. */
export interface TrouserPlaneData {
  /** World-space 3D position of the hit-test point on the plane. */
  planePosition: { x: number; y: number; z: number } | null;
  /** Surface unit normal vector in world coordinates (points upward). */
  planeNormal: { x: number; y: number; z: number } | null;
  /** Plane orientation quaternion in world coordinates. */
  planeQuaternion: { x: number; y: number; z: number; w: number } | null;
  /** 4x4 plane transform matrix (column-major). */
  planeTransform: number[] | null;
  /** Source of plane detection. */
  planeSource: PlaneSource;
  /** True when the surface plane is actively tracked and locked. */
  planeTrackingValid: boolean;
}

/** 2D pixel coordinates for trouser waistband landmarks. Origin (0,0) is top-left. */
export interface WaistbandLandmarks {
  /** Left edge of waistband in image pixels. */
  waistLeft: { u: number; v: number };
  /** Right edge of waistband in image pixels. */
  waistRight: { u: number; v: number };
  /** Source of landmark detection ('manual-click' | 'hrnet-ai' | 'test-synthetic'). */
  landmarkSource: 'manual-click' | 'hrnet-ai' | 'test-synthetic' | null;
  /** Whether both landmarks are confirmed valid within image boundaries. */
  landmarksValid: boolean;
}

/** Tilt-corrected real-world waistband width calculation output. */
export interface WaistbandWidthResult {
  /** Physical waistband width across the surface plane in metres. */
  waistWidthMeters: number | null;
  /** Physical waistband width across the surface plane in centimetres. */
  waistWidthCm: number | null;
  /** Physical waistband width across the surface plane in inches. */
  waistWidthInches: number | null;
  /** 3D intersection point on plane for left landmark in world coordinates. */
  intersectionLeft: { x: number; y: number; z: number } | null;
  /** 3D intersection point on plane for right landmark in world coordinates. */
  intersectionRight: { x: number; y: number; z: number } | null;
  /** Angle in degrees between optical axis and plane normal (0 deg = facing straight down). */
  tiltAngleDeg: number | null;
  /** True when geometric intersection is mathematically valid and within plausible bounds. */
  measurementValid: boolean;
  /** Method description used for measurement. */
  measurementMethod: 'ray-plane-intersection' | 'unproject-fallback' | 'unavailable';
  /** Any quality, glancing angle, or plausibility warnings. */
  measurementWarnings: string[];
  /** High-level reliability status. */
  measurementStatus: 'valid' | 'approximate' | 'warning' | 'unavailable';
}

export interface CaptureResult {
  /** Unique id for pairing JPEG export with JSON metadata. */
  captureId: string;
  /** How the JPEG was obtained. */
  imageCaptureSource?: 'image-capture' | 'video-frame' | 'simulator-render' | 'none';
  /** WebXR sub-image viewport used to derive intrinsics (may differ from JPEG size). */
  xrViewportWidth?: number | null;
  xrViewportHeight?: number | null;

  // ── Captured image ─────────────────────────────────────────────────────────
  /** JPEG data URL from the real device camera (not the Three.js overlay). */
  imageDataUrl: string;
  /** Width of the captured image in pixels (at the captured resolution). */
  imageWidth: number;
  /** Height of the captured image in pixels (at the captured resolution). */
  imageHeight: number;

  // ── Camera-to-trouser-plane distance ───────────────────────────────────────
  /**
   * Perpendicular distance from the camera to the detected surface plane, metres.
   * Null when no plane is detected or tracking is lost.
   * Never hardcoded.
   */
  Z_m: number | null;
  /** How Z_m was determined. */
  distanceSource: DistanceSource;
  /** Distance validity indicator. */
  distanceValid: boolean;
  /** Explicit physical definition of the distance measurement. */
  distanceDefinition: 'perpendicular-camera-to-plane' | 'euclidean-camera-to-hitpoint' | null;

  // ── Camera intrinsics (focal length & principal point) ────────────────────
  /** Horizontal focal length in pixels, scaled to the captured image resolution. */
  fx_pixels: number | null;
  /** Vertical focal length in pixels, scaled to the captured image resolution. */
  fy_pixels: number | null;
  /** Principal point X coordinate in pixels. */
  cx_pixels: number | null;
  /** Principal point Y coordinate in pixels. */
  cy_pixels: number | null;
  /** How intrinsics were determined. */
  intrinsicsSource: IntrinsicsSource;
  /** Structured intrinsics bundle. */
  intrinsics?: CameraIntrinsicsData | null;

  // ── Camera pose at the moment of capture ───────────────────────────────────
  cameraPose: CameraPoseData | null;

  // ── Detected plane geometry ────────────────────────────────────────────────
  planePosition: { x: number; y: number; z: number } | null;
  planeNormal: { x: number; y: number; z: number } | null;
  planeQuaternion: { x: number; y: number; z: number; w: number } | null;
  planeTransform: number[] | null;
  planeSource: PlaneSource;
  planeTrackingValid: boolean;
  plane?: TrouserPlaneData | null;

  // ── Full 4×4 projection matrix (column-major, WebXR convention) ───────────
  projectionMatrix: number[] | null;

  // ── Waistband landmarks & tilt-corrected width ─────────────────────────────
  waistbandLandmarks?: WaistbandLandmarks | null;
  waistbandWidthResult?: WaistbandWidthResult | null;

  // ── Metadata ───────────────────────────────────────────────────────────────
  /** ISO 8601 timestamp of the capture. */
  capturedAt: string;
  /** True when AR/hit-test tracking was valid (plane locked) at capture time. */
  trackingValid: boolean;

  // ── Human-readable reliability summary ─────────────────────────────────────
  reliabilityNote: string;
}
