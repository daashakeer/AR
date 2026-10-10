/**
 * HRNet Trouser Waist Landmark Detection Client.
 * Connects directly to the AR_hrnet Python FastAPI service (D:\hrnet-fashion\backend\app.py).
 *
 * DeepFashion2 landmarks used:
 *   - WAIST_L = 6 (Left waist corner)
 *   - WAIST_C = 0 (Center waistband)
 *   - WAIST_R = 30 (Right waist corner)
 *
 * Zero Hugging Face / Gradio dependencies.
 * Guaranteed zero fabricated coordinates: returns explicit error if detection fails.
 */

export interface NormalizedPoint {
  x: number; // 0.0 to 1.0 (left to right in camera frame)
  y: number; // 0.0 to 1.0 (top to bottom in camera frame)
  confidence?: number; // 0.0 to 1.0
  pixel_x?: number;
  pixel_y?: number;
}

export interface GarmentLandmarks {
  waist_left: NormalizedPoint;
  waist_center?: NormalizedPoint;
  waist_right: NormalizedPoint;
  inseam?: NormalizedPoint;
  outer_ankle_left?: NormalizedPoint;
  outer_ankle_right?: NormalizedPoint;
}

export interface GarmentScanResult {
  success: boolean;
  error?: string;
  message?: string;
  landmarks?: GarmentLandmarks;
  pantType?: string;
  confidence?: {
    waist_left: number;
    waist_right: number;
  };
  waist_px_contour?: number;
  waist_px_straight?: number;
  imageWidth?: number;
  imageHeight?: number;
  inferenceTimeMs?: number;
}

// Configurable API URL via environment variable; defaults to local HRNet service port 7860/8000
const envApiUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HRNET_API_URL;
const API_BASE_URL = (envApiUrl || 'http://localhost:7860').replace(/\/$/, '');

/**
 * Predicts trouser waist landmarks from a camera frame data URL using the direct HRNet model.
 */
export async function detectGarmentLandmarks(
  imageDataUrl: string,
  options?: { apiUrl?: string; timeoutMs?: number }
): Promise<GarmentScanResult> {
  const baseUrl = (options?.apiUrl || API_BASE_URL).replace(/\/$/, '');
  const timeoutMs = options?.timeoutMs ?? 15000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const fastApiUrl = `${baseUrl}/api/predict-waist`;
    const resp = await fetch(fastApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.landmarks && data.landmarks.waist_left && data.landmarks.waist_right) {
        return {
          success: true,
          landmarks: data.landmarks,
          confidence: {
            waist_left: data.landmarks.waist_left.confidence ?? 1.0,
            waist_right: data.landmarks.waist_right.confidence ?? 1.0,
          },
          waist_px_contour: data.waist_px_contour,
          waist_px_straight: data.waist_px_straight,
          imageWidth: data.image_width,
          imageHeight: data.image_height,
          inferenceTimeMs: data.inference_time_ms,
        };
      } else if (!data.success) {
        return {
          success: false,
          error: data.error || 'low_confidence',
          message: data.message || 'Trouser waistband could not be identified with high confidence.',
        };
      }
    } else {
      const errText = await resp.text().catch(() => '');
      return {
        success: false,
        error: `http_${resp.status}`,
        message: `HRNet service responded with error ${resp.status}: ${errText || resp.statusText}`,
      };
    }
  } catch (err: unknown) {
    const isAbort = (err as { name?: string })?.name === 'AbortError';
    console.warn('[GarmentAPI] HRNet service request failed:', err);
    return {
      success: false,
      error: isAbort ? 'timeout' : 'connection_failed',
      message: isAbort
        ? 'HRNet model timed out. Ensure the local HRNet service is running.'
        : `Could not connect to HRNet service at ${baseUrl}. Ensure backend/app.py is running.`,
    };
  }

  return {
    success: false,
    error: 'detection_failed',
    message: 'Could not detect waistband landmarks.',
  };
}
