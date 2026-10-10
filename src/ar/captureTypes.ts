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

/** How the focal length was derived. */
export type IntrinsicsSource =
  | 'webxr-projection' // From XRCamera projectionMatrix supplied by the WebXR runtime (best)
  | 'fov-derived'      // Derived from video resolution + reported/set FOV (approximation)
  | 'simulator'        // Synthetic value from Three.js PerspectiveCamera (not real)
  | null;

export interface CaptureResult {
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

  // ── Camera intrinsics (focal length in pixels) ─────────────────────────────
  /**
   * Horizontal focal length in pixels, scaled to the captured image resolution.
   * Null when intrinsics cannot be determined.
   */
  fx_pixels: number | null;
  /**
   * Vertical focal length in pixels, scaled to the captured image resolution.
   * Null when intrinsics cannot be determined.
   */
  fy_pixels: number | null;
  /** How fx_pixels / fy_pixels were determined. */
  intrinsicsSource: IntrinsicsSource;

  // ── Camera pose at the moment of capture ───────────────────────────────────
  cameraPose: {
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
  } | null;

  // ── Detected plane geometry ────────────────────────────────────────────────
  /** World-space position of the hit-test point on the trouser plane. */
  planePosition: { x: number; y: number; z: number } | null;
  /** Surface normal of the detected plane in world space. */
  planeNormal: { x: number; y: number; z: number } | null;

  // ── Full 4×4 projection matrix (column-major, WebXR convention) ───────────
  /** The XRCamera projection matrix at capture time. Null if not a WebXR session. */
  projectionMatrix: number[] | null;

  // ── Metadata ───────────────────────────────────────────────────────────────
  /** ISO 8601 timestamp of the capture. */
  capturedAt: string;
  /** True when AR/hit-test tracking was valid (plane locked) at capture time. */
  trackingValid: boolean;

  // ── Human-readable reliability summary ─────────────────────────────────────
  /**
   * Short note explaining the reliability of Z, fx, fy for downstream use.
   * Always present so callers can show it to the user.
   */
  reliabilityNote: string;
}
