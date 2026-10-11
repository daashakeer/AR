/**
 * Shared camera frame capture helpers (WebXR rear track / ImageCapture / video frame).
 */

export async function captureFrameFromVideo(video: HTMLVideoElement): Promise<{
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  source: 'video-frame' | 'image-capture';
}> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw <= 0 || vh <= 0) {
    throw new Error('Video track has no decoded frames yet');
  }
  const cv = document.createElement('canvas');
  cv.width = vw;
  cv.height = vh;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(video, 0, 0, vw, vh);
  return {
    imageDataUrl: cv.toDataURL('image/jpeg', 0.95),
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
  if (typeof ImageCapture !== 'undefined') {
    try {
      const ic = new ImageCapture(track) as any;
      const bitmap = await ic.grabFrame();
      const cv = document.createElement('canvas');
      cv.width = bitmap.width;
      cv.height = bitmap.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        imageDataUrl: cv.toDataURL('image/jpeg', 0.95),
        imageWidth: cv.width,
        imageHeight: cv.height,
        source: 'image-capture',
      };
    } catch (err) {
      console.warn('[referenceCapture] ImageCapture.grabFrame failed, falling back to video:', err);
    }
  }

  const stream = new MediaStream([track]);
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', 'true');
  await video.play();

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out waiting for video frame')), 4000);
    const check = () => {
      if (video.videoWidth > 0 && video.readyState >= 2) {
        window.clearTimeout(timeout);
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });

  const result = await captureFrameFromVideo(video);
  video.pause();
  video.srcObject = null;
  return result;
}

export async function captureFrameFallbackGetUserMedia(): Promise<{
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  source: 'video-frame';
} | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
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
