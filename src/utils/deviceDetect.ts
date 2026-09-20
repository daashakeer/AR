/**
 * Device and browser detection utilities.
 * All detection is heuristic-based and runs entirely client-side.
 */

export function isMobileDevice(): boolean {
  const uaMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  const touchMatch = navigator.maxTouchPoints > 1;
  const narrowScreen = window.innerWidth < 1024;
  return uaMatch || (touchMatch && narrowScreen);
}

export function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('SamsungBrowser/')) return 'Samsung Internet';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Unknown Browser';
}

export function getDeviceType(): string {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) {
    if (/Mobile/i.test(ua)) return 'Android Phone';
    return 'Android Tablet';
  }
  if (isMobileDevice()) return 'Mobile Device';
  return 'Desktop';
}

export function isWebXRAvailable(): boolean {
  return 'xr' in navigator;
}

export async function isArSupported(): Promise<boolean> {
  if (!isWebXRAvailable()) return false;
  try {
    return await navigator.xr!.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export async function hasCameraDevice(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}
