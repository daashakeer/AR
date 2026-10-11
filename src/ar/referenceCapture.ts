/**
 * Shared camera frame capture helpers (WebXR rear track / ImageCapture / video frame).
 * Fast, robust, and non-blocking with zero infinite timeouts.
 */

export async function captureFrameFromVideo(video: HTMLVideoElement): Promise<{
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  source: 'video-frame';
}> {
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;

  const cv = document.createElement('canvas');
  cv.width = vw;
  cv.height = vh;
  const ctx = cv.getContext('2d')!;
  try {
    ctx.drawImage(video, 0, 0, vw, vh);
  } catch (err) {
    console.warn('[referenceCapture] drawImage failed:', err);
  }
  return {
    imageDataUrl: cv.toDataURL('image/jpeg', 0.92),
    imageWidth: vw,
    imageHeight: vh,
    source: 'video-frame',
  };
}

export async function captureFrameFromTrack(
  track: MediaStreamTrack
): Promise<{
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  source: 'video-frame' | 'image-capture';
}> {
  // Strategy A: ImageCapture grabFrame with strict 1.5s timeout
  if (typeof ImageCapture !== 'undefined') {
    try {
      const ic = new ImageCapture(track) as any;
      const grabPromise = ic.grabFrame();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ImageCapture timeout')), 1500)
      );
      const bitmap = (await Promise.race([grabPromise, timeoutPromise])) as ImageBitmap;

      if (bitmap && bitmap.width > 0) {
        const cv = document.createElement('canvas');
        cv.width = bitmap.width;
        cv.height = bitmap.height;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          imageDataUrl: cv.toDataURL('image/jpeg', 0.92),
          imageWidth: cv.width,
          imageHeight: cv.height,
          source: 'image-capture',
        };
      }
    } catch (err) {
      console.warn('[referenceCapture] ImageCapture failed or timed out:', err);
    }
  }

  // Strategy B: Temporary offscreen video with strict 1.5s timeout
  return new Promise((resolve, reject) => {
    let resolved = false;
    const stream = new MediaStream([track]);
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');

    const cleanup = () => {
      video.pause();
      video.srcObject = null;
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Video frame capture timeout'));
      }
    }, 1500);

    const tryCapture = () => {
      if (resolved) return;
      if (video.videoWidth > 0) {
        resolved = true;
        clearTimeout(timer);
        captureFrameFromVideo(video)
          .then((res) => {
            cleanup();
            resolve(res);
          })
          .catch((err) => {
            cleanup();
            reject(err);
          });
      }
    };

    video.onloadeddata = tryCapture;
    video.oncanplay = tryCapture;
    video.play().catch(() => {});
  });
}

export async function captureFrameFallbackGetUserMedia(): Promise<{
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  source: 'video-frame';
} | null> {
  try {
    const streamPromise = navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('getUserMedia timeout')), 2000)
    );
    const stream = await Promise.race([streamPromise, timeoutPromise]);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    const frame = await captureFrameFromTrack(track);
    stream.getTracks().forEach((t) => t.stop());
    return { ...frame, source: 'video-frame' };
  } catch (err) {
    console.warn('[referenceCapture] getUserMedia fallback failed:', err);
    return null;
  }
}
