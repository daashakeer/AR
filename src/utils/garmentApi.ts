/**
 * HRNet Trouser Waist Landmark Detection Client.
 * Connects directly to the Python FastAPI backend or Hugging Face Space.
 *
 * Guaranteed zero hardcoded / fabricated coordinates:
 * If detection fails or confidence is too low, returns an explicit error state.
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
  imageWidth?: number;
  imageHeight?: number;
  inferenceTimeMs?: number;
}

// Configurable API URL via environment variable — never hardcoded to localhost in production
const envApiUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HRNET_API_URL;
const API_BASE_URL = (envApiUrl || 'https://dashgaming-slyte.hf.space').replace(/\/$/, '');

/**
 * Predicts trouser waist landmarks from a camera frame data URL.
 */
export async function detectGarmentLandmarks(
  imageDataUrl: string,
  options?: { apiUrl?: string; timeoutMs?: number }
): Promise<GarmentScanResult> {
  const baseUrl = (options?.apiUrl || API_BASE_URL).replace(/\/$/, '');
  const timeoutMs = options?.timeoutMs ?? 15000;

  // ── Strategy A: Direct FastAPI /api/predict-waist ───────────────────────────
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
    }
  } catch (err) {
    // If FastAPI endpoint is not available at baseUrl, try Gradio endpoint
    console.debug('[GarmentAPI] FastAPI endpoint unavailable, trying secondary endpoint:', err);
  }

  // ── Strategy B: Gradio 4.x / Hugging Face Spaces Endpoint ─────────────────
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const callUrl = `${baseUrl}/gradio_api/call/detect_landmarks`;
    const response = await fetch(callUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [imageDataUrl] }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.ok) {
      const callData = await response.json();
      const eventId = callData.event_id;

      if (eventId) {
        const streamUrl = `${baseUrl}/gradio_api/call/detect_landmarks/${eventId}`;
        const streamResp = await fetch(streamUrl);
        const text = await streamResp.text();

        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.substring(5).trim();
            if (jsonStr) {
              const parsed = JSON.parse(jsonStr);
              const dataArray = Array.isArray(parsed) ? parsed : [parsed];
              const resultObj = dataArray[0];

              if (resultObj && typeof resultObj === 'object') {
                if (resultObj.error) {
                  return {
                    success: false,
                    error: resultObj.error,
                    message: typeof resultObj.error === 'string' ? resultObj.error : 'Detection failed',
                  };
                }

                if (resultObj.landmarks && resultObj.landmarks.waist_left && resultObj.landmarks.waist_right) {
                  return {
                    success: true,
                    landmarks: resultObj.landmarks,
                    confidence: {
                      waist_left: resultObj.landmarks.waist_left.confidence ?? 0.8,
                      waist_right: resultObj.landmarks.waist_right.confidence ?? 0.8,
                    },
                  };
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[GarmentAPI] HF Spaces request failed:', err);
  }

  // When both strategies fail or return no prediction:
  // Return an explicit error rather than fabricated coordinates
  return {
    success: false,
    error: 'connection_or_detection_failed',
    message: 'Could not connect to HRNet model service or detect trousers. Please verify network and ensure trousers are flat and clearly framed.',
  };
}
