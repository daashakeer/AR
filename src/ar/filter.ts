import * as THREE from 'three';

/**
 * Adaptive Low-Pass Filter for 3D positions and orientations.
 *
 * Designed specifically for WebXR hit-testing:
 * - When moving fast (velocity high): high alpha (0.75 - 0.90) for zero perceived lag.
 * - When moving slow or holding still: low alpha (0.08 - 0.20) for rock-solid stability.
 * - Deadband threshold: minute jitter under 2mm is filtered completely when nearly stationary.
 */
export class AdaptivePoseFilter {
  private smoothedPosition = new THREE.Vector3();
  private smoothedQuaternion = new THREE.Quaternion();

  private lastRawPosition = new THREE.Vector3();
  private initialized = false;
  private lastTimestamp = 0;

  // Configuration parameters
  private minAlpha: number;
  private maxAlpha: number;
  private velocityScale: number;
  private deadbandMeters: number;

  constructor(options?: {
    minAlpha?: number;
    maxAlpha?: number;
    velocityScale?: number;
    deadbandMeters?: number;
  }) {
    this.minAlpha = options?.minAlpha ?? 0.12;
    this.maxAlpha = options?.maxAlpha ?? 0.85;
    this.velocityScale = options?.velocityScale ?? 8.0;
    this.deadbandMeters = options?.deadbandMeters ?? 0.002; // 2mm deadband
  }

  /**
   * Filter raw input position and quaternion.
   * Returns smoothed position, quaternion, and whether the pose is considered stable/locked.
   */
  update(
    rawPos: THREE.Vector3,
    rawQuat: THREE.Quaternion,
    timestamp: number = performance.now()
  ): {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    isStable: boolean;
    speedMps: number;
  } {
    if (!this.initialized) {
      this.smoothedPosition.copy(rawPos);
      this.smoothedQuaternion.copy(rawQuat);
      this.lastRawPosition.copy(rawPos);
      this.lastTimestamp = timestamp;
      this.initialized = true;
      return {
        position: this.smoothedPosition.clone(),
        quaternion: this.smoothedQuaternion.clone(),
        isStable: false,
        speedMps: 0,
      };
    }

    const dt = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    const displacement = rawPos.distanceTo(this.lastRawPosition);
    this.lastRawPosition.copy(rawPos);

    const speedMps = displacement / dt;

    // Small displacement deadband to eliminate micro-jitter when holding still
    const distToSmoothed = rawPos.distanceTo(this.smoothedPosition);
    if (distToSmoothed < this.deadbandMeters) {
      return {
        position: this.smoothedPosition.clone(),
        quaternion: this.smoothedQuaternion.clone(),
        isStable: true,
        speedMps,
      };
    }

    // Dynamic alpha based on speed: higher speed -> higher alpha (less smoothing / faster response)
    const normalizedSpeed = Math.min(1.0, speedMps * this.velocityScale);
    const alpha = this.minAlpha + (this.maxAlpha - this.minAlpha) * normalizedSpeed;

    // Lerp position
    this.smoothedPosition.lerp(rawPos, alpha);

    // Slerp quaternion
    this.smoothedQuaternion.slerp(rawQuat, alpha);

    // A pose is considered "stable/locked" when speed is very low (< 0.04 m/s)
    const isStable = speedMps < 0.04 && distToSmoothed < 0.015;

    return {
      position: this.smoothedPosition.clone(),
      quaternion: this.smoothedQuaternion.clone(),
      isStable,
      speedMps,
    };
  }

  reset(): void {
    this.initialized = false;
  }

  get position(): THREE.Vector3 {
    return this.smoothedPosition;
  }

  get quaternion(): THREE.Quaternion {
    return this.smoothedQuaternion;
  }
}
